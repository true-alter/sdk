/**
 * x402 micropayment client.
 *
 * Premium MCP tools return HTTP 402 with a payment envelope. The
 * {@link X402Client} settles the envelope on Base L2 (USDC) and replays
 * the original request with the resulting transaction reference.
 *
 * The actual on-chain settlement is delegated to a pluggable
 * {@link X402Signer} so that the SDK ships *without* a hard dependency
 * on viem, ethers, or any specific wallet library. Apps that want a
 * default signer should pass `viemX402Signer` (separate, opt-in package).
 */

import { AlterError, AlterPaymentRequired, type PaymentEnvelope } from './errors.js';

export interface X402Signer {
  /**
   * Settle a payment envelope and return a settlement reference (a tx hash
   * for EVM chains, a signature for off-chain payments). The reference is
   * what gets sent back to the MCP server to authorise the retry.
   */
  settle(envelope: PaymentEnvelope): Promise<X402Settlement>;
}

export interface X402Settlement {
  /** EVM tx hash, Solana signature, or facilitator-issued reference. */
  reference: string;
  /** Network the settlement was broadcast on. */
  network: string;
  /** Amount paid (matches envelope.amount). */
  amount: string;
  /** Asset paid (matches envelope.asset). */
  asset: string;
}

/**
 * Known ~alter recipient addresses for production deployments.
 *
 * The `recipient` in an x402 quote arrives in a server-controlled header. A
 * hostile MCP server can therefore name any address it likes and, absent a
 * check, settlement pays whatever it names. Gating the recipient against a
 * known list is what closes that: supply this list (or your own set) via the
 * `recipientAllowlist` option on {@link X402Client}.
 *
 * Recipient gating is opt-in. Omitting `recipientAllowlist` leaves the check
 * off, so that callers written against earlier releases keep working; the
 * constructor emits a runtime warning in that case, so the gap is never
 * silent. Production callers SHOULD always pass an explicit allowlist.
 *
 * The address below is the live Base mainnet AlterRouter, not a placeholder,
 * and mirrors the on-chain split contract (75/15/5/5: ~alter receives 5% to
 * the treasury address). It is already published at
 * https://truealter.com/.well-known/alter.json.
 */
export const DEFAULT_RECIPIENT_ALLOWLIST: readonly string[] = Object.freeze([
  // Base mainnet AlterRouter.
  '0xDe72f615B9943E15055ED57AB6FC39990eeEeA5e',
]);

export interface X402ClientOptions {
  /** Pluggable signer. Required if you want automatic settlement. */
  signer?: X402Signer;
  /**
   * Maximum amount the client will spend per query, in the asset's display
   * unit (e.g. `"0.50"` for fifty cents USDC). Hard cap: quotes above this
   * are rejected even if a signer is configured.
   */
  maxPerQuery?: string;
  /** Permitted networks. Defaults to `['base', 'base-sepolia']`. */
  networks?: string[];
  /** Permitted assets. Defaults to `['USDC']`. */
  assets?: string[];
  /**
   * Known recipient addresses to gate settlement against. NOT applied
   * automatically: the constructor does not fall back to
   * {@link DEFAULT_RECIPIENT_ALLOWLIST} when this is omitted, so that callers
   * written against earlier releases keep working. Pass
   * `DEFAULT_RECIPIENT_ALLOWLIST` explicitly (or your own list) to enable
   * the check; omitting this option leaves recipient validation OFF, and
   * the constructor logs a runtime warning when that happens so the gap is
   * never silent.
   *
   * An empty array disables the check entirely (not recommended for production).
   */
  recipientAllowlist?: string[];
}

export class X402Client {
  private readonly signer?: X402Signer;
  private readonly maxPerQuery?: number;
  private readonly networks: Set<string>;
  private readonly assets: Set<string>;
  // undefined = allowlist check disabled (backward-compatible default).
  // Non-null = active allowlist; reject any recipient not in the set.
  private readonly recipientAllowlist: ReadonlySet<string> | undefined;

  constructor(opts: X402ClientOptions = {}) {
    this.signer = opts.signer;
    this.maxPerQuery = opts.maxPerQuery !== undefined ? Number(opts.maxPerQuery) : undefined;
    this.networks = new Set(opts.networks ?? ['base', 'base-sepolia']);
    this.assets = new Set(opts.assets ?? ['USDC']);
    if (opts.recipientAllowlist !== undefined) {
      // Explicit empty array = disable the check.
      this.recipientAllowlist = opts.recipientAllowlist.length === 0
        ? undefined
        : new Set(opts.recipientAllowlist.map((a) => a.toLowerCase()));
    } else {
      // No option supplied: the check stays off, so that callers written
      // against earlier releases keep working. Defaulting it ON would reject
      // settlement for any integrator legitimately pointed at a non-~alter
      // recipient, so the default stays opt-in. It is not silent, though: a
      // caller who never reads the JSDoc still learns the check is off, from
      // the warning below.
      this.recipientAllowlist = undefined;
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          '[@truealter/sdk] X402Client constructed with no recipientAllowlist: ' +
            'settlement recipient validation is OFF. Pass ' +
            'DEFAULT_RECIPIENT_ALLOWLIST or your own list to enable it, or an ' +
            'empty array to silence this warning if that is deliberate.',
        );
      }
    }
  }

  /**
   * Validate the envelope against this client's policy and, if a signer
   * is configured, settle it. Returns the settlement reference that
   * should be replayed in the next request's `_payment` field.
   */
  async authorise(envelope: PaymentEnvelope): Promise<X402Settlement> {
    if (envelope.scheme !== 'x402') {
      throw new AlterError('PAYMENT_REQUIRED', `unsupported payment scheme: ${envelope.scheme}`);
    }
    if (!this.networks.has(envelope.network)) {
      throw new AlterError('PAYMENT_REQUIRED', `network ${envelope.network} not permitted by client policy`);
    }
    if (!this.assets.has(envelope.asset)) {
      throw new AlterError('PAYMENT_REQUIRED', `asset ${envelope.asset} not permitted by client policy`);
    }
    if (this.maxPerQuery !== undefined) {
      // sdk/M-4 pentest 2026-04-17: `Number("NaN") > X` is always `false`,
      // so a server-controlled non-numeric `amount` silently bypasses the
      // cap. Require a finite, non-negative number before comparison.
      const amt = Number(envelope.amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > this.maxPerQuery) {
        throw new AlterError(
          'PAYMENT_REQUIRED',
          `quote ${envelope.amount} ${envelope.asset} exceeds maxPerQuery ${this.maxPerQuery}`,
        );
      }
    }
    // Validate recipient against the known-address allowlist to prevent a
    // hostile MCP server from redirecting settlement funds to an
    // attacker-controlled address. The check normalises both sides to
    // lowercase so EIP-55 mixed-case checksums don't cause false negatives.
    // Only active when an explicit recipientAllowlist was passed at construction.
    if (this.recipientAllowlist !== undefined) {
      const recipientNorm = (envelope.recipient ?? '').toLowerCase();
      if (!recipientNorm || !this.recipientAllowlist.has(recipientNorm)) {
        throw new AlterError(
          'PAYMENT_REQUIRED',
          `recipient "${envelope.recipient}" is not on the known-recipient allowlist`,
        );
      }
    }

    if (!this.signer) {
      // No signer: re-raise so the caller can handle settlement themselves.
      throw new AlterPaymentRequired(envelope.resource ?? 'unknown', envelope);
    }
    return this.signer.settle(envelope);
  }

  /**
   * Build the `_payment` argument that gets attached to retried tool calls.
   * Mirrors the shape the ~Alter server expects.
   */
  static buildPaymentArg(settlement: X402Settlement): Record<string, string> {
    return {
      scheme: 'x402',
      network: settlement.network,
      asset: settlement.asset,
      amount: settlement.amount,
      reference: settlement.reference,
    };
  }
}

/**
 * Parse an `X-402-Payment` response header into a {@link PaymentEnvelope}.
 * The header value is JSON or a key=value list: we handle both.
 */
export function parsePaymentHeader(header: string): PaymentEnvelope | null {
  try {
    const parsed = JSON.parse(header);
    if (parsed && typeof parsed === 'object') return parsed as PaymentEnvelope;
  } catch {
    // fall through to kv parsing
  }
  const out: Record<string, string> = {};
  for (const part of header.split(/[,;]/)) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = rest.join('=').replace(/^"|"$/g, '');
  }
  if (!out.scheme && !out.network && !out.amount) return null;
  return {
    scheme: 'x402',
    network: out.network || 'base',
    asset: out.asset || 'USDC',
    amount: out.amount || '0',
    recipient: out.recipient || '',
    resource: out.resource || '',
    expires_at: out.expires_at,
    nonce: out.nonce,
  };
}
