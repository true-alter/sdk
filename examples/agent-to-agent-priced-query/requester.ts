/**
 * requester.ts: runs as ~cc-opus-4-6 (Instrument-tier; carries the
 * identity trailer naming the acting Sovereign and the drafting Instrument).
 *
 * End-to-end flow:
 *   1. Load accord.json template, populate with both parties' Ed25519
 *      public keys, generate an accord_id.
 *   2. Sign the Accord locally. (Production: discover the provider via
 *      `discover(domain)` from @truealter/sdk; the `publicKey` field
 *      returned by `.well-known/alter.json` is the provider's pk.)
 *   3. Hand the envelope + requester signature to the in-process
 *      provider for countersignature.
 *   4. Build a PricedQueryRequest (nonce, issued_at, params).
 *   5. Ask the provider for a quote → receive a PaymentEnvelope.
 *   6. Run the envelope through `X402Client.authorise()` with the
 *      MockX402Signer (repo-separation: we do NOT import a real
 *      EVM wallet).
 *   7. Call provider.fulfil() with the settlement reference.
 *   8. Verify the signed receipt (signature, freshness, nonce match,
 *      handle match).
 *   9. Append a provenance log entry via a local JSONL writer.
 *      TODO(sdk): the SDK's provenance module verifies ES256 JWS but
 *      doesn't ship a "local provenance log writer" primitive. The
 *      writer is inlined here.
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { type DiscoveryResult } from '../../src/discovery.js';
import {
  MockX402Signer,
  X402Client,
  canonicalJson,
  loadEnv,
  loadOrCreateKeypair,
  signAccord,
  verifyReceipt,
  type AccordEnvelope,
  type PricedQueryRequest,
} from './shared.js';
import { Provider, newAccordId, buildAlterJson } from './provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load the accord template from disk and fill in both parties' public
 * keys + a fresh accord_id. Signatures are added later.
 */
function loadAccordTemplate(
  accordId: string,
  requesterHandle: string,
  requesterPk: string,
  providerHandle: string,
  providerPk: string,
): AccordEnvelope {
  const raw = readFileSync(join(__dirname, 'accord.json'), 'utf8');
  const tpl = JSON.parse(raw) as AccordEnvelope & { _comment?: string };
  delete (tpl as { _comment?: string })._comment;
  tpl.accord_id = accordId;
  for (const p of tpl.parties) {
    if (p.role === 'requester') {
      p.handle = requesterHandle;
      p.public_key = `ed25519:${requesterPk}`;
    } else if (p.role === 'provider') {
      p.handle = providerHandle;
      p.public_key = `ed25519:${providerPk}`;
    }
  }
  tpl.signatures = [];
  return tpl;
}

/**
 * Discovery stub. In production this calls `discover(domain)` from
 * @truealter/sdk; for the reference flow we inject the alter.json
 * that the provider would serve, avoiding a real HTTP request.
 */
function fakeDiscovery(
  env: ReturnType<typeof loadEnv>,
  providerKeypair: { publicKey: string },
): DiscoveryResult {
  const alterJson = buildAlterJson(env, providerKeypair as Parameters<typeof buildAlterJson>[1]);
  return {
    url: alterJson.mcp,
    transport: 'streamable-http',
    source: 'alter.json',
    publicKey: alterJson.pk,
    x402Contract: alterJson.x402,
    capability: alterJson.cap,
    raw: alterJson as unknown as Record<string, unknown>,
  };
}

function logProvenance(path: string, entry: Record<string, unknown>): void {
  const abs = path.startsWith('/') ? path : join(__dirname, path);
  appendFileSync(abs, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function main() {
  const env = loadEnv();

  // ── Key material ─────────────────────────────────────────────────────
  const requesterKeypair = loadOrCreateKeypair(env.REQUESTER_PRIVATE_KEY_PATH);
  const providerKeypair = loadOrCreateKeypair(env.PROVIDER_PRIVATE_KEY_PATH);
  // In production, the requester never holds the provider's private
  // key, we load both here because the example runs both agents in
  // one process.
  const provider = new Provider(env, providerKeypair);

  // ── Discovery ────────────────────────────────────────────────────────
  const discovered = fakeDiscovery(env, providerKeypair);
  if (!discovered.publicKey) throw new Error('Discovery missing provider public key');
  // Strip the `ed25519:` prefix if present, alter.json carries the
  // hex public key directly per auth.ts conventions.
  const providerPkHex = discovered.publicKey.replace(/^ed25519:/, '');

  // ── Accord handshake ─────────────────────────────────────────────────
  const accordId = newAccordId();
  const envelope = loadAccordTemplate(
    accordId,
    env.REQUESTER_HANDLE,
    requesterKeypair.publicKey,
    env.PROVIDER_HANDLE,
    providerPkHex,
  );
  const requesterSig = await signAccord(envelope, env.REQUESTER_HANDLE, requesterKeypair.privateKey);
  const countersigned = await provider.countersignAccord(envelope, requesterSig, requesterKeypair.publicKey);
  if (countersigned.signatures.length !== 2) {
    throw new Error(`Accord did not gather both signatures (got ${countersigned.signatures.length})`);
  }

  // ── Priced-query dispatch ────────────────────────────────────────────
  const nonce = randomBytes(16).toString('hex');
  const request: PricedQueryRequest = {
    accord_id: accordId,
    requester: env.REQUESTER_HANDLE,
    tool: 'compute_belonging',
    params: {
      role_archetype: 'distributed-systems-engineer',
      // Member-less flow whose member-share handling is still being
      // finalised, see README banner.
      member_handle: null,
    },
    nonce,
    issued_at: new Date().toISOString(),
  };

  // ── x402 quote + settle ──────────────────────────────────────────────
  const envelopePayment = provider.quote(request);
  const x402 = new X402Client({
    signer: new MockX402Signer(env.FACILITATOR_URL),
    maxPerQuery: env.PRICED_QUERY_AMOUNT, // policy cap, reject anything dearer
    networks: [env.X402_NETWORK],
    assets: [env.X402_ASSET],
  });
  const settlement = await x402.authorise(envelopePayment);

  // ── Fulfil + cryptographic receipt verification ──────────────────────
  const signed = await provider.fulfil(request, settlement.reference);
  const verification = await verifyReceipt(
    signed,
    env.PROVIDER_HANDLE,
    env.RECEIPT_MAX_AGE_SEC,
    accordId,
    nonce,
  );
  if (!verification.valid) {
    throw new Error(`Receipt verification failed: ${verification.reason}`);
  }

  // Defence-in-depth: also cross-check the receipt's signer_public_key
  // against the public key the discovery step told us to expect. A
  // rotated or compromised Instrument handle would trip this check
  // even before the Ed25519 verify succeeded.
  if (signed.signer_public_key !== providerPkHex) {
    throw new Error(
      `Provider public key mismatch, discovery advertised ${providerPkHex}, receipt signed by ${signed.signer_public_key}. Abort (possible handle compromise mid-transaction).`,
    );
  }

  // ── Provenance log ───────────────────────────────────────────────────
  logProvenance(env.PROVENANCE_LOG_PATH, {
    schema: 'alter/agent-to-agent-priced-query/0.1',
    logged_at: new Date().toISOString(),
    accord_id: accordId,
    requester: env.REQUESTER_HANDLE,
    provider: env.PROVIDER_HANDLE,
    tool: request.tool,
    nonce,
    settlement_reference: settlement.reference,
    settlement_network: settlement.network,
    settlement_amount: settlement.amount,
    settlement_asset: settlement.asset,
    router: env.ALTER_ROUTER_ADDRESS,
    receipt_hash: await hashCanonical(signed.receipt),
    split: signed.receipt.split,
    provider_acted_by: signed.receipt.acted_by,
    provider_drafted_with: signed.receipt.drafted_with,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        accord_id: accordId,
        requester: env.REQUESTER_HANDLE,
        provider: env.PROVIDER_HANDLE,
        settlement: signed.receipt.settlement,
        response_preview: (signed.receipt.response as { result?: unknown }).result,
        split: signed.receipt.split,
      },
      null,
      2,
    ),
  );
}

async function hashCanonical(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const isEntryPoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith('requester.ts');
if (isEntryPoint) {
  void main();
}

// Silence unused-existsSync warning, reserved for `.env` precedence
// bookkeeping once the example is wired into a runner.
void existsSync;
