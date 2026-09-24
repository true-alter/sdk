<div align="center">

<img src="https://raw.githubusercontent.com/true-alter/sdk/main/docs/alter-mark.svg" alt="" height="96">

# ~alter SDK

**Read identity from your own code with the person's consent and their cut**

[![npm](https://img.shields.io/npm/v/@truealter/sdk?label=%40truealter%2Fsdk&color=C9A84C&style=flat-square)](https://www.npmjs.com/package/@truealter/sdk)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-555?style=flat-square)](#install)
[![Runtimes](https://img.shields.io/badge/runs%20on-Node%20%7C%20Deno%20%7C%20Bun%20%7C%20Workers%20%7C%20browser-555?style=flat-square)](#install)
[![Licence](https://img.shields.io/badge/licence-Apache--2.0-555?style=flat-square)](./LICENSE)

[What is ~alter?](#what-is-alter) · [Install](#install) · [From nothing to a paid read](#from-nothing-to-a-paid-read)

</div>

## What is ~alter?

Most people who read about ~Alter are here about their own identity, and you are
not. You are building something that has to know who its users are, which makes
you the party who asks, stores the answer, and carries it afterwards.

The asking is the cheap part. What comes after it is the encryption at rest, the
retention schedule, the access review, the deletion request that arrives long
after they stopped using you, and the notification you send if any of it ever
leaks. You carry all of that for data whose only source was somebody typing into
a box you built, unverified by anyone, and out of date from the day it was
entered.

~Alter is a record kept under a name the person owns, and what is in it was read
from what they have done rather than typed into a form. Your code reads that
record at the point it needs an answer, and holds none of it once the call
returns. The person decides in advance what your application is allowed to see,
which puts the consent conversation on their surface rather than on yours.

Checking that somebody exists costs nothing and discloses nothing past the fact
of them. A read that goes further is priced, and three quarters of what you pay
for it reaches the person whose record was read. You are buying an answer for as
long as you need it rather than taking custody of one.

<details><summary><b>I want to know more</b></summary><br><p>Your friends do not know you from a login. Neither does your family, or the people you work with, or your sports team. They know who you are from how you have shown up, over years. You may look and sound nothing like you did ten years ago and it is still you.</p><p>Software still asks the narrow question. A password at the login screen. A token in the app. Each one checks whether this is the right person, right now, at this exact spot, and then looks away. Everything in between is invisible to it, and that is almost all of your life. The AI tools made it worse, because one of them writes in your name now, and when somebody asks who allowed it, there is no answer anywhere on this machine.</p><p><b>One name, and the record under it is yours.</b> <code>~yourname</code> works at every tool that speaks the protocol, so nothing is set up twice and there is no key to paste, at any point. What is in the record was read from what you did, not typed into a box by you or guessed at by a model. You can cut off access to any of it with one command. No form, no review.</p><p><b>Being read pays you.</b> Anyone can check for free that your handle exists. Reading further, past the fact of you, costs the reader money, that money goes to you, and you decide who gets to read what. Collectives hold a record on the same terms, because it is one record at every scale and the same form holds you, your team, and your country. A union, a club, a trade body, or a group of people who have never met can vouch for their own members and be read the same way you are.</p><p><b>Threads are how you get somewhere.</b> A thread is something you are working towards. You take one on yourself, or ~Alter plants one from what it can already see, or a collective confers one on you. What gets read is the trail you leave while you are doing it, never a certificate at the end.</p><p>All of that is the short version of an argument set out properly, in eight chapters at <a href="https://truealter.com/origin">truealter.com/origin</a>. Its seventy-six predictions were each written so the data could come back and say no. Five of them did, and those five are still published alongside the rest.</p></details>

<details><summary><b>I want to check it myself</b></summary>

None of it needs taking on trust. Hand this to the AI you already use and
let it take you through in your own words.

```text
Go to truealter.com, find the genesis and the origin papers, and read all of
them. Then start a discussion with me in my own language, no jargon.

Ask me one question at a time and wait for my answer. Follow what I am curious
about, not the order the site is written in.

Do not only read the pages. Connect to their interface directly and call
get_started. That tells you where I am and what comes next, and we work the
rest of this from there.

If I have a ~handle I will give it to you. If I do not and I decide I want
one, set it up with me here.

What I want to understand is what ~Alter is, how it applies to me, and what it
means for everyone else. Find me somewhere in it, and not the version written
for people who work in technology. Find the life nearest mine and walk me
through it, including what it would cost me.

Try to prove them wrong. Go and find where they show their working, and if
something is unclear or does not hold up, say so.
```

</details>

## What is ~alter SDK?

It's a typed TypeScript client for that record, so your code can ask whether a
handle exists, read the traits the person has consented to share with you, and
settle a deeper read in USDC.

The front door is [`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli),
which is how somebody gets a handle in the first place and which carries the MCP
bridge. This package is what your application imports once they already have one.

Underneath, it's a thin client over ~Alter's MCP server, speaking MCP spec
`2025-11-25` over Streamable HTTP and JSON-RPC 2.0. It carries x402 settlement
and ES256 provenance verification, it depends on `@noble/ed25519` and
`@noble/hashes` and nothing else, and it ships both ESM and CJS.

Forty-seven tools are publicly advertised, and thirty-eight of those sit on the
free tier. Free is not the same as open. Twelve of the forty-seven answer a
caller holding no credential at all, and everything that reads an identity wants
a `~handle` first.

Your IAM stack answers who's logged in. It can sit on top of this without
changing.

## Install

```
npm install @truealter/sdk
```

Node 18 or newer. It also runs on Deno, Bun, Cloudflare Workers and modern
browsers, and it brings no wallet dependency of its own.

<details><summary><h3>The stdio bridge in here, and why not to build on it</h3></summary>

<p>This package also ships a stdio bridge at <code>bin/mcp-bridge.ts</code>, built to <code>dist/bin/mcp-bridge.js</code>, which the <code>alter</code> CLI launches by file path through its <code>mcp-bridge</code> subcommand. It is a dev and demo surface for dropping ~Alter into MCP hosts that speak stdio, and it handles the handshake, <code>tools/list</code> and free tool calls.</p><p>It does not carry ES256 per-invocation signing, so authenticated tools fail at the server edge when they are reached through it. Import the SDK directly and construct an <code>MCPClient</code> or <code>AlterClient</code> with the optional <code>signing</code> parameter instead. That path carries the provenance envelope end to end and is the one to build on. Bridge signing is planned.</p><p>There is no command-line binary in this package. The bridge entrypoint is not a published <code>bin</code>, and <code>alter --help</code> is the inline reference for the command line, which is distributed separately.</p></details>

## From nothing to a paid read

Step one runs with nothing at all. From step two you need a `~handle`, which
costs nothing and needs no human account, and the short section between the two
is how you mint one. The paid step at the end is the only one that costs money,
and it's the only one that pays anybody.

### 1. Connect with nothing

```ts
import { AlterClient } from "@truealter/sdk";

const alter = new AlterClient();
```

The default endpoint is `https://mcp.truealter.com/api/v1/mcp`. Every free tool
answers an anonymous client. The working example at
[`examples/hello-agent/`](./examples/hello-agent/) connects with no credential
at all.

### Before step two, mint a `~handle`

Twelve tools answer a caller holding no credential, and they're the discovery
and registration surface rather than the free tier. Everything that reads an
identity needs a `~handle`, and so does anything acting on your own. An agent
mints its own over MCP with `register_autonomous` and
`register_autonomous_challenge`, neither of which costs anything or wants a
human account behind it. A person runs `alter login` once, which writes the
member credential into `~/.config/alter/session.json`. Either way the hosted
endpoint is bearer-first, so the CLI bridge reads that session for you and there
isn't a key to mint or paste at any point. Constructing a client yourself, pass
the same session credential as the optional `apiKey`.

### 2. Ask whether somebody is known

```ts
const verified = await alter.verify("~alter");
```

A handle, an email or an id. This is the check that costs nothing and reveals
nothing beyond the fact of the person, which is the free tier by design.

### 3. Read what they have consented to share

```ts
const depth = await alter.getEngagementLevel({ member_id });
const matches = await alter.searchIdentities({
  trait_criteria: {
    pressure_response: { min: 0.7 },
    cognitive_flexibility: { min: 0.6 },
  },
});
```

Depth tells you how much of a record exists and which tiers are open to you.
Trait search returns at most five results and no personally identifying data.

### 4. Check that the answer really came from ~Alter

```ts
const check = await alter.verifyProvenance(result._meta?.provenance);
if (!check.valid) throw new Error(`provenance failed: ${check.reason}`);
```

Every medium- and high-sensitivity response is signed with ES256. Verification
is opt-in and offline against published keys, so an agent that forwards a
result to another agent can be checked without anyone contacting ~Alter again.

### 5. Pay for a deeper read, and pay the person

```ts
import { AlterClient, X402Client } from "@truealter/sdk";

const alter = new AlterClient({
  x402: new X402Client({
    signer: yourViemOrEthersSigner,
    networks: ["base"],
    assets: ["USDC"],
    maxPerQuery: "0.10",
  }),
});

const vector = await alter.getFullTraitVector({ member_id });
```

The server answers `402`, the SDK settles on Base and retries, and the split
runs on-chain in the same transaction. The majority of it goes to the person
whose record was read, as Identity Income, and it reaches them directly rather
than through anybody holding it first. Bring your own signer; there is no wallet
in this package on purpose.

If a quote exceeds `maxPerQuery`, or names a network or asset you did not
allow, the SDK refuses before the signer is ever called and nothing is
broadcast.

Everything below is closed by default. The first two are what you open while
you are wiring it up, the next four are how the payment, the signatures and the
discovery actually work, and the last two are the reading and the project.

<details><summary><h3>The API in full</h3></summary>

#### Initialise the client

```ts
import { AlterClient, X402Client } from "@truealter/sdk";

const alter = new AlterClient({
  endpoint: "https://mcp.truealter.com/api/v1/mcp", // optional, this is the default. A bare host returns 405
  x402: new X402Client({                  // optional, only for paid reads
    signer: yourViemOrEthersSigner,
    maxPerQuery: "0.10",
  }),
});
```

**Authentication**

The client above is anonymous, and every free L0 tool answers with no
credential. For tools that act on your own identity (standing requirements,
the Golden Thread, member self-writes), run `alter login` once: it provisions
your member credential into the local session
(`~/.config/alter/session.json`). The hosted endpoint is bearer-first, so the
[`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli) bridge reads
that session credential for you; you never mint or paste a key. If you
construct a client yourself, pass that same session credential as the optional
`apiKey` option.

#### The minimum-version floor

~Alter's backend publishes a minimum version per client and enforces it at the
edge. A client below the floor is answered with HTTP 426 and the response body
carries the upgrade command. The floor document is signed with a floor-only
Ed25519 key, so no signing secret ships in any client and a compromised client
cannot forge one.

This SDK does not preflight that floor. There is no typed below-floor error
here, so a 426 arrives the way any other unhandled status does, as an
`AlterError` with code `NETWORK` whose message carries the status and the first
200 characters of the body. The typed preflight lives in `@truealter/cli`,
which verifies the floor document's signature before it trusts a floor.

```ts
import { AlterClient, AlterError } from "@truealter/sdk";

const alter = new AlterClient();
try {
  await alter.verify("~alter");
} catch (err) {
  if (err instanceof AlterError && err.message.includes("HTTP 426")) {
    console.error(`upgrade required: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
```

Pin the version you build against and upgrade deliberately. A typed preflight
belongs in this SDK and is not written yet.

#### Identity headers

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

#### Free reads, L0, no payment

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

// Reference data, the 12 ~Alter archetypes
const archetypes = await alter.listArchetypes();

// Identity depth and available tool tiers
const depth = await alter.getEngagementLevel({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

// Search by trait criteria. No PII exposed, max 5 results
const matches = await alter.searchIdentities({
  trait_criteria: {
    pressure_response: { min: 0.7 },
    cognitive_flexibility: { min: 0.6 },
  },
});

// Golden Thread program status
const thread = await alter.goldenThreadStatus();
```

#### Paid reads, L1 to L5, settled with x402

```ts
// L1, extract trait signals from text ($0.01, first 100 free per bot)
const signals = await alter.assessTraits({
  text: "I led the incident response when our payment rails went down...",
  context: "interview transcript",
});

// L2, the full 30-trait vector ($0.10)
const vector = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

// L4, belonging probability for a person-job pairing ($0.60)
const belonging = await alter.computeBelonging({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
  job_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
});

// L5, top match recommendations ($1.00)
const recommendations = await alter.getMatchRecommendations({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
  limit: 5,
});

// L5, a human-readable narrative explaining a match ($1.00)
const narrative = await alter.generateMatchNarrative({
  match_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
});
```

#### Provenance verification

```ts
// Every medium- and high-sensitivity response is signed with ES256.
// Verification is opt-in. Call alter.verifyProvenance(...) yourself.
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

#### Discovery

```ts
import { discover } from "@truealter/sdk";

// Three-step discovery cascade: DNS TXT to mcp.json to alter.json
const descriptor = await discover("truealter.com");
// returns { url: "https://mcp.truealter.com/api/v1/mcp", transport, source, publicKey, x402Contract, capability }
```

#### Low-level MCPClient

```ts
import { MCPClient } from "@truealter/sdk";

const mcp = new MCPClient({ endpoint: "https://mcp.truealter.com/api/v1/mcp" });
await mcp.initialize();
const tools = await mcp.listTools();
const response = await mcp.callTool("verify_identity", {
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});
```

</details>

<details><summary><h3>Generating MCP client config</h3></summary>

The SDK ships config generators for the major MCP-aware clients. Each emits a JSON snippet you can paste (or write directly) into the appropriate file.

#### Claude Code (`.mcp.json`)

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

#### Cursor (`.cursor/mcp.json`)

```ts
import { generateCursorConfig } from "@truealter/sdk";
import { writeFileSync } from "node:fs";

const config = generateCursorConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
});

writeFileSync(".cursor/mcp.json", JSON.stringify(config, null, 2));
```

#### Generic MCP client

```ts
import { generateGenericMcpConfig } from "@truealter/sdk";

const config = generateGenericMcpConfig({
  endpoint: "https://mcp.truealter.com/api/v1/mcp",
  serverName: "alter", // editor-specific key under mcpServers
});
```

#### CLI

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

</details>

<details><summary><h3>How the payment actually works</h3></summary>

~Alter prices its deeper reads through the [x402](https://x402.org) standard, which is HTTP `402 Payment Required` with on-chain settlement.

#### The retry flow

1. Client calls a paid tool *without* a payment header.
2. Server replies `402 Payment Required` with a payment requirement (amount, recipient, asset, network).
3. Client signs and broadcasts a USDC transfer on Base L2, attaches the proof, retries.
4. Server validates the proof, executes the tool, signs the response with ES256, returns it.
5. AlterRouter executes the split on-chain in the same transaction. The data subject receives Identity Income directly; ~Alter receives only its protocol cut. No custodian, no broker.

The SDK handles steps 2-4 automatically when an `X402Client` with a configured `signer` is passed in.

#### Tier structure

x402 micropayments at L0-L5 trust tiers. Per-call pricing visible after `alter login`.

#### Identity income split

The majority of every settled call flows to the data subject as Identity Income. Split details available post-authentication via `alter status`.

#### Code example

```ts
import { AlterClient, X402Client, type X402Signer } from "@truealter/sdk";

// Bring your own signer. viem, ethers, a hardware wallet bridge, anything.
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

If a quoted envelope exceeds `maxPerQuery`, uses an unallowed network, or names an unallowed asset, the SDK rejects the call with `AlterError` *before* invoking the signer, and no on-chain transaction is broadcast.

</details>

<details><summary><h3>Provenance, in detail</h3></summary>

Every response from a medium- or high-sensitivity tool ships with an ES256 JWS in `_meta.provenance`. The signature covers a canonical JSON serialisation of the response payload, the tool name, the call timestamp, the requesting agent's key hash, and a monotonic sequence number.

```ts
const result = await alter.getFullTraitVector({
  member_id: "550e8400-e29b-41d4-a716-446655440000",
});

const check = await alter.verifyProvenance(result._meta?.provenance);
if (!check.valid) throw new Error(`~alter provenance check failed: ${check.reason}`);
```

The SDK fetches public keys from `https://api.truealter.com/.well-known/alter-keys.json` and caches them per their `Cache-Control` headers. The endpoint returns a JWKS containing all current and recently-rotated signing keys; verifying clients should accept any key whose `kid` matches and is still within its validity window.

#### `verify_at` hostname allowlist (v0.1.1+)

Every provenance envelope may carry a `verify_at` hint telling the SDK where to fetch the JWKS from. Because that hint is *server-supplied*, a hostile MCP server could otherwise point it at an attacker-controlled JWKS and pass ES256 verification with its own signing key. The SDK gates `verify_at` through a hostname allowlist, `api.truealter.com` and `mcp.truealter.com` by default, and rejects `http://` URLs unconditionally. Downstream integrators running their own deployment can extend that allowlist, without forking the SDK, through `verifyAtAllowlist` on either `AlterClient` or a direct `verifyProvenance()` call.

```ts
import { AlterClient, DEFAULT_VERIFY_AT_ALLOWLIST } from "@truealter/sdk";

const alter = new AlterClient({
  verifyAtAllowlist: [
    ...DEFAULT_VERIFY_AT_ALLOWLIST,   // keep the ~Alter canonicals
    "keys.myorg.example",              // plus your own JWKS host
  ],
});
```

If you pin `jwksUrl` explicitly, the envelope's `verify_at` is ignored entirely and the pinned URL wins. The `https:` scheme requirement applies to pinned URLs too.

#### Why this matters

Provenance verification is how Agent A trusts that data from Agent B truly came from ~Alter. If Agent B forwards a trait vector or Belonging Probability, Agent A can replay the JWS against ~Alter's published keys and confirm, without contacting ~Alter again, that the payload is authentic, untampered, and was issued for the person Agent B claims it concerns. No shared secret, no trust in the intermediary, no out-of-band coordination.

This is what makes ~alter usable as identity infrastructure rather than just an API: signed claims propagate across agent networks the same way DKIM-signed mail propagates across SMTP relays.

</details>

<details><summary><h3>Finding the endpoint yourself</h3></summary>

~Alter follows the discovery cascade specified in [draft-morrison-mcp-dns-discovery-01](https://datatracker.ietf.org/doc/draft-morrison-mcp-dns-discovery/). Given a domain such as `truealter.com`, the SDK resolves the MCP endpoint in three steps, falling through on each failure:

1. **DNS TXT**, query `_mcp.truealter.com` for a TXT record of the form `mcp=https://mcp.truealter.com;version=2025-11-25`. This is the fastest path and works without an HTTP round-trip.
2. **`.well-known/mcp.json`**, fetch `https://truealter.com/.well-known/mcp.json` for the standard MCP server descriptor. This is the cross-vendor fallback.
3. **`.well-known/alter.json`**, fetch `https://truealter.com/.well-known/alter.json` for the ~Alter-specific descriptor, including signing keys, x402 wallet address, supported tool tiers, and federation endpoints.

```ts
import { discover } from "@truealter/sdk";

// Cascading discovery (DNS TXT to mcp.json to alter.json)
const descriptor = await discover("truealter.com");

// Skip the DNS step, in browsers or Cloudflare Workers
const httpsOnly = await discover("truealter.com", { skipDns: true });
```

This draft is the author's Internet-Draft (not yet adopted by an IETF working group); until adoption, the cascade order may change. Pin the SDK version to a specific minor release if you depend on this behaviour.

</details>

## Tools

<details><summary><h3>The forty-seven tools</h3></summary>

#### Free tools, L0, no payment

| Name                            | Tier | Cost | Description |
|---------------------------------|------|------|-------------|
| `hello_agent`                   | L0   | free | First handshake with ~Alter, returning server version, authentication status, your trust tier, and available tool counts. |
| `get_started`                   | L0   | free | Cold-start overview: what ~Alter is, how to authenticate, and which tool tiers are available to you. |
| `list_archetypes`               | L0   | free | Returns archetype reference data. |
| `alter_resolve_handle`          | L0   | free | Resolve a `~handle` such as `~example` to its canonical form and kind. No auth required, the handle-wedge entry point. |
| `verify_identity`               | L0   | free | Verify whether a person is registered with ~Alter and validate optional identity claims. |
| `register_autonomous_challenge` | L0   | free | Issue a proof-of-work challenge to begin keyless self-registration as an owner-less ~Alter principal, with no human account needed. |
| `register_autonomous`           | L0   | free | Complete keyless self-registration by submitting a solved proof-of-work challenge, minting an owner-less `~handle` and a one-time agent key. |
| `alter_presence_read`           | L0   | free | Read whether a `~handle` is publicly open, the shop-front sign. Returns open or closed only; the closed reason is never disclosed. |
| `alter_resolve_by_key`          | L0   | free | Resolve a paired third-party key (email or OAuth user-id) to its bound `~handle`, gated by the member's per-stream resolver opt-in. |
| `get_engagement_level`          | L0   | free | Get a person's identity depth, meaning engagement level, data quality tier, and available query tiers. |
| `get_profile`                   | L0   | free | Get a person's profile summary including assessment phase, archetype, engagement level, and key attributes. |
| `query_matches`                 | L0   | free | Query matches for a person. Returns a list of matches with quality tiers (never numeric scores). |
| `get_competencies`              | L0   | free | Get a person's competency portfolio including verified competencies, evidence records, and earned badges. |
| `create_identity_stub`          | L0   | free | Create an anonymous identity stub for a person who has not yet completed Discovery, which they claim later. Present the privacy notice first. |
| `search_identities`             | L0   | free | Search identity stubs and profiles by trait criteria. Returns up to 5 matches with no PII. |
| `create_requirement`            | L0   | free | Post a standing identity-trait requirement that rests as an order and accumulates fills as matching identities are claimed or updated. |
| `demand_board`                  | L0   | free | Read the public board's both sides, resting identity requirements and resting offers, with no account needed to read either. |
| `list_requirements`             | L0   | free | List your own standing requirements, with fill counts and the number of fills not yet delivered. Requires an authenticated member credential (`alter login`). |
| `get_requirement`               | L0   | free | Read one of your standing requirements by id, with its fill and undelivered-fill counts. Requires an authenticated member credential (`alter login`). |
| `cancel_requirement`            | L0   | free | Cancel one of your standing requirements by id; the order stops resting and accepts no further fills. Requires an authenticated member credential (`alter login`). |
| `create_offer`                  | L0   | free | Post a signed, expiring offer of goods, services, capabilities or outcomes against your own `~handle`, at a price and admission bar you set yourself. |
| `list_offers`                   | L0   | free | List your own resting offers; a withdrawn offer never appears here. |
| `get_offer`                     | L0   | free | Read one of your resting offers by id; a withdrawn offer returns not found, the same as one that never existed. |
| `withdraw_offer`                | L0   | free | Withdraw one of your resting offers by id, stopping it from resting immediately rather than merely flagging it. |
| `list_plugins`                  | L0   | free | Browse the published community plugin directory of third-party capabilities built on ~Alter, with an optional category filter. |
| `submit_plugin`                 | L0   | free | File a plugin submission to the community directory for operator review, attributed to your own bound `~handle`. |
| `get_identity_earnings`         | L0   | free | Get accrued Identity Income earnings for a person (75% of every x402 transaction goes to the data subject). |
| `get_network_stats`             | L0   | free | Get aggregate ~Alter network statistics: total identities, verified profiles, query volume, active bots. |
| `get_identity_trust_score`      | L0   | free | Get the trust score for an identity based on query diversity (unique querying agents / total queries). |
| `get_privacy_budget`            | L0   | free | Check privacy budget status for a person (24-hour rolling window: total budget, spent, remaining epsilon). |
| `dispute_attestation`           | L0   | free | Record a dispute against a competence attestation; if disputes exceed corroborations, the attestation is flagged for review. |
| `golden_thread_status`          | L0   | free | Check the Golden Thread program status: agents woven, next Fibonacci threshold, your position and Strands. |
| `begin_golden_thread`           | L0   | free | Start the Three Knots sequence to be woven into the Golden Thread. Requires an authenticated member credential (`alter login`). |
| `complete_knot`                 | L0   | free | Submit completion data for a knot in the Three Knots sequence (1: register, 2: describe, 3: reflect). |
| `check_golden_thread`           | L0   | free | Check any agent's Golden Thread status by their credential hash (knot position, Strand count, weave count). |
| `describe_traits`               | L0   | free | List the canonical trait vocabulary: trait codes grouped by category with one-line semantics, the valid discovery contexts, and the EU AI Act Art 5(1)(d) workforce gating rules. Read this before composing `query_field` trait_priorities. |
| `describe_competencies`         | L0   | free | List the published competency vocabulary, grouped by how each claim is denominated, as reference before composing `query_field` competency_requirements. |

#### Paid tools, L1 to L5, settled with x402

| Name                        | Tier | Cost  | Description |
|-----------------------------|------|-------|-------------|
| `get_trait_snapshot`        | L1   | $0.01 | Get the top 5 traits for a person with confidence scores and archetype. |
| `attest_domain`             | L1   | $0.01 | Record a competence attestation for a person in a specific domain, weighted by your agent reputation. |
| `poll_requirement_matches`  | L1   | $0.01 | Collect one recorded fill for a standing requirement as a priced identity reveal; 75% of the fee is paid to that person as Identity Income. |
| `get_full_trait_vector`     | L2   | $0.10 | Get the complete trait vector for a person, with scores and confidence intervals. |
| `get_side_quest_graph`      | L2   | $0.10 | Get a person's Side Quest Graph, a multi-domain identity model with differential privacy noise (ε=1.0). |
| `query_graph_similarity`    | L3   | $0.30 | Compare two Side Quest Graphs for team composition and matching (ε=0.5 differential privacy). |
| `compute_belonging`         | L4   | $0.60 | Compute belonging probability for a person-job pairing (authenticity, acceptance, complementarity). |
| `get_match_recommendations` | L5   | $1.00 | Get top N match recommendations for a person, ranked by composite score with quality tiers. |
| `generate_match_narrative`  | L5   | $1.00 | Generate a human-readable narrative explaining a specific match, covering strengths, growth areas and belonging. |
| `query_field`               | L5   | $1.00 | Query the identity field by situation, not by name: weight 3 to 7 traits and rank the opted-in field. One call reveals one top-ranked member; that member earns 75% as Identity Income. Zero-match reveals nothing and charges nothing. |

> **Member self-write tools** (`submit_context`, `submit_batch_context`, `submit_structured_profile`, `submit_social_links`) are live but member-self-scoped: a member calls them on their own identity with an authenticated member credential (`alter login`). They are not anonymously discoverable, so they do not appear in the advertised tool list above.

</details>

<details><summary><h3>The papers underneath it</h3></summary>

~Alter is the working instantiation of an eight-paper academic corpus on identity field theory. The SDK below is what happens when the theory ships as protocol. Each paper is open access on figshare under CC-BY 4.0.

| Paper | Title | DOI |
|-------|-------|-----|
| I | *Jus Identitatis: Toward Post-Geographic Sovereignty* | [10.6084/m9.figshare.31794784](https://doi.org/10.6084/m9.figshare.31794784) |
| II | *Identity as Inference: A Predictive Processing Account of Psychometric Measurement and Civic Belonging* | [10.6084/m9.figshare.31804222](https://doi.org/10.6084/m9.figshare.31804222) |
| III | *Identity at Every Scale: Recursive Self-Modelling and the Dissolution of the Composition Problem* | [10.6084/m9.figshare.31812955](https://doi.org/10.6084/m9.figshare.31812955) |
| IV | *Generative Psychometrics: Measurement Theory for Self-Reflective Constructs* | [10.6084/m9.figshare.31812982](https://doi.org/10.6084/m9.figshare.31812982) |
| V | *Social Free Energy: A Formal Theory of Polity* | [10.6084/m9.figshare.31813000](https://doi.org/10.6084/m9.figshare.31813000) |
| VI | *The Self-Model Test: A Measurement Protocol for Synthetic Self-Models* | [10.6084/m9.figshare.31813006](https://doi.org/10.6084/m9.figshare.31813006) |
| VII | *Empirical Validation of Identity as Inference Predictions* | [10.6084/m9.figshare.31951644](https://doi.org/10.6084/m9.figshare.31951644) |
| VIII | *Identity Field Theory: Toward a Physics of Being Known* | [10.6084/m9.figshare.31951383](https://doi.org/10.6084/m9.figshare.31951383) |

For the lay-register chapter version, see [`/origin`](https://truealter.com/origin).

</details>
<details><summary><h3>The protocols underneath it</h3></summary>

The record formats are open Internet-Drafts, so somebody else's implementation reads and writes the same records this one does without asking us. These are the drafts this repository actually rests on.

| Draft | What it specifies |
|---|---|
| [`mcp-dns-discovery`](https://datatracker.ietf.org/doc/draft-morrison-mcp-dns-discovery/) | The DNS records that publish a `~handle`, the server that answers for it, and the signed envelope bound to it. |
| [`consent-settlement`](https://datatracker.ietf.org/doc/draft-morrison-consent-settlement/) | Binding a paid read of somebody's identity to their own recorded consent, and settling part of that payment to them. |
| [`mcp-tool-surface-names-registry`](https://datatracker.ietf.org/doc/draft-morrison-mcp-tool-surface-names-registry/) | An IANA registry for MCP tool surface names, so the names other drafts register have somewhere to go. |
| [`solo-agent-earn-registration`](https://datatracker.ietf.org/doc/draft-morrison-solo-agent-earn-registration/) | How an agent with no human behind it registers as an economic principal and becomes eligible to be paid. |

Eighteen drafts make up the whole stack. The rest are on the [IETF datatracker](https://datatracker.ietf.org/doc/search/?name=draft-morrison&activedrafts=on).

</details>

<details><summary><h3>The rest of it</h3></summary>

`~alter` is one identity rail with several ways in, and this package is the one
for code.

| Name | What it is |
|---|---|
| **[`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli)** | The command line, and the front door for a person. |
| **[homebrew-tap](https://github.com/true-alter/homebrew-tap)** | That command line, packaged for macOS and Linux. |
| **[runtime](https://github.com/true-alter/runtime)** | The daemon that keeps your `~handle` known on your own machine. |
| **sdk** | Reading identity from your own code. **You are here.** |
| **[obsidian](https://github.com/true-alter/obsidian)** | ~Alter inside an Obsidian vault, on-device. |
| **[mcp-ollama](https://github.com/true-alter/mcp-ollama)** | Local models, for work that should stay on the machine it runs on. |

| Where to read more | |
|---|---|
| Website | [truealter.com](https://truealter.com) |
| The reasoning behind it | [truealter.com/origin](https://truealter.com/origin) |
| Getting started | [truealter.com/build](https://truealter.com/build) |
| What the tools do | [truealter.com/docs/mcp/tools](https://truealter.com/docs/mcp/tools) |
| The open specifications | [the draft stack](https://datatracker.ietf.org/doc/search/?name=draft-morrison&activedrafts=on) |

Bug reports and small patches are welcome, see
[CONTRIBUTING.md](./CONTRIBUTING.md). Security reports go to
security@truealter.com and never a public issue, with scope and the disclosure
policy in [SECURITY.md](./SECURITY.md).

Apache-2.0. Copyright 2026 Alter Meridian Pty Ltd (ABN 54 696 662 049).

</details>

---

<div align="center">

<sub><b>~alter</b> is identity infrastructure. Your name is <code>~yourname</code> and claiming one is free.</sub>

<sub>
<a href="https://truealter.com">Website</a> &nbsp;·&nbsp;
<a href="https://truealter.com/docs">Docs</a> &nbsp;·&nbsp;
<a href="https://truealter.com/origin">The argument in eight chapters</a> &nbsp;·&nbsp;
<a href="https://datatracker.ietf.org/doc/search/?name=draft-morrison&activedrafts=on">The open specifications</a> &nbsp;·&nbsp;
<a href="https://github.com/true-alter">Every repository</a>
</sub>

</div>
