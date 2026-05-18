/**
 * Shared helpers for the agent-to-agent priced-query reference example.
 *
 * Everything here is either (a) a thin wrapper over an @truealter/sdk
 * primitive, or (b) a TODO(sdk) stub marking a surface that should
 * eventually graduate into the SDK proper but is inlined here so the
 * example stays self-contained per the engineering rules.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  base64urlEncode,
  generateKeypair,
  keypairFromPrivateKey,
  sign,
  verify,
  type Ed25519Keypair,
} from '../../src/auth.js';
import { X402Client, type X402Signer, type X402Settlement } from '../../src/x402.js';
import type { PaymentEnvelope } from '../../src/errors.js';

// ── env loading ──────────────────────────────────────────────────────────

// TODO(sdk): the SDK should ship a tiny `loadEnv()` helper so examples
// and CLIs don't each reimplement dotenv. For now, inline a 20-line
// parser — no new dependency.
export interface ExampleEnv {
  MAINNET: boolean;
  I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC: boolean;
  ALTER_ROUTER_ADDRESS: string;
  FACILITATOR_URL: string;
  X402_NETWORK: string;
  X402_ASSET: string;
  PRICED_QUERY_AMOUNT: string;
  REQUESTER_HANDLE: string;
  PROVIDER_HANDLE: string;
  PROVIDER_ACTED_BY: string;
  REQUESTER_PRIVATE_KEY_PATH: string;
  PROVIDER_PRIVATE_KEY_PATH: string;
  PROVENANCE_LOG_PATH: string;
  RECEIPT_MAX_AGE_SEC: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadEnv(): ExampleEnv {
  // Prefer .env if present, otherwise fall back to env.example (checked
  // in as a template — safe because it contains no secrets, only paths).
  const members = ['.env', 'env.example'];
  const raw: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const name of members) {
    const p = join(__dirname, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!(k in raw)) raw[k] = v;
    }
    break; // first file wins
  }

  const env: ExampleEnv = {
    MAINNET: (raw.MAINNET ?? 'false').toLowerCase() === 'true',
    I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC: raw.I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC === '1',
    ALTER_ROUTER_ADDRESS: raw.ALTER_ROUTER_ADDRESS ?? '',
    FACILITATOR_URL: raw.FACILITATOR_URL ?? 'http://localhost:9402/facilitator',
    X402_NETWORK: raw.X402_NETWORK ?? 'base-sepolia',
    X402_ASSET: raw.X402_ASSET ?? 'USDC',
    PRICED_QUERY_AMOUNT: raw.PRICED_QUERY_AMOUNT ?? '0.01',
    REQUESTER_HANDLE: raw.REQUESTER_HANDLE ?? '~cc-opus-4-6',
    PROVIDER_HANDLE: raw.PROVIDER_HANDLE ?? '~cc-sonnet-4-6',
    PROVIDER_ACTED_BY: raw.PROVIDER_ACTED_BY ?? '~blake',
    REQUESTER_PRIVATE_KEY_PATH: raw.REQUESTER_PRIVATE_KEY_PATH ?? './requester.key',
    PROVIDER_PRIVATE_KEY_PATH: raw.PROVIDER_PRIVATE_KEY_PATH ?? './provider.key',
    PROVENANCE_LOG_PATH: raw.PROVENANCE_LOG_PATH ?? './provenance-log.jsonl',
    RECEIPT_MAX_AGE_SEC: Number(raw.RECEIPT_MAX_AGE_SEC ?? '120'),
  };

  // Fail loudly if someone tries to route to mainnet without the
  // explicit acknowledgement flag. This is a belt-and-braces check —
  // the reference flow never actually broadcasts.
  if (env.MAINNET && !env.I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC) {
    throw new Error(
      'MAINNET=true requires I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC=1. ' +
        'The reference flow is not intended to broadcast real transactions.',
    );
  }
  return env;
}

export function loadOrCreateKeypair(path: string): Ed25519Keypair {
  const abs = path.startsWith('/') ? path : join(__dirname, path);
  if (existsSync(abs)) {
    const hex = readFileSync(abs, 'utf8').trim();
    return keypairFromPrivateKey(hex);
  }
  // No key on disk — generate an ephemeral one in memory. The example
  // deliberately does not persist it: real deployments must manage
  // keys via the runtime's secure store, never via example code.
  return generateKeypair();
}

// ── Accord handshake (JSON mirror of CBOR/COSE spec) ─────────────────────

export interface AccordEnvelope {
  protocol: string;
  draft: string;
  accord_type: string;
  accord_id: string;
  parties: AccordParty[];
  scope: Record<string, unknown>;
  consent_gates: Record<string, unknown>;
  split: Record<string, unknown>;
  revocation: Record<string, unknown>;
  replay_protection: Record<string, unknown>;
  signatures: AccordSignature[];
}

export interface AccordParty {
  role: 'requester' | 'provider';
  handle: string;
  tier: 'Instrument' | 'Sovereign' | 'Organisation';
  id8_role: 'Acted-By' | 'Drafted-With';
  public_key: string;
}

export interface AccordSignature {
  handle: string;
  alg: 'ed25519';
  signature: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function signAccord(
  envelope: AccordEnvelope,
  handle: string,
  privateKeyHex: string,
): Promise<AccordSignature> {
  // Signatures cover everything except the signatures[] array itself.
  const { signatures: _s, ...rest } = envelope;
  const canonical = canonicalJson(rest);
  const sig = await sign(privateKeyHex, canonical);
  return { handle, alg: 'ed25519', signature: sig };
}

export async function verifyAccordSignature(
  envelope: AccordEnvelope,
  signature: AccordSignature,
  publicKeyHex: string,
): Promise<boolean> {
  const { signatures: _s, ...rest } = envelope;
  const canonical = canonicalJson(rest);
  return verify(publicKeyHex, signature.signature, canonical);
}

// ── Mock x402 signer ─────────────────────────────────────────────────────

/**
 * In-process x402 signer that never touches a chain. Returns a
 * deterministic synthetic settlement reference so the provider can
 * "verify" it in the reference flow without a facilitator.
 *
 * TODO(sdk): the SDK currently lacks a canonical mock signer — x402.ts
 * ships only the X402Client and an X402Signer interface. Adding a
 * `MockX402Signer` to the SDK would remove this stub. For the
 * repo-separation rule we inline it here rather than expand the SDK
 * surface in the same change.
 */
export class MockX402Signer implements X402Signer {
  public readonly facilitatorUrl: string;

  constructor(facilitatorUrl: string) {
    this.facilitatorUrl = facilitatorUrl;
  }

  async settle(envelope: PaymentEnvelope): Promise<X402Settlement> {
    // Synthesise a deterministic "tx hash" from the envelope. A real
    // signer would broadcast an EIP-3009 transferWithAuthorization to
    // the AlterRouter and return the actual hash. The facilitator URL
    // is recorded in the seed so identical envelopes routed through
    // different facilitators produce distinguishable refs.
    const seed = `${this.facilitatorUrl}:${envelope.network}:${envelope.recipient}:${envelope.amount}:${envelope.nonce ?? ''}:${envelope.resource}`;
    const reference = `mock-0x${base64urlEncode(new TextEncoder().encode(seed)).slice(0, 40).toLowerCase()}`;
    return {
      reference,
      network: envelope.network,
      asset: envelope.asset,
      amount: envelope.amount,
    };
  }
}

// ── Priced-query payload + receipt shapes ────────────────────────────────

export interface PricedQueryRequest {
  accord_id: string;
  requester: string;
  tool: string;
  params: Record<string, unknown>;
  nonce: string;
  issued_at: string; // ISO-8601
}

export interface PricedQueryReceipt {
  accord_id: string;
  request_nonce: string;
  provider: string;
  acted_by: string; // D-ID8 Sovereign handle
  drafted_with: string; // D-ID8 Instrument handle
  tool: string;
  response: unknown;
  settlement: X402Settlement;
  split: {
    // Bps of the gross amount. Agent-to-agent flows with no member
    // mean `member_bps` is redirected per pending D-CO23 ratification.
    member_bps: number;
    facilitator_bps: number;
    alter_bps: number;
    cooperative_bps: number;
    alter_bps: number; // D-RS8 10% of ALTER share when org-attested
    notes: string[];
  };
  issued_at: string;
  expires_at: string;
}

export interface SignedPricedQueryReceipt {
  receipt: PricedQueryReceipt;
  signature: string; // Ed25519 over canonicalJson(receipt)
  signer_public_key: string; // hex
  signer_handle: string;
}

export async function signReceipt(
  receipt: PricedQueryReceipt,
  provider: Ed25519Keypair,
  signerHandle: string,
): Promise<SignedPricedQueryReceipt> {
  const canonical = canonicalJson(receipt);
  const signature = await sign(provider.privateKey, canonical);
  return {
    receipt,
    signature,
    signer_public_key: provider.publicKey,
    signer_handle: signerHandle,
  };
}

export async function verifyReceipt(
  signed: SignedPricedQueryReceipt,
  expectedSignerHandle: string,
  maxAgeSec: number,
  expectedAccordId: string,
  expectedRequestNonce: string,
): Promise<{ valid: boolean; reason?: string }> {
  if (signed.signer_handle !== expectedSignerHandle) {
    return { valid: false, reason: `signer handle mismatch: ${signed.signer_handle}` };
  }
  if (signed.receipt.accord_id !== expectedAccordId) {
    return { valid: false, reason: 'accord_id mismatch (potential cross-accord replay)' };
  }
  if (signed.receipt.request_nonce !== expectedRequestNonce) {
    return { valid: false, reason: 'request_nonce mismatch (potential replay)' };
  }
  const now = Date.now();
  const issued = Date.parse(signed.receipt.issued_at);
  if (!Number.isFinite(issued)) return { valid: false, reason: 'unparseable issued_at' };
  if (now - issued > maxAgeSec * 1000) {
    return { valid: false, reason: `receipt older than ${maxAgeSec}s freshness window` };
  }
  if (Date.parse(signed.receipt.expires_at) < now) {
    return { valid: false, reason: 'receipt already expired' };
  }
  const ok = await verify(signed.signer_public_key, signed.signature, canonicalJson(signed.receipt));
  if (!ok) return { valid: false, reason: 'Ed25519 signature invalid' };
  return { valid: true };
}

// ── D-CD1 / D-RS8 split math (illustrative — see README banner) ──────────

export interface SplitInput {
  grossAmount: string; // display units, e.g. "0.01"
  asset: string;
  hasMember: boolean;
  orgAttested: boolean;
}

export interface SplitResult {
  member_bps: number;
  facilitator_bps: number;
  alter_bps: number;
  cooperative_bps: number;
  alter_bps: number;
  notes: string[];
}

/**
 * Compute the D-CD1 revenue split.
 *
 * Baseline (D-CD1):       75 / 5 / 15 / 5   member / facilitator / ALTER / cooperative
 * Org-attested adder (D-RS8): +10% of ALTER's 15% goes to the Org Alter
 *   → ALTER keeps 13.5% of gross, Org Alter takes 1.5% of gross.
 *
 * Agent-to-agent (no member) behaviour is PENDING a Decision Register
 * entry (see standup-as-category-deep-dive Part IV). Until then the
 * 7500 bps nominally earmarked for the member is flagged in `notes[]`
 * as illustrative-only; this example does NOT take a position on where
 * those bps land (cooperative, facilitator, or a new "no-member
 * rebate" bucket).
 */
export function computeSplit(input: SplitInput): SplitResult {
  const notes: string[] = [];
  let member = 7500;
  let facilitator = 500;
  let alter = 1500;
  const cooperative = 500;
  let orgAlter = 0;

  if (input.orgAttested) {
    // D-RS8: 10% of ALTER's 15% = 1.5% of gross → Org Alter.
    orgAlter = Math.round(alter * 0.1); // 150 bps
    alter = alter - orgAlter; // 1350 bps
    notes.push('D-RS8 applied: 10% of ALTER share redirected to Org Alter (1500 → 1350 + 150 bps).');
  }

  if (!input.hasMember) {
    notes.push(
      'No member in this flow (agent-to-agent L2 priced query). The 7500 bps member share is ' +
        'illustrative-only pending D-CO23 agent-to-agent metadata exclusion DR entry — see README banner. ' +
        'This example leaves the 7500 bps UNALLOCATED; production flows MUST resolve before settlement.',
    );
    member = 0;
  }

  const total = member + facilitator + alter + cooperative + orgAlter;
  notes.push(
    `Bps accounted for: ${total}/10000` +
      (input.hasMember ? ' (sums to 10000 = full pool)' : ` (${10000 - total} bps unallocated — see above)`),
  );

  return {
    member_bps: member,
    facilitator_bps: facilitator,
    alter_bps: alter,
    cooperative_bps: cooperative,
    alter_bps: orgAlter,
    notes,
  };
}

// ── Re-exports for convenience ───────────────────────────────────────────

export { X402Client };
export type { PaymentEnvelope, X402Settlement };
