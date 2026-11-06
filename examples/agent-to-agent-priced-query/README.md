# Agent-to-Agent Priced Query, Reference Flow

> **Non-normative banner.** This example demonstrates a **member-less**
> agent-to-agent flow: `~yourhandle` (requester) pays `~example`
> (provider) under an Alter Accord handshake for a single L2 priced
> query. No member's identity is read, so the member share of the
> split has nobody to pay. The example leaves that share unallocated
> and says so on the receipt; a production flow resolves it before it
> settles. Read the split here as structure, not as a quote.

## What this example shows

**Agent-to-agent identity and payment**, end to end. Two agents, each
with its own handle, transact across the ~alter rails with:

1. **DNS-based discovery** of the provider's MCP surface (SDK
   `discover()`; reference flow injects the `.well-known/alter.json`
   directly so the example is self-contained).
2. **Alter Accord handshake**, a bilateral consent envelope both
   parties sign before any priced traffic. The JSON in `accord.json`
   is a mirror of the normative CBOR/COSE form spelled out in
   `draft-morrison-identity-accord-00`.
3. **x402 priced query**, the provider emits a `PaymentEnvelope`,
   the requester runs it through `X402Client.authorise()` with a
   mock signer (we never touch Base mainnet), the settlement
   reference is attached to the tool retry.
4. **Signed response**, the provider returns a `PricedQueryReceipt`
   carrying:
   - the settlement reference,
   - the canonical split breakdown (`member_bps` /
     `facilitator_bps` / `alter_bps` / `cooperative_bps`),
   - an **identity trailer block** on the receipt itself:
     `Acted-By: ~yourhandle` (the handle accountable for the call) and
     `Drafted-With: ~example` (the instrument that produced it).
5. **Cryptographic receipt verification** at the requester:
   Ed25519 signature check over canonical-JSON of the receipt,
   nonce match, freshness window, accord-id match, provider
   public-key match against the discovery step.
6. **Local provenance log**, one JSONL entry per settled query,
   written through the SDK's auth primitives (no new deps).

## Files

| File            | Purpose |
|-----------------|---------|
| `accord.json`   | Minimal Accord envelope template (JSON mirror of CBOR/COSE spec). |
| `requester.ts`  | Runs as `~yourhandle`. Drives the full flow end to end. |
| `provider.ts`   | Runs as `~example`. Quote → fulfil → signed receipt. |
| `shared.ts`     | Accord sign/verify, split math, mock x402 signer, env loader. |
| `env.example`   | Environment template, **rename to `.env` locally**. Contains only structure, no secrets. |

## How to run (reference only, do NOT broadcast)

```sh
cd packages/alter-identity

# Build the SDK once so the examples can import compiled outputs.
# (The examples import `../../src/*.ts` directly in this reference
# flow, so `tsc --noEmit` is enough — `npm run build` not required.)
npm run typecheck

# Generate ephemeral test keys (never commit). Skip if you've already
# generated them.
node -e "const {bytesToHex,randomBytes}=require('@noble/hashes/utils'); \
  require('fs').writeFileSync('examples/agent-to-agent-priced-query/requester.key', bytesToHex(randomBytes(32))); \
  require('fs').writeFileSync('examples/agent-to-agent-priced-query/provider.key', bytesToHex(randomBytes(32)));"

# Run the reference flow in-process.
npx tsx examples/agent-to-agent-priced-query/requester.ts
```

The `requester.ts` entry point pretty-prints a JSON summary:
`status`, `accord_id`, both handles, the `settlement` block, a
response preview, and the canonical split.

> **Do not flip `MAINNET=true`.** The reference flow is deliberately
> wired to a mock signer so it cannot broadcast. The safety guard in
> `shared.ts:loadEnv()` throws on `MAINNET=true` unless
> `I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC=1` is also set.

## What the receipt commits to

| Element | Role in this flow |
|---------|-------------------|
| **Identity trailers** | Every signed receipt carries `Acted-By` and `Drafted-With`. `Acted-By` names the handle accountable for the call and `Drafted-With` names the instrument that produced it. The two are never collapsed. One is answerable, the other is used. |
| **The Accord envelope** | `accord.json` is the JSON mirror of the normative CBOR/COSE form. Both parties Ed25519-sign the canonical serialisation before any priced traffic moves. |
| **The split** | 75 / 5 / 15 / 5, member / facilitator / ~alter / cooperative, in basis points on every receipt. There is no fifth party and no conditional variant. A collective that facilitates a query about someone else occupies the facilitator slot and earns the standard 5%; it never takes a separate slice and never reduces ~alter's share. `shared.ts:computeSplit()` is the whole of the arithmetic. |
| **The member share, with no member** | This flow reads nobody's identity, so the member share has no payee. The example leaves it unallocated and records that in `notes[]` on the receipt rather than silently reassigning it. |

## Security considerations

### Replay prevention

Every `PricedQueryRequest` carries a fresh 16-byte `nonce` and an
`issued_at` timestamp. The provider records `(accord_id, nonce)` for
the full receipt freshness window (`RECEIPT_MAX_AGE_SEC`, default
120 s) and rejects any re-presentation inside that window. The
signed receipt also pins the `request_nonce`, so a replayed receipt
fails the requester-side verifier.

### Receipt freshness window

`verifyReceipt()` rejects any receipt whose `issued_at` is older
than `RECEIPT_MAX_AGE_SEC` OR whose `expires_at` has already
passed. This is a structural check, not a liveness check: a
requester that reads receipts out of a log days later must not trust
them for consent-tier decisions.

### Accord revocation

`accord.revocation.mode = "immediate"` with either-party authority.
Revocation emits a signed revocation receipt and any further calls
under the same `accord_id` are rejected. The reference flow does not
exercise this path but `provider.revokeAccord()` is wired in with a
`TODO(sdk)` marker. The SDK has no revocation-receipt primitive
yet.

### Handle compromise mid-transaction

The requester performs a defence-in-depth check: after Ed25519
verification passes, it compares `signed.signer_public_key` against
the public key the discovery step advertised. If `~example`'s
Instrument key is rotated or revoked between discovery and fulfil,
the mismatch aborts the flow even if the Accord handshake succeeded.
Production deployments should additionally:

- pin the provider's pk in the Accord envelope itself (already done,
  see `parties[].public_key`);
- honour the runtime's key-rotation feed before trusting discovery;
- treat any mismatch as a full-session abort, and raise it.

### What this example does not do

It does not expand the SDK surface. Every helper inlined here carries
a `TODO(sdk):` marker naming the primitive it stands in for, so the
example never reads as API that exists.

## TODO(sdk) markers

Grep for `TODO(sdk):` in `shared.ts`, `requester.ts`, `provider.ts`
to see where SDK primitives are currently stubbed inline:

1. `shared.ts:loadEnv()`, no canonical `loadEnv()` helper in the SDK.
2. `shared.ts:MockX402Signer`, no canonical `MockX402Signer` in
   `x402.ts`.
3. `provider.ts:revokeAccord`, no revocation-receipt primitive yet.
4. `requester.ts` provenance writer. SDK's `provenance.ts` verifies
   ES256 JWS but doesn't ship a local JSONL log writer.

None of these require new dependencies.
