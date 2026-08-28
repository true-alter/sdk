# Security Policy

## Reporting a vulnerability

Email **security@truealter.com** with:

- A description of the issue and the SDK method or surface it affects.
- Reproduction steps, ideally a minimal script.
- Your assessment of impact, client-local footgun, network-reachable issue, anything in between.
- Whether the issue involves the SDK itself, the wire protocol (MCP `2025-11-25`), the live MCP server at `mcp.truealter.com`, or the provenance envelope format.

We aim to acknowledge within 3 business days and agree a disclosure window with you before any public fix lands. PGP-encrypted reports are welcome at the same address, keys on request.

Please do **not** open public GitHub issues for vulnerabilities.

## Scope

In-scope concerns for this repository:

- **Provenance verification.** ES256 signature checks in `src/provenance.ts`, JWKS fetching + caching, `verify_at` allowlist enforcement, tool-schema signature verification. The SDK is how agents decide to trust signed claims off-host, bugs here have outsized impact.
- **x402 settlement.** Client-side policy gates (`maxPerQuery`, network allowlist, asset allowlist) in `src/x402.ts`. A bypass here could cause an unintended on-chain transaction.
- **Discovery.** DNS TXT parsing, `.well-known/mcp.json` and `.well-known/alter.json` handling in `src/discovery.ts`. Responses are server-supplied and must not be trusted blindly.
- **Authentication.** API-key handling, Ed25519 keypair generation, MCP bridge (`bin/mcp-bridge.ts`).
- **Supply chain.** The published `dist/` output, CI workflow, and the two runtime dependencies (`@noble/ed25519`, `@noble/hashes`).

Out-of-scope:

- Vulnerabilities in the live MCP server, report via the same address but they will be routed internally.
- Vulnerabilities in the two `@noble/*` packages, report upstream at [github.com/paulmillr](https://github.com/paulmillr).
- Issues in third-party MCP clients that load the SDK, report to the client vendor.

## Coordinated disclosure

For issues that span this SDK and the live ALTER MCP server, we will coordinate timing with the server team internally and agree a combined disclosure window with you. We prefer agreed disclosure windows over embargoed surprise drops.

## Prior hardening

The SDK already ships defences against a class of issues that have been disclosed against similar clients:

- `verify_at` host allowlist (default: `api.truealter.com`, `mcp.truealter.com`) so a hostile MCP server cannot point provenance verification at an attacker-controlled JWKS. Configurable via `verifyAtAllowlist`.
- `https:` scheme requirement on both `verify_at` and pinned `jwksUrl`.
- Wallet-agnostic signer seam, the SDK never holds a private key directly; the caller brings their own `X402Signer`.
- Policy gates on x402 envelopes (`maxPerQuery`, network allowlist, asset allowlist) evaluated *before* the signer is invoked.

## Supported versions

The latest `0.x` release receives security fixes. Older `0.x` releases are not patched, please upgrade.

Once `1.0.0` ships, the supported-version policy will be expanded to cover at least the most recent minor.
