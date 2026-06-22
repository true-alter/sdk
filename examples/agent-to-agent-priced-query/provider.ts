/**
 * provider.ts: runs as ~cc-sonnet-4-6 (Instrument-tier; carries the
 * identity trailer naming the acting Sovereign and the drafting Instrument).
 *
 * Role:
 *   1. Advertise a priced MCP tool (`compute_belonging`) via
 *      `.well-known/alter.json`, the template that requester.ts
 *      discovers using the SDK's `discover()` primitive.
 *   2. Accept an Accord handshake, countersign the envelope.
 *   3. On priced-query call:
 *        - emit a PaymentEnvelope (x402 quote, 402 response shape)
 *        - accept the settlement reference on the retry
 *        - execute a stub handler (hardcoded compute_belonging payload)
 *        - return a signed receipt carrying the identity trailer block
 *          (`Acted-By: ~example-provider`, `Drafted-With: ~cc-sonnet-4-6`).
 *
 * This file is reference code, it exposes each step as a callable
 * function so the requester can drive them in-process without an
 * HTTP server. A real provider deploys the same sequence behind
 * streamable-http MCP.
 */

import { randomUUID } from 'node:crypto';

import type { PaymentEnvelope } from '../../src/errors.js';
import {
  type AccordEnvelope,
  type AccordSignature,
  type ExampleEnv,
  type PricedQueryRequest,
  type PricedQueryReceipt,
  type SignedPricedQueryReceipt,
  computeSplit,
  loadEnv,
  loadOrCreateKeypair,
  signAccord,
  signReceipt,
  verifyAccordSignature,
} from './shared.js';
import { type Ed25519Keypair } from '../../src/auth.js';

/**
 * `.well-known/alter.json` fragment the provider publishes so the
 * requester can resolve it with `discover()` from the SDK. Not served
 * over HTTP in this reference flow (the requester injects it directly),
 * but the shape is identical to production.
 */
export function buildAlterJson(env: ExampleEnv, keypair: Ed25519Keypair) {
  return {
    v: 1,
    mcp: 'https://provider.example/api/v1/mcp',
    pk: keypair.publicKey,
    x402: env.ALTER_ROUTER_ADDRESS,
    cap: 'L2', // priced-query tier
    handle: env.PROVIDER_HANDLE,
    tier: 'Instrument',
  };
}

export class Provider {
  private readonly env: ExampleEnv;
  private readonly keypair: Ed25519Keypair;
  private readonly activeAccords = new Map<string, AccordEnvelope>();
  // nonce → last-seen issued_at. Used to block replays inside the
  // receipt freshness window.
  private readonly seenNonces = new Map<string, number>();

  constructor(env: ExampleEnv, keypair: Ed25519Keypair) {
    this.env = env;
    this.keypair = keypair;
  }

  get handle(): string {
    return this.env.PROVIDER_HANDLE;
  }

  get publicKey(): string {
    return this.keypair.publicKey;
  }

  /**
   * Step 2, countersign the Accord.
   *
   * The provider verifies the requester's signature against the
   * party entry already in the envelope, then appends its own.
   */
  async countersignAccord(
    envelope: AccordEnvelope,
    requesterSignature: AccordSignature,
    requesterPublicKeyHex: string,
  ): Promise<AccordEnvelope> {
    const requesterValid = await verifyAccordSignature(envelope, requesterSignature, requesterPublicKeyHex);
    if (!requesterValid) {
      throw new Error(`Provider: requester Accord signature invalid (${requesterSignature.handle})`);
    }

    // Append the requester's signature, then our own. The signature
    // domain excludes the signatures[] array itself.
    const countersigned: AccordEnvelope = {
      ...envelope,
      signatures: [...envelope.signatures, requesterSignature],
    };
    const providerSig = await signAccord(countersigned, this.handle, this.keypair.privateKey);
    countersigned.signatures.push(providerSig);

    this.activeAccords.set(envelope.accord_id, countersigned);
    return countersigned;
  }

  /**
   * Step 3a, respond to a priced-query call with a 402-style envelope.
   *
   * In production this is carried over HTTP 402 + `X-402-Payment`
   * header; the wire shape here matches `PaymentEnvelope` so the
   * requester can feed it straight to `X402Client.authorise()`.
   */
  quote(request: PricedQueryRequest): PaymentEnvelope {
    const accord = this.activeAccords.get(request.accord_id);
    if (!accord) throw new Error(`Provider: unknown accord_id ${request.accord_id}`);

    const now = Date.now();
    const expiresAt = new Date(now + this.env.RECEIPT_MAX_AGE_SEC * 1000).toISOString();
    return {
      scheme: 'x402',
      network: this.env.X402_NETWORK,
      asset: this.env.X402_ASSET,
      amount: this.env.PRICED_QUERY_AMOUNT,
      recipient: this.env.ALTER_ROUTER_ADDRESS,
      resource: `accord:${request.accord_id}/tool:${request.tool}`,
      expires_at: expiresAt,
      nonce: request.nonce,
    };
  }

  /**
   * Step 3b, on receipt of a settlement reference, execute the tool
   * and return a signed receipt.
   */
  async fulfil(
    request: PricedQueryRequest,
    settlementReference: string,
  ): Promise<SignedPricedQueryReceipt> {
    const accord = this.activeAccords.get(request.accord_id);
    if (!accord) throw new Error(`Provider: unknown accord_id ${request.accord_id}`);

    // Replay protection: reject any (accord_id, nonce) pair we've
    // already served inside the freshness window. A real provider
    // persists this to durable storage.
    const seenKey = `${request.accord_id}:${request.nonce}`;
    const prev = this.seenNonces.get(seenKey);
    const now = Date.now();
    if (prev !== undefined && now - prev < this.env.RECEIPT_MAX_AGE_SEC * 1000) {
      throw new Error(`Provider: replay detected for nonce ${request.nonce}`);
    }
    this.seenNonces.set(seenKey, now);

    // ── Stub handler ─────────────────────────────────────────────
    // The tool under test is `compute_belonging`, in production it
    // returns a Belonging Probability vector keyed by role archetype.
    // For the reference flow we return a hardcoded payload. Note that
    // agent-to-agent L2 queries don't touch member data; this
    // response would carry only role-side scoring weights.
    const stubResponse = {
      tool: 'compute_belonging',
      result: {
        belonging_probability: 0.78,
        components: {
          authenticity: 0.82,
          acceptance: 0.71,
          complementarity: 0.81,
        },
        note: 'Stub response. Production compute_belonging integrates the three-component formula (0.40 authenticity + 0.35 acceptance + 0.25 complementarity) against a live role archetype vector.',
      },
    };

    // Revenue split with the org-attested adder illustrated. The
    // `hasMember: false` branch is the still-being-finalised case, see
    // README banner and shared.ts:computeSplit for the note string.
    const split = computeSplit({
      grossAmount: this.env.PRICED_QUERY_AMOUNT,
      asset: this.env.X402_ASSET,
      hasMember: false,
      orgAttested: true,
    });

    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.env.RECEIPT_MAX_AGE_SEC * 1000).toISOString();

    const receipt: PricedQueryReceipt = {
      accord_id: request.accord_id,
      request_nonce: request.nonce,
      provider: this.handle,
      // Identity trailer block. Acted-By is the Sovereign, Drafted-With
      // is the Instrument. GitHub Co-Authored-By compatibility trailer
      // is omitted from the on-wire receipt (only relevant for git
      // commits), but would be appended when this receipt is archived
      // into a commit message.
      acted_by: this.env.PROVIDER_ACTED_BY,
      drafted_with: this.handle,
      tool: request.tool,
      response: stubResponse,
      settlement: {
        reference: settlementReference,
        network: this.env.X402_NETWORK,
        asset: this.env.X402_ASSET,
        amount: this.env.PRICED_QUERY_AMOUNT,
      },
      split: {
        member_bps: split.member_bps,
        facilitator_bps: split.facilitator_bps,
        alter_bps: split.alter_bps,
        cooperative_bps: split.cooperative_bps,
        org_alter_bps: split.org_alter_bps,
        notes: split.notes,
      },
      issued_at: issuedAt,
      expires_at: expiresAt,
    };

    return signReceipt(receipt, this.keypair, this.handle);
  }

  /** Revoke an Accord mid-lifecycle (see accord.revocation). */
  revokeAccord(accord_id: string, reason: string): void {
    this.activeAccords.delete(accord_id);
    // TODO(sdk): production would also emit a signed RevocationReceipt
    // to the requester, the SDK doesn't have a primitive for that yet.
    void reason;
  }
}

// ── CLI entry point (for `npx tsx provider.ts`) ─────────────────────────

async function main() {
  const env = loadEnv();
  const keypair = loadOrCreateKeypair(env.PROVIDER_PRIVATE_KEY_PATH);
  const provider = new Provider(env, keypair);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        handle: provider.handle,
        publicKey: provider.publicKey,
        alter_json: buildAlterJson(env, keypair),
        router: env.ALTER_ROUTER_ADDRESS,
        network: env.X402_NETWORK,
      },
      null,
      2,
    ),
  );
}

const isEntryPoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith('provider.ts');
if (isEntryPoint) {
  void main();
}

// accord_id generator used by the runner in requester.ts.
export function newAccordId(): string {
  return randomUUID();
}
