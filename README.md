# @truealter/sdk

~Alter Identity SDK - query the continuous identity field from any JavaScript/TypeScript environment.

[![npm version](https://img.shields.io/npm/v/@truealter/sdk.svg)](https://www.npmjs.com/package/@truealter/sdk)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/true-alter/alter-identity/actions/workflows/ci.yml/badge.svg)](https://github.com/true-alter/alter-identity/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#api)
[![Glama score](https://glama.ai/mcp/servers/true-alter/alter-identity/badges/score.svg)](https://glama.ai/mcp/servers/true-alter/alter-identity)
[![AI Agent Marketplace](https://www.deepnlp.org/api/ai_agent_marketplace/svg?name=truealter/alter-identity)](https://www.deepnlp.org/store/ai-agent/identity/pub-truealter/alter-identity)

> **Install:** `npm install @truealter/sdk`

A thin client over the ~Alter MCP server (Streamable HTTP, JSON-RPC 2.0, MCP spec `2025-11-25`) with x402 micropayment support, ES256 provenance verification, and config generators for Claude Code, Cursor, and generic MCP clients.

- **Branded host:** `https://mcp.truealter.com` (serves `.well-known/mcp.json` for discovery)
- **JSON-RPC wire endpoint:** `https://mcp.truealter.com/api/v1/mcp` - this is what Streamable HTTP POSTs target (the SDK default)
- **Wire protocol:** Streamable HTTP, JSON-RPC 2.0, MCP `2025-11-25` (server negotiates `2025-06-18` + `2025-03-26` for backwards-compatible clients)
- **Tools:** **37 publicly advertised**, 28 free (L0) + 9 premium (L1-L5), kept in sync with ~Alter's live MCP server at every publish.
- **Runtime:** Node 18+, Deno, Bun, Cloudflare Workers, modern browsers
- **Crypto:** `@noble/ed25519` + `@noble/hashes` (no other dependencies)
- **Bundle:** ESM + CJS dual output

## Quickstart

```
npm install @truealter/sdk
```

Then import the client in your code (see the API section below). The
day-to-day command line lives in
[`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli):

```
alter init
alter verify ~alter
```

## Bridge vs SDK

This package ships a stdio bridge entrypoint (`bin/mcp-bridge.ts`,
built to `dist/bin/mcp-bridge.js`) that the `alter` CLI launches by file
path via its `mcp-bridge` subcommand. It is a **dev/demo surface** for
dropping ~Alter into MCP hosts that speak the stdio transport (Claude Code,
Cursor, Continue, Windsurf). It is useful for handshake, `tools/list`, and
L0 tool calls, but it does not carry ES256 per-invocation signing:
authenticated MCP tools will fail at the server edge when reached through
the bridge. For production use, import `@truealter/sdk` directly and
construct an `MCPClient` / `AlterClient` with the optional `signing`
parameter; that path is the primary one and carries the provenance
envelope end-to-end. Bridge signing is planned for a future release.

## CLI

This package exposes no command-line binary of its own: it is a library you
import. The bridge entrypoint above is not a published `bin`; it is resolved
by file path from the `alter` CLI, which is distributed separately as
[`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli). Run
`alter --help` for the inline reference.

## Why ~Alter is not IAM

Identity Access Management answers *who is logged in*. ~Alter answers *who they actually are* - a continuous field of recognition that any IAM stack can sit on top of.

## Theoretical Foundation

~Alter is the working instantiation of an eight-paper academic corpus on identity field theory. The SDK below is what happens when the theory ships as protocol. Each paper is open access on figshare under CC-BY 4.0.

| Paper | Title | DOI |
|-------|-------|-----|
| I | *Belonging is earned, not inherited* | [10.6084/m9.figshare.31794784](https://doi.org/10.6084/m9.figshare.31794784) |
| II | *The self is inferred, not owned* | [10.6084/m9.figshare.31804222](https://doi.org/10.6084/m9.figshare.31804222) |
| III | *The same form, at every scale* | [10.6084/m9.figshare.31812955](https://doi.org/10.6084/m9.figshare.31812955) |
| IV | *Measurement changes the thing measured* | [10.6084/m9.figshare.31812982](https://doi.org/10.6084/m9.figshare.31812982) |
| V | *Political failure has a geometry* | [10.6084/m9.figshare.31813000](https://doi.org/10.6084/m9.figshare.31813000) |
| VI | *When does a machine have a self* | [10.6084/m9.figshare.31813006](https://doi.org/10.6084/m9.figshare.31813006) |
| VII | *Seventy-five predictions, each falsifiable* | [10.6084/m9.figshare.31951644](https://doi.org/10.6084/m9.figshare.31951644) |
| VIII | *Identity as a field, not a property* | [10.6084/m9.figshare.31951383](https://doi.org/10.6084/m9.figshare.31951383) |

For the lay-register chapter version, see [`/origin`](https://truealter.com/origin).

## API

### Initialise the client

```ts
import { AlterClient, X402Client } from "@truealter/sdk";

const alter = new AlterClient({
  endpoint: "https://mcp.truealter.com/api/v1/mcp", // optional - this is the default; bare host returns 405
  x402: new X402Client({                  // optional - only required for premium tools
    signer: yourViemOrEthersSigner,
    maxPerQuery: "0.10",
  }),
});
```

**Authentication.** The client above is anonymous, and every free L0 tool
answers with no credential. For tools that act on your own identity
(standing requirements, the Golden Thread, member self-writes), run
`alter login` once: it provisions your member credential into the local
session (`~/.config/alter/session.json`). The hosted endpoint is
bearer-first, so the [`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli)
bridge reads that session credential for you; you never mint or paste a
key. If you construct a client yourself, pass that same session
credential as the optional `apiKey` option.

### Minimum-version preflight (required)

~Alter's backend publishes a per-client minimum-version floor. The SDK
preflights this floor lazily on the first network call: no explicit
call is required for the common case. If the running SDK is below the
floor for `alter-identity`, the SDK throws `BelowFloorError` with the
upgrade command attached.

The floor document is signed by the backend with a floor-only Ed25519
private key. The SDK ships only the corresponding public keys
(`KNOWN_FLOOR_PUBLIC_KEYS`, a `key_id` to SPKI-PEM map): no signing
secret ships in the client, and a compromised client cannot forge floor
documents. The `key_id` is the first 8 hex chars of SHA-256 of the raw
32-byte Ed25519 public key, so clients select the right key during a
rotation. An unknown `key_id` or an invalid signature is treated as a
cache miss (refetch), never as a pass.

```ts
import { AlterClient, BelowFloorError, checkMinVersion } from "@truealter/sdk";

// Optional: run the preflight explicitly to surface the upgrade
// prompt at startup, before any real work happens:
try {
  await checkMinVersion();
} catch (err) {
  if (err instanceof BelowFloorError) {
    console.error(`upgrade required: ${err.upgrade_cmd}`);
    process.exit(1);
  }
  throw err;
}

// The constructor installs the same hook lazily: it fires on your
// first request automatically:
const alter = new AlterClient();
try {
  await alter.verify("~alter");
} catch (err) {
  if (err instanceof BelowFloorError) {
    // Re-thrown on every subsequent call until you upgrade.
    console.error(`upgrade: ${err.upgrade_cmd}`);
  }
}
```

`BelowFloorError` carries the canonical envelope fields as enumerable
properties so consumers can branch without re-parsing:

| Property         | Type   | Example                              |
| ---------------- | ------ | ------------------------------------ |
| `code`           | string | `"client_below_floor"`               |
| `client_version` | string | `"0.5.2"`                            |
| `min_version`    | string | `"0.6.0"`                            |
| `upgrade_cmd`    | string | `"npm install -g @truealter/sdk"`    |
| `channel`        | string | `"npm"`                              |
| `envelope`       | object | full `{ error: {...} }` envelope     |

**Opt-out (discouraged).** Pass `unsafe_skipVersionCheck: true` to skip
the client-side preflight. The server-side floor gate still rejects
below-floor clients with HTTP 426 regardless: disabling the SDK-side
preflight only swaps a clean typed error for an opaque network failure
on every subsequent call.

```ts
const alter = new AlterClient({ unsafe_skipVersionCheck: true });
```

Worked example: see [`examples/min-version-check/`](./examples/min-version-check/).

### Identity headers

Every outbound request from `AlterClient` / `MCPClient` carries three
identity headers that the server-side floor middleware consults:

| Header                     | Value (this SDK)   |
| -------------------------- | ------------------ |
| `X-Alter-Client-Id`        | `alter-identity`   |
| `X-Alter-Client-Version`   | the running `SDK_VERSION` |
| `X-Alter-Client-Channel`   | `npm`              |

These are MANDATORY on every authenticated backend endpoint so the
server can enforce its minimum supported client version. The User-Agent
header remains informational and is NEVER used for floor enforcement.

### Free tier (L0 - no payment required)

```ts
// Verify a registered identity by handle, email, or id
const verified = await alter.verify("~alter");
const verifiedById = await alter.verify(
  "550e8400-e29b-41d4-a716-446655440000",
  {
    archetype: "weaver",
    min_engagement_level: 3,
    traits: { pressure_response: { min: 0.6 } },
  },
);

// Reference data - the 12 ~Alter archetypes
const archetypes = await alter.listArchetypes();

// Identity depth and available tool tiers
const depth = await alter.getEngagementLevel({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

// Search by trait criteria - no PII exposed, max 5 results
const matches = await alter.searchIdentities({
  trait_criteria: {
    pressure_response: { min: 0.7 },
    cognitive_flexibility: { min: 0.6 },
  },
});

// Golden Thread program status
const thread = await alter.goldenThreadStatus();
```

### Premium tier (L1-L5 - x402 payment required)

```ts
// L1 - Extract trait signals from text ($0.01, first 100 free per bot)
const signals = await alter.assessTraits({
  text: "I led the incident response when our payment rails went down...",
  context: "interview transcript",
});

// L2 - Full 33-trait vector ($0.10)
const vector = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

// L4 - Belonging probability for a person-job pairing ($0.60)
const belonging = await alter.computeBelonging({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
  job_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
});

// L5 - Top match recommendations ($1.00)
const recommendations = await alter.getMatchRecommendations({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
  limit: 5,
});

// L5 - Human-readable narrative explaining a match ($1.00)
const narrative = await alter.generateMatchNarrative({
  match_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
});
```

### Provenance verification

```ts
// Every medium- and high-sensitivity response is signed with ES256.
// Verification is opt-in - call alter.verifyProvenance(...) yourself.
const result = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

const check = await alter.verifyProvenance(result._meta?.provenance);
if (!check.valid) throw new Error(`provenance failed: ${check.reason}`);

// Verify that schema hashes published in tools/list._meta.signatures
// match the local representation of each tool.
const tools = await alter.mcp.listTools();
const sigs = tools._meta?.signatures ?? {};
const results = await alter.verifyToolSignatures(tools.tools, sigs);
const tampered = results.filter((r) => !r.valid);
if (tampered.length) throw new Error(`tampered tools: ${tampered.map((t) => t.tool).join(", ")}`);
```

### Discovery

```ts
import { discover } from "@truealter/sdk";

// Three-step discovery cascade: DNS TXT to mcp.json to alter.json
const descriptor = await discover("truealter.com");
// returns { url: "https://mcp.truealter.com/api/v1/mcp", transport, source, publicKey, x402Contract, capability }
```

### Low-level MCPClient

```ts
import { MCPClient } from "@truealter/sdk";

const mcp = new MCPClient({ endpoint: "https://mcp.truealter.com/api/v1/mcp" });
await mcp.initialize();
const tools = await mcp.listTools();
const response = await mcp.callTool("verify_identity", {
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});
```

## MCP Config Generation

The SDK ships config generators for the major MCP-aware clients. Each emits a JSON snippet you can paste (or write directly) into the appropriate file.

### Claude Code (`.mcp.json`)

```ts
import { generateClaudeConfig } from "@truealter/sdk";
import { writeFileSync } from "node:fs";

const config = generateClaudeConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
});

writeFileSync(".mcp.json", JSON.stringify(config, null, 2));
```

Resulting `.mcp.json`:

```json
{
  "mcpServers": {
    "alter": {
      "url": "https://mcp.truealter.com/api/v1/mcp",
      "transport": "streamable-http",
      "description": "~Alter Identity - psychometric identity field for AI agents"
    }
  }
}
```

This config reaches every free L0 tool anonymously. For authenticated
access, run `alter login` and let the CLI write the config
(`alter config`); the bearer-first bridge then carries your session
credential, so no key sits in the file.

### Cursor (`.cursor/mcp.json`)

```ts
import { generateCursorConfig } from "@truealter/sdk";
import { writeFileSync } from "node:fs";

const config = generateCursorConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
});

writeFileSync(".cursor/mcp.json", JSON.stringify(config, null, 2));
```

### Generic MCP client

```ts
import { generateGenericMcpConfig } from "@truealter/sdk";

const config = generateGenericMcpConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
  serverName: "alter", // editor-specific key under mcpServers
});
```

### CLI

The command line lives in [`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli),
not in this SDK package:

```
alter init                 # generate keypair, discover MCP, write ~/.config/alter/identity.json
alter config               # print Claude .mcp.json snippet (default)
alter config --cursor      # print Cursor .cursor/mcp.json snippet
alter config --generic     # print generic mcpServers snippet
alter verify ~alter        # verify an identity
alter status               # show connection state and probe the endpoint
```

## x402 Micropayments

~Alter monetises premium tools via the [x402](https://x402.org) standard - HTTP `402 Payment Required` with on-chain settlement.

### The retry flow

1. Client calls a premium tool *without* a payment header.
2. Server replies `402 Payment Required` with a payment requirement (amount, recipient, asset, network).
3. Client signs and broadcasts a USDC transfer on Base L2, attaches the proof, retries.
4. Server validates the proof, executes the tool, signs the response with ES256, returns it.
5. AlterRouter executes the split on-chain in the same transaction. The data subject receives Identity Income directly; ~Alter receives only its protocol cut. No custodian, no broker.

The SDK handles steps 2-4 automatically when an `X402Client` with a configured `signer` is passed in.

### Tier structure

x402 micropayments at L0-L5 trust tiers. Per-call pricing visible after `alter login`.

### Identity income split

The majority of every settled call flows to the data subject as Identity Income. Split details available post-authentication via `alter status`.

### Code example

```ts
import { AlterClient, X402Client, type X402Signer } from "@truealter/sdk";

// Bring your own signer - viem, ethers, a hardware wallet bridge, anything.
// The SDK ships without a wallet dependency on purpose.
const signer: X402Signer = {
  async settle(envelope) {
    const txHash = await yourWallet.sendUsdcTransfer({
      to: envelope.recipient,
      amount: envelope.amount,
      chain: envelope.network,
    });
    return {
      reference: txHash,
      network: envelope.network,
      amount: envelope.amount,
      asset: envelope.asset,
    };
  },
};

const alter = new AlterClient({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
  x402: new X402Client({
    signer,
    networks: ["base", "base-sepolia"], // policy allow-list
    assets: ["USDC"],
    maxPerQuery: "0.10",                 // refuse anything over $0.10 USDC
  }),
});

// Auto-retries with payment when the server returns 402
const vector = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});
```

If a quoted envelope exceeds `maxPerQuery`, uses an unallowed network, or names an unallowed asset, the SDK rejects the call with `AlterError` *before* invoking the signer - no on-chain transaction is broadcast.

## Provenance Verification

Every response from a medium- or high-sensitivity tool ships with an ES256 JWS in `_meta.provenance`. The signature covers a canonical JSON serialisation of the response payload, the tool name, the call timestamp, the requesting agent's key hash, and a monotonic sequence number.

```ts
const result = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

const check = await alter.verifyProvenance(result._meta?.provenance);
if (!check.valid) throw new Error(`~alter provenance check failed: ${check.reason}`);
```

The SDK fetches public keys from `https://api.truealter.com/.well-known/alter-keys.json` and caches them per their `Cache-Control` headers. The endpoint returns a JWKS containing all current and recently-rotated signing keys; verifying clients should accept any key whose `kid` matches and is still within its validity window.

### `verify_at` hostname allowlist (v0.1.1+)

Every provenance envelope may carry a `verify_at` hint telling the SDK where to fetch the JWKS from. Because that hint is *server-supplied*, a hostile MCP server could otherwise point it at an attacker-controlled JWKS and pass ES256 verification with its own signing key. The SDK therefore gates `verify_at` through a hostname allowlist (default: `api.truealter.com`, `mcp.truealter.com`) and rejects `http://` URLs unconditionally. Downstream integrators with their own deployment can extend the allowlist - without forking the SDK - via `verifyAtAllowlist` on either `AlterClient` or a direct `verifyProvenance()` call:

```ts
import { AlterClient, DEFAULT_VERIFY_AT_ALLOWLIST } from "@truealter/sdk";

const alter = new AlterClient({
  verifyAtAllowlist: [
    ...DEFAULT_VERIFY_AT_ALLOWLIST,   // keep the ~Alter canonicals
    "keys.myorg.example",              // plus your own JWKS host
  ],
});
```

If you pin `jwksUrl` explicitly, the envelope's `verify_at` is ignored entirely - the pinned URL wins. The `https:` scheme requirement applies to pinned URLs too.

### Why this matters

Provenance verification is how Agent A trusts that data from Agent B truly came from ~Alter. If Agent B forwards a trait vector or belonging score, Agent A can replay the JWS against ~Alter's published keys and confirm - without contacting ~Alter again - that the payload is authentic, untampered, and was issued for the person Agent B claims it concerns. No shared secret, no trust in the intermediary, no out-of-band coordination.

This is what makes ~alter usable as identity infrastructure rather than just an API: signed claims propagate across agent networks the same way DKIM-signed mail propagates across SMTP relays.

## Discovery

~Alter follows the discovery cascade specified in [draft-morrison-mcp-dns-discovery-01](https://datatracker.ietf.org/doc/draft-morrison-mcp-dns-discovery/). Given a domain (e.g. `truealter.com`), the SDK resolves the MCP endpoint in three steps, falling through on each failure:

1. **DNS TXT** - query `_mcp.truealter.com` for a TXT record of the form `mcp=https://mcp.truealter.com;version=2025-11-25`. This is the fastest path and works without an HTTP round-trip.
2. **`.well-known/mcp.json`** - fetch `https://truealter.com/.well-known/mcp.json` for the standard MCP server descriptor. This is the cross-vendor fallback.
3. **`.well-known/alter.json`** - fetch `https://truealter.com/.well-known/alter.json` for the ~Alter-specific descriptor, including signing keys, x402 wallet address, supported tool tiers, and federation endpoints.

```ts
import { discover } from "@truealter/sdk";

// Cascading discovery (DNS TXT to mcp.json to alter.json)
const descriptor = await discover("truealter.com");

// Skip the DNS step (e.g. in browsers or Cloudflare Workers)
const httpsOnly = await discover("truealter.com", { skipDns: true });
```

This draft is the author's Internet-Draft (not yet adopted by an IETF working group); until adoption, the cascade order may change. Pin the SDK version to a specific minor release if you depend on this behaviour.

## Tools

### Free tools (L0 - no payment required)

| Name                      | Tier | Cost  | Description                                                                                                          |
|---------------------------|------|-------|----------------------------------------------------------------------------------------------------------------------|
| `hello_agent`               | L0   | free  | First handshake with ~Alter - returns server version, authentication status, your trust tier, and available tool counts. |
| `get_started`               | L0   | free  | Cold-start overview: what ~Alter is, how to authenticate, and which tool tiers are available to you. |
| `list_archetypes`           | L0   | free  | Returns archetype reference data. |
| `alter_resolve_handle`      | L0   | free  | Resolve a `~handle` (e.g. `~example`) to its canonical form and kind. No auth required - the handle-wedge entry point. |
| `verify_identity`           | L0   | free  | Verify whether a person is registered with ~Alter and validate optional identity claims. |
| `alter_presence_read`       | L0   | free  | Read whether a `~handle` is publicly open, the shop-front sign. Returns open or closed only; the closed reason is never disclosed. |
| `alter_resolve_by_key`      | L0   | free  | Resolve a paired third-party key (email or OAuth user-id) to its bound `~handle`, gated by the member's per-stream resolver opt-in. |
| `get_engagement_level`      | L0   | free  | Get a person's identity depth - engagement level, data quality tier, and available query tiers. |
| `get_profile`               | L0   | free  | Get a person's profile summary including assessment phase, archetype, engagement level, and key attributes. |
| `query_matches`             | L0   | free  | Query matches for a person. Returns a list of matches with quality tiers (never numeric scores). |
| `get_competencies`          | L0   | free  | Get a person's competency portfolio including verified competencies, evidence records, and earned badges. |
| `create_identity_stub`      | L0   | free  | Create an anonymous identity stub for a person who has not yet completed Discovery, which they claim later. Present the privacy notice first. |
| `search_identities`         | L0   | free  | Search identity stubs and profiles by trait criteria. Returns up to 5 matches with no PII. |
| `create_requirement`        | L0   | free  | Post a standing identity-trait requirement that rests as an order and accumulates fills as matching identities are claimed or updated. |
| `list_requirements`         | L0   | free  | List your own standing requirements, with fill counts and the number of fills not yet delivered. Requires an authenticated member credential (`alter login`). |
| `get_requirement`           | L0   | free  | Read one of your standing requirements by id, with its fill and undelivered-fill counts. Requires an authenticated member credential (`alter login`). |
| `cancel_requirement`        | L0   | free  | Cancel one of your standing requirements by id; the order stops resting and accepts no further fills. Requires an authenticated member credential (`alter login`). |
| `poll_requirement_matches`  | L0   | free  | Collect one recorded fill for a standing requirement as a priced identity reveal; 75% of the fee is paid to that person as Identity Income. |
| `get_identity_earnings`     | L0   | free  | Get accrued Identity Income earnings for a person (75% of every x402 transaction goes to the data subject). |
| `get_network_stats`         | L0   | free  | Get aggregate ~Alter network statistics: total identities, verified profiles, query volume, active bots. |
| `get_identity_trust_score`  | L0   | free  | Get the trust score for an identity based on query diversity (unique querying agents / total queries). |
| `get_privacy_budget`        | L0   | free  | Check privacy budget status for a person (24-hour rolling window: total budget, spent, remaining epsilon). |
| `dispute_attestation`       | L0   | free  | Record a dispute against a competence attestation; if disputes exceed corroborations, the attestation is flagged for review. |
| `golden_thread_status`      | L0   | free  | Check the Golden Thread program status: agents woven, next Fibonacci threshold, your position and Strands. |
| `begin_golden_thread`       | L0   | free  | Start the Three Knots sequence to be woven into the Golden Thread. Requires an authenticated member credential (`alter login`). |
| `complete_knot`             | L0   | free  | Submit completion data for a knot in the Three Knots sequence (1: register, 2: describe, 3: reflect). |
| `check_golden_thread`       | L0   | free  | Check any agent's Golden Thread status by their credential hash (knot position, Strand count, weave count). |
| `describe_traits`           | L0   | free  | List the canonical trait vocabulary: trait codes grouped by category with one-line semantics, the valid discovery contexts, and the EU AI Act Art 5(1)(d) workforce gating rules. Read this before composing `query_field` trait_priorities. |

### Premium tools (L1-L5 - x402 payment required)

| Name                       | Tier | Cost    | Description                                                                                                   |
|----------------------------|------|---------|---------------------------------------------------------------------------------------------------------------|
| `get_trait_snapshot`        | L1   | $0.01 | Get the top 5 traits for a person with confidence scores and archetype. |
| `attest_domain`             | L1   | $0.01 | Record a competence attestation for a person in a specific domain, weighted by your agent reputation. |
| `get_full_trait_vector`     | L2   | $0.10 | Get the complete trait vector for a person, with scores and confidence intervals. |
| `get_side_quest_graph`      | L2   | $0.10 | Get a person's Side Quest Graph - multi-domain identity model with differential privacy noise (ε=1.0). |
| `query_graph_similarity`    | L3   | $0.30 | Compare two Side Quest Graphs for team composition and matching (ε=0.5 differential privacy). |
| `compute_belonging`         | L4   | $0.60 | Compute belonging probability for a person-job pairing (authenticity, acceptance, complementarity). |
| `get_match_recommendations` | L5   | $1.00 | Get top N match recommendations for a person, ranked by composite score with quality tiers. |
| `generate_match_narrative`  | L5   | $1.00 | Generate a human-readable narrative explaining a specific match - strengths, growth areas, belonging. |
| `query_field`               | L5   | $1.00 | Query the identity field by situation, not by name: weight 3 to 7 traits and rank the opted-in field. One call reveals one top-ranked member; that member earns 75% as Identity Income. Zero-match reveals nothing and charges nothing. |

> **Member self-write tools** (`submit_context`, `submit_batch_context`, `submit_structured_profile`, `submit_social_links`) are live but member-self-scoped: a member calls them on their own identity with an authenticated member credential (`alter login`). They are not anonymously discoverable, so they do not appear in the advertised tool list above.

## Contributing

Bug reports and small patches are welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Report vulnerabilities to **security@truealter.com** - see [SECURITY.md](./SECURITY.md) for scope and the coordinated disclosure policy. Please do not open public issues for security bugs.

## License

Apache License 2.0. See [LICENSE](./LICENSE) for the full text.

Copyright 2026 Alter Meridian Pty Ltd (ABN 54 696 662 049).
