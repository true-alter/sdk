# Agent-to-Agent Priced Query — Reference Flow

> **Non-normative banner.** This example demonstrates a **member-less**
> agent-to-agent flow: `~cc-opus-4-6` (requester) pays `~cc-sonnet-4-6`
> (provider) under an Alter Accord handshake for a single L2 priced
> query. The **D-CO23 agent-to-agent metadata exclusion is a PENDING
> Decision Register entry** (flagged in
> `standup-as-category-deep-dive` Part IV). Until D-CO23 is ratified,
> the split calculation shown here — in particular what happens to the
> 7500 bps ordinarily earmarked for the member — is
> **illustrative-only**. Do not treat this example as the canonical
> agent-to-agent split; it is a structural reference only.

## What this example shows

ALTER's irreducible core #1 per
`.repos/internal/02-Technical-Strategy/obsolescence-map-2026-04-13.md`
Part III: **agent-to-agent identity + payment**. The reference flow is
the proof artefact for the wedge — two Instrument-tier handles
transacting across the ALTER rails with:

1. **DNS-based discovery** of the provider's MCP surface (SDK
   `discover()`; reference flow injects the `.well-known/alter.json`
   directly so the example is self-contained).
2. **Alter Accord handshake** — a bilateral consent envelope both
   parties sign before any priced traffic. The JSON in `accord.json`
   is a mirror of the normative CBOR/COSE form spelled out in
   `draft-morrison-identity-accord-00` (see
   `.repos/internal/02-Technical-Strategy/alter-accord-implementation-plan.md`).
3. **x402 priced query** — the provider emits a `PaymentEnvelope`,
   the requester runs it through `X402Client.authorise()` with a
   mock signer (we never touch Base mainnet), the settlement
   reference is attached to the tool retry.
4. **Signed response** — the provider returns a `PricedQueryReceipt`
   carrying:
   - the settlement reference,
   - the D-CD1 split breakdown (`member_bps` / `facilitator_bps` /
     `alter_bps` / `cooperative_bps`, plus `alter_bps` when
     D-RS8 applies),
   - a **D-ID8 trailer block** on the receipt itself:
     `Acted-By: ~blake` (Sovereign) and
     `Drafted-With: ~cc-sonnet-4-6` (Instrument).
5. **Cryptographic receipt verification** at the requester:
   Ed25519 signature check over canonical-JSON of the receipt,
   nonce match, freshness window, accord-id match, provider
   public-key match against the discovery step.
6. **Local provenance log** — one JSONL entry per settled query,
   written through the SDK's auth primitives (no new deps).

## Files

| File            | Purpose |
|-----------------|---------|
| `accord.json`   | Minimal Accord envelope template (JSON mirror of CBOR/COSE spec). |
| `requester.ts`  | Runs as `~cc-opus-4-6`. Drives the full flow end to end. |
| `provider.ts`   | Runs as `~cc-sonnet-4-6`. Quote → fulfil → signed receipt. |
| `shared.ts`     | Accord sign/verify, split math, mock x402 signer, env loader. |
| `env.example`   | Environment template — **rename to `.env` locally**. Contains only structure, no secrets. |

## How to run (reference only — do NOT broadcast)

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
response preview, and the D-CD1 split.

> **Do not flip `MAINNET=true`.** The reference flow is deliberately
> wired to a mock signer so it cannot broadcast. The safety guard in
> `shared.ts:loadEnv()` throws on `MAINNET=true` unless
> `I_UNDERSTAND_THIS_WILL_SPEND_REAL_USDC=1` is also set.

## Referenced Decisions

| Decision | Role in this flow |
|----------|-------------------|
| **D-ID8** | Every signed receipt carries the `Acted-By` / `Drafted-With` trailer block. Requester and provider are Instrument-tier handles (`~cc-*`); the provider's Sovereign anchor (`Acted-By: ~blake`) is recorded on the wire. |
| **D-ACC1** | First Alter Accord ceremony format. `accord.json` is the JSON mirror of the normative CBOR/COSE envelope; both parties Ed25519-sign the canonical serialisation before any priced traffic. |
| **D-CD1** | 75 / 5 / 15 / 5 revenue split (member / facilitator / ALTER / cooperative). Visible in `shared.ts:computeSplit()` and surfaced on every receipt. |
| **D-RS8** | When the receipt is org-attested, 10% of ALTER's 15% is redirected to the Org Alter (1500 → 1350 + 150 bps). The reference flow toggles this on to show both branches. |
| **D-CO23** | Anti-extraction 5:1 per-stream rule. **The agent-to-agent metadata exclusion is PENDING** — banner above. The reference flow's treatment of the member share when no member exists is illustrative-only. |

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
`TODO(sdk)` marker — the SDK has no revocation-receipt primitive
yet.

### Handle compromise mid-transaction

The requester performs a defence-in-depth check: after Ed25519
verification passes, it compares `signed.signer_public_key` against
the public key the discovery step advertised. If `~cc-sonnet-4-6`'s
Instrument key is rotated or revoked between discovery and fulfil,
the mismatch aborts the flow even if the Accord handshake succeeded.
Production deployments should additionally:

- pin the provider's pk in the Accord envelope itself (already done
  — see `parties[].public_key`);
- honour the runtime's key-rotation feed before trusting discovery;
- treat any mismatch as a full-session abort plus escalation signal
  to the Org Alter.

### Repo-separation rule

This file lives under `packages/alter-identity/examples/` — the
SOLE approved `packages/` entry in the monorepo. The example
**does not expand the SDK surface**; every inlined helper carries a
`TODO(sdk):` marker pointing at where the primitive should eventually
graduate. Never port this example under `packages/` as a separate
entry, and never move SDK primitives into a sibling directory
structure that breaches the repo-separation rule.

## TODO(sdk) markers

Grep for `TODO(sdk):` in `shared.ts`, `requester.ts`, `provider.ts`
to see where SDK primitives are currently stubbed inline:

1. `shared.ts:loadEnv()` — no canonical `loadEnv()` helper in the SDK.
2. `shared.ts:MockX402Signer` — no canonical `MockX402Signer` in
   `x402.ts`.
3. `provider.ts:revokeAccord` — no revocation-receipt primitive yet.
4. `requester.ts` provenance writer — SDK's `provenance.ts` verifies
   ES256 JWS but doesn't ship a local JSONL log writer.

None of these require new dependencies.
