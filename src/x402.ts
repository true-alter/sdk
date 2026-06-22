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

export interface X402ClientOptions {
  /** Pluggable signer. Required if you want automatic settlement. */
  signer?: X402Signer;
  /**
   * Maximum amount the client will spend per query, in the asset's display
   * unit (e.g. `"0.50"` for fifty cents USDC). Hard cap, quotes above this
   * are rejected even if a signer is configured.
   */
  maxPerQuery?: string;
  /** Permitted networks. Defaults to `['base', 'base-sepolia']`. */
  networks?: string[];
  /** Permitted assets. Defaults to `['USDC']`. */
  assets?: string[];
}

export class X402Client {
  private readonly signer?: X402Signer;
  private readonly maxPerQuery?: number;
  private readonly networks: Set<string>;
  private readonly assets: Set<string>;

  constructor(opts: X402ClientOptions = {}) {
    this.signer = opts.signer;
    this.maxPerQuery = opts.maxPerQuery !== undefined ? Number(opts.maxPerQuery) : undefined;
    this.networks = new Set(opts.networks ?? ['base', 'base-sepolia']);
    this.assets = new Set(opts.assets ?? ['USDC']);
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
      // `Number("NaN") > X` is always `false`,
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
    if (!this.signer) {
      // No signer, re-raise so the caller can handle settlement themselves.
      throw new AlterPaymentRequired(envelope.resource ?? 'unknown', envelope);
    }
    return this.signer.settle(envelope);
  }

  /**
   * Build the `_payment` argument that gets attached to retried tool calls.
   * Mirrors the shape the ALTER server expects.
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
 * The header value is JSON or a key=value list, we handle both.
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
