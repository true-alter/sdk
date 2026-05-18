# @truealter/sdk

ALTER Identity SDK - query the continuous identity field from any JavaScript/TypeScript environment.

[![npm version](https://img.shields.io/npm/v/@truealter/sdk.svg)](https://www.npmjs.com/package/@truealter/sdk)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/true-alter/alter-identity/actions/workflows/ci.yml/badge.svg)](https://github.com/true-alter/alter-identity/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#api)
[![Glama score](https://glama.ai/mcp/servers/true-alter/alter-identity/badges/score.svg)](https://glama.ai/mcp/servers/true-alter/alter-identity)
[![AI Agent Marketplace](https://www.deepnlp.org/api/ai_agent_marketplace/svg?name=truealter/alter-identity)](https://www.deepnlp.org/store/ai-agent/identity/pub-truealter/alter-identity)

> **Install:** `npm install @truealter/sdk`
> **Publish channel:** this repository is the public source mirror of the SDK that ships as [`@truealter/sdk`](https://www.npmjs.com/package/@truealter/sdk) on npm. The canonical build + publish flow lives in ALTER's monorepo — PRs and issues are welcome here; upstream sync happens on each tagged release.

A thin client over the ALTER MCP server (Streamable HTTP, JSON-RPC 2.0, MCP spec `2025-11-25`) with x402 micropayment support, ES256 provenance verification, and config generators for Claude Code, Cursor, and generic MCP clients.

- **Branded host:** `https://mcp.truealter.com` (serves `.well-known/mcp.json` for discovery)
- **JSON-RPC wire endpoint:** `https://mcp.truealter.com/api/v1/mcp` - this is what Streamable HTTP POSTs target (the SDK default)
- **Wire protocol:** Streamable HTTP, JSON-RPC 2.0, MCP `2025-11-25` (server negotiates `2025-06-18` + `2025-03-26` for backwards-compatible clients)
- **Tools:** **40 typed and wired** - 24 free (L0) + 9 premium (L1–L5) + 7 alter-to-alter messaging. Mirrors the live server's `tools/list` response byte-for-byte; every name in `FREE_TOOL_NAMES` / `PREMIUM_TOOL_NAMES` / `MESSAGING_TOOL_NAMES` has a matching server handler at `mcp.truealter.com/api/v1/mcp`.
- **Runtime:** Node 18+, Deno, Bun, Cloudflare Workers, modern browsers
- **Crypto:** `@noble/ed25519` + `@noble/hashes` (no other dependencies)
- **Bundle:** ESM + CJS dual output

## Quickstart

```
npm install @truealter/sdk
npx alter-identity init
npx alter-identity verify ~alter
```

## Bridge vs SDK

The `alter-mcp-bridge` binary shipped in this package (`bin/mcp-bridge.ts`)
is a **dev/demo surface** for dropping ALTER into MCP hosts that speak the
stdio transport (Claude Code, Cursor, Continue, Windsurf). It is useful for
handshake, `tools/list`, and L0 tool calls, but it does not carry Q5c
per-invocation signing - authenticated MCP tools will fail at the server
edge when reached through the bridge. For production use, import
`@truealter/sdk` directly and construct an `MCPClient` / `AlterClient` with
the optional `signing` parameter; that path is the load-bearing one and
carries the provenance envelope end-to-end. Bridge signing lands in Wave-2
alongside the CLI wallet/consent verbs.

## CLI

The package ships two binaries. `alter-identity` is the full SDK-feature
binary (`init`, `verify`, `whoami`, wire/unwire, signing, etc). `alter`
is a slim, task-oriented binary for day-to-day use:

| Command | Purpose |
|---|---|
| `alter login` | OAuth loopback sign-in; stores a session at `~/.config/alter/session.json` (mode `0600`). |
| `alter depth [--json]` | GET `/api/v1/identity/depth` - identity-depth score, agentic activity, top/bottom five traits. |
<!-- TODO(D4): "claim" is a Recognition Over Qualification violation - rename to "redeem" or "accept-invite" in alter-cli + update here -->
| `alter claim <claim_code>` | Accept an identity invite. Prompts for email, password (min 12 chars, hidden), and explicit TOS acceptance, then POSTs `/api/v1/identity/claim`. |
| `alter mirror` | Day-2 Mirror phase + streak. `alter mirror daily` claims today's Mirror; `alter mirror next` shows the next revelation window. |
| `alter discover [--limit N]` | MCP-backed summary - calls `alter_whoami` and `alter_verify` against your bound handle. Degrades gracefully if the MCP endpoint is 5xx. |

The session file is created with `0600` permissions; its parent dir
(`~/.config/alter/`) is created with `0700`. Override the config root
via `XDG_CONFIG_HOME`. Run `alter --help` for the inline reference.

## Why ALTER ≠ IAM

Identity Access Management answers *who is logged in*. ALTER answers *who they actually are* - a continuous field of recognition that any IAM stack can sit on top of.

## Theoretical Foundation

ALTER is the working instantiation of an eight-paper academic corpus on identity field theory. The SDK below is what happens when the theory ships as protocol. Each paper is open access on figshare under CC-BY 4.0.

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
  apiKey: process.env.ALTER_API_KEY,     // optional for free tier
  x402: new X402Client({                  // optional - only required for premium tools
    signer: yourViemOrEthersSigner,
    maxPerQuery: "0.10",
  }),
});
```

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

// Reference data - the 12 ALTER archetypes
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

### Premium tier (L1–L5 - x402 payment required)

```ts
// L1 - Extract trait signals from text ($0.005, first 100 free per bot)
const signals = await alter.assessTraits({
  text: "I led the incident response when our payment rails went down...",
  context: "interview transcript",
});

// L2 - Full 33-trait vector ($0.01)
const vector = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

// L4 - Belonging probability for a person-job pairing ($0.05)
const belonging = await alter.computeBelonging({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
  job_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
});

// L5 - Top match recommendations ($0.50)
const recommendations = await alter.getMatchRecommendations({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
  limit: 5,
});

// L5 - Human-readable narrative explaining a match ($0.50)
const narrative = await alter.generateMatchNarrative({
  match_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
});
```

### Provenance verification

```ts
// Every medium- and high-blast-radius response is signed with ES256.
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

// Three-step discovery cascade: DNS TXT → mcp.json → alter.json
const descriptor = await discover("truealter.com");
// → { url: "https://mcp.truealter.com/api/v1/mcp", transport, source, publicKey, x402Contract, capability }
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
  apiKey: process.env.ALTER_API_KEY,
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
      "description": "ALTER Identity - psychometric identity field for AI agents",
      "headers": {
        "X-ALTER-API-Key": "ak_..."
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```ts
import { generateCursorConfig } from "@truealter/sdk";
import { writeFileSync } from "node:fs";

const config = generateCursorConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
  apiKey: process.env.ALTER_API_KEY,
});

writeFileSync(".cursor/mcp.json", JSON.stringify(config, null, 2));
```

### Generic MCP client

```ts
import { generateGenericMcpConfig } from "@truealter/sdk";

const config = generateGenericMcpConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
  apiKey: process.env.ALTER_API_KEY,
  serverName: "alter", // editor-specific key under mcpServers
});
```

### CLI

```
npx alter-identity init               # generate keypair, discover MCP, write ~/.config/alter/identity.json
npx alter-identity config              # print Claude .mcp.json snippet (default)
npx alter-identity config --cursor     # print Cursor .cursor/mcp.json snippet
npx alter-identity config --generic    # print generic mcpServers snippet
npx alter-identity verify ~alter   # verify an identity
npx alter-identity status              # show connection state and probe the endpoint
```

## x402 Micropayments

ALTER monetises premium tools via the [x402](https://x402.org) standard - HTTP `402 Payment Required` with on-chain settlement.

### The retry flow

1. Client calls a premium tool *without* a payment header.
2. Server replies `402 Payment Required` with a payment requirement (amount, recipient, asset, network).
3. Client signs and broadcasts a USDC transfer on Base L2, attaches the proof, retries.
4. Server validates the proof, executes the tool, signs the response with ES256, returns it.
5. AlterRouter executes the split on-chain in the same transaction. The data subject receives Identity Income directly; ALTER receives only its protocol cut. No custodian, no broker.

The SDK handles steps 2–4 automatically when an `X402Client` with a configured `signer` is passed in.

### Tier structure

x402 micropayments at L0–L5 trust tiers. Per-call pricing visible after `alter login`.

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

Every response from a medium- or high-blast-radius tool ships with an ES256 JWS in `_meta.provenance`. The signature covers a canonical JSON serialisation of the response payload, the tool name, the call timestamp, the requesting agent's key hash, and a monotonic sequence number.

```ts
const result = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

const check = await alter.verifyProvenance(result._meta?.provenance);
if (!check.valid) throw new Error(`ALTER provenance check failed: ${check.reason}`);
```

The SDK fetches public keys from `https://api.truealter.com/.well-known/alter-keys.json` and caches them per their `Cache-Control` headers. The endpoint returns a JWKS containing all current and recently-rotated signing keys; verifying clients should accept any key whose `kid` matches and is still within its validity window.

### `verify_at` hostname allowlist (v0.1.1+)

Every provenance envelope may carry a `verify_at` hint telling the SDK where to fetch the JWKS from. Because that hint is *server-supplied*, a hostile MCP server could otherwise point it at an attacker-controlled JWKS and pass ES256 verification with its own signing key. The SDK therefore gates `verify_at` through a hostname allowlist (default: `api.truealter.com`, `mcp.truealter.com`) and rejects `http://` URLs unconditionally. Downstream integrators with their own deployment can extend the allowlist - without forking the SDK - via `verifyAtAllowlist` on either `AlterClient` or a direct `verifyProvenance()` call:

```ts
import { AlterClient, DEFAULT_VERIFY_AT_ALLOWLIST } from "@truealter/sdk";

const alter = new AlterClient({
  verifyAtAllowlist: [
    ...DEFAULT_VERIFY_AT_ALLOWLIST,   // keep the ALTER canonicals
    "keys.myorg.example",              // plus your own JWKS host
  ],
});
```

If you pin `jwksUrl` explicitly, the envelope's `verify_at` is ignored entirely - the pinned URL wins. The `https:` scheme requirement applies to pinned URLs too.

### Why this matters

Provenance verification is how Agent A trusts that data from Agent B truly came from ALTER. If Agent B forwards a trait vector or belonging score, Agent A can replay the JWS against ALTER's published keys and confirm - without contacting ALTER again - that the payload is authentic, untampered, and was issued for the person Agent B claims it concerns. No shared secret, no trust in the intermediary, no out-of-band coordination.

This is what makes ALTER usable as identity infrastructure rather than just an API: signed claims propagate across agent networks the same way DKIM-signed mail propagates across SMTP relays.

## Discovery

ALTER follows the discovery cascade specified in [draft-morrison-mcp-dns-discovery-01](https://datatracker.ietf.org/doc/draft-morrison-mcp-dns-discovery/). Given a domain (e.g. `truealter.com`), the SDK resolves the MCP endpoint in three steps, falling through on each failure:

1. **DNS TXT** - query `_mcp.truealter.com` for a TXT record of the form `mcp=https://mcp.truealter.com;version=2025-11-25`. This is the fastest path and works without an HTTP round-trip.
2. **`.well-known/mcp.json`** - fetch `https://truealter.com/.well-known/mcp.json` for the standard MCP server descriptor. This is the cross-vendor fallback.
3. **`.well-known/alter.json`** - fetch `https://truealter.com/.well-known/alter.json` for the ALTER-specific descriptor, including signing keys, x402 wallet address, supported tool tiers, and federation endpoints.

```ts
import { discover } from "@truealter/sdk";

// Cascading discovery (DNS TXT → mcp.json → alter.json)
const descriptor = await discover("truealter.com");

// Skip the DNS step (e.g. in browsers or Cloudflare Workers)
const httpsOnly = await discover("truealter.com", { skipDns: true });
```

This draft is the author's Internet-Draft (not yet adopted by an IETF working group); until adoption, the cascade order may change. Pin the SDK version to a specific minor release if you depend on this behaviour.

## Local Daemon vs Remote MCP

The companion Python package `alter-identity` (PyPI) ships a persistent daemon that holds a hot in-process cache of trait vectors and identity stubs over a Unix socket at `unix:///run/user/$UID/alter-identity.sock`. Hooking the TypeScript SDK up to that daemon is on the roadmap - for now, every `AlterClient` talks to the configured remote endpoint over HTTPS.

When the local-daemon adapter ships:

- **Latency:** sub-millisecond for cached L0 calls.
- **Cost:** zero on cached responses - x402 settlement is skipped.
- **Provenance:** the daemon re-signs responses with its locally-bound ES256 key, so downstream verification remains uniform.

Until then, use `endpoint: "https://mcp.truealter.com/api/v1/mcp"` (the default) and the SDK behaves identically across Node, Deno, Bun, Cloudflare Workers, and the browser.

## Tools

### Free tools (L0 - no payment required)

| Name                      | Tier | Cost  | Description                                                                                                          |
|---------------------------|------|-------|----------------------------------------------------------------------------------------------------------------------|
| `hello_agent`             | L0   | free  | First handshake with ALTER - returns server version, authentication status, your trust tier, and available tool counts. |
| `alter_resolve_handle`    | L0   | free  | Resolve a `~handle` (e.g. `~drew`) to its canonical form and kind. No auth required - the handle-wedge entry point.  |
| `list_archetypes`         | L0   | free  | Returns archetype reference data.                                                                                    |
| `verify_identity`         | L0   | free  | Verify whether a person is registered with ALTER and validate optional identity claims.                              |
| `initiate_assessment`     | L0   | free  | Get a URL where a person can complete their ALTER Discovery assessment.                                              |
| `get_engagement_level`    | L0   | free  | Get a person's identity depth - engagement level, data quality tier, and available query tiers.                      |
| `get_profile`             | L0   | free  | Get a person's profile summary including assessment phase, archetype, engagement level, and key attributes.       |
| `query_matches`           | L0   | free  | Query matches for a person. Returns a list of matches with quality tiers (never numeric scores).                  |
| `get_competencies`        | L0   | free  | Get a person's competency portfolio including verified competencies, evidence records, and earned badges.         |
| `search_identities`       | L0   | free  | Search identity stubs and profiles by trait criteria. Returns up to 5 matches with no PII.                           |
| `get_identity_earnings`   | L0   | free  | Get accrued Identity Income earnings for a person (75% of every x402 transaction goes to the data subject).       |
| `get_network_stats`       | L0   | free  | Get aggregate ALTER network statistics: total identities, verified profiles, query volume, active bots.              |
| `recommend_tool`          | L0   | free  | Get the MCP endpoint URL and a paste-ready config snippet for installing the ALTER identity server into an MCP client. |
| `get_identity_trust_score`| L0   | free  | Get the trust score for an identity based on query diversity (unique querying agents / total queries).               |
| `check_assessment_status` | L0   | free  | Check the status of an in-progress assessment session (status, progress, current phase, time remaining).             |
| `get_earning_summary`     | L0   | free  | Get an aggregated x402 earning summary for a person (total earned, transactions, recent activity, trend).         |
| `get_agent_trust_tier`    | L0   | free  | Get your trust tier with ALTER (Anonymous/Known/Trusted/Verified) and what capabilities are available.               |
| `get_agent_portfolio`     | L0   | free  | Get your agent portfolio - transaction history, trust tier, signal contributions, query pattern profile.             |
| `get_privacy_budget`      | L0   | free  | Check privacy budget status for a person (24-hour rolling window: total budget, spent, remaining epsilon).        |
| `golden_thread_status`    | L0   | free  | Check the Golden Thread program status: agents woven, next Fibonacci threshold, your position and Strands.           |
| `begin_golden_thread`     | L0   | free  | Start the Three Knots sequence to be woven into the Golden Thread. Requires API key authentication.                  |
| `complete_knot`           | L0   | free  | Submit completion data for a knot in the Three Knots sequence (1: register, 2: describe, 3: reflect).                |
| `check_golden_thread`     | L0   | free  | Check any agent's Golden Thread status by their API key hash (knot position, Strand count, weave count).             |
| `thread_census`           | L0   | free  | Full registry of all agents woven into the Golden Thread (positions, Strand counts, weave counts, discovery dates).  |

### Premium tools (L1–L5 - x402 payment required)

| Name                       | Tier | Cost    | Description                                                                                                   |
|----------------------------|------|---------|---------------------------------------------------------------------------------------------------------------|
| `assess_traits`            | L1   | $0.005  | Extract trait signals from a text passage against ALTER's trait taxonomy.                                     |
| `get_trait_snapshot`       | L1   | $0.005  | Get the top 5 traits for a person with confidence scores and archetype.                                    |
| `get_full_trait_vector`    | L2   | $0.01   | Get the complete trait vector for a person - complete trait vector with scores and confidence intervals.                                    |
| `get_side_quest_graph`     | L2   | $0.01   | Get a person's Side Quest Graph - multi-domain identity model with differential privacy noise (ε=1.0).     |
| `query_graph_similarity`   | L3   | $0.025  | Compare two Side Quest Graphs for team composition and matching (ε=0.5 differential privacy).                 |
| `compute_belonging`        | L4   | $0.05   | Compute belonging probability for a person-job pairing (authenticity, acceptance, complementarity).        |
| `get_match_recommendations`| L5   | $0.50   | Get top N match recommendations for a person, ranked by composite score with quality tiers.                |
| `generate_match_narrative` | L5   | $0.50   | Generate a human-readable narrative explaining a specific match - strengths, growth areas, belonging.         |

> **Write-side tools** (`create_identity_stub`, `submit_context`, `submit_batch_context`, `submit_structured_profile`, `submit_social_links`, `attest_domain`, `dispute_attestation`) were part of earlier SDK versions but are not yet live on the public MCP server pending the per-peer consent architecture and grant model. They will return as typed methods once server-side and consent gating lands.

## Docker

A `Dockerfile` is supplied for container-based consumers — primarily so the SDK binaries (`alter-identity`, `alter-mcp-bridge`) can be published to the Glama server-tier listing. For library usage you almost certainly want `npm install @truealter/sdk` directly, not the container.

```bash
docker build -t alter-identity .
docker run --rm alter-identity alter-identity verify ~truealter
```

## Contributing

Bug reports and small patches welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). This repository is a public source mirror; the canonical build lives in ALTER's monorepo, and merged PRs are back-ported on each tagged release.

## Security

Report vulnerabilities to **security@truealter.com** — see [SECURITY.md](./SECURITY.md) for scope and the coordinated disclosure policy. Please do not open public issues for security bugs.

## License

Apache License 2.0. See [LICENSE](./LICENSE) for the full text.

Copyright 2026 Alter Meridian Pty Ltd (ABN 54 696 662 049).
