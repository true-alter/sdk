# Changelog

All notable changes to `@truealter/sdk` (formerly `@alter/identity`, renamed 2026-04-15) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] (2026-05-18)

Resynced from canonical monorepo source. This release closes the public-mirror
gap between `0.2.4` (the last tagged mirror release) and `0.5.0` (the version
shipping on npm as `@truealter/sdk`). Intermediate npm releases `0.2.4`, `0.3.0`,
`0.4.2`, `0.4.3`, and `0.5.0` are summarised below.

### Added

- **`helloAgent()` + `resolveHandle()` methods** (0.2.4). Wrap the live
  `hello_agent` handshake (server version, auth status, trust tier, tool
  counts, recommended first call) and the public `~handle`-wedge
  `alter_resolve_handle` tool (canonical form, kind, addressability,
  no PII).
- **`wire` / `unwire` subcommands + `wire-state.json` provenance
  artefact** (0.3.0). `alter-identity wire` probes for installed
  MCP-aware clients (Claude Code, Cursor, Claude Desktop, VS Code) and
  merges ALTER into each one's config in a single idempotent step with
  atomic SHA-256-validated writes and timestamped backups. `unwire`
  reverses every target using the recorded backup map. Init bundles
  wire with a `Wire detected AI clients to ALTER? [Y/n]` consent
  prompt (non-interactive callers default to declining). Refuses any
  target whose resolved path sits under iCloud / OneDrive / Dropbox /
  Google Drive / Box / pCloud / Sync.com / MEGA, wire consent is
  per-device.
- **`generateClaudeDesktopConfig()` adapter** (0.3.0). Stdio-shape
  config for Claude Desktop using the existing `alter-mcp-bridge`
  binary to bridge stdio ↔ streamable-HTTP. New CLI flag:
  `alter-identity config --claude-desktop`.
- **`MCPClient` `extraHeaders` option** (0.4.3). Support for custom
  authentication headers when the endpoint sits behind an additional
  gate that needs its own credentials. Protocol-level and
  ALTER protocol headers always win over user-supplied collisions.
- **`alter-mcp-bridge` env-var hooks for custom gate headers** (0.4.3).
  Bridge now reads an `ALTER_BRIDGE_HEADERS` environment variable
  (JSON object, full escape hatch) at start-up and applies its entries
  as additional request headers.
- **`CONTRIBUTING.md`**: workflow, scope, and back-port policy for
  this public source mirror.
- **`SECURITY.md`**: disclosure address (`security@truealter.com`),
  scope boundaries, and a short summary of prior hardening already
  shipped in the SDK.
- **README polish**: CI + Node version badges, Docker usage section,
  Contributing and Security sections linking to the new meta files.

### Changed

- **Version unification with `@truealter/cli` 0.5.0 + well-known
  publication parity** (0.5.0). Cuts `@truealter/sdk` from `0.4.3` to
  `0.5.0` as a coordinated post-pentest signal alongside
  `@truealter/cli` 0.5.0. Closes a multi-week drift between the
  published SDK version, the version advertised at
  `truealter.com/.well-known/alter-versions.json` (was stuck at
  `0.4.2`), and the version advertised at
  `truealter.com/.well-known/mcp.json` (also `0.4.2`). All three
  surfaces now publish `0.5.0` from the same commit.
- **README MCP endpoint corrections** (0.2.4). Every code sample now
  consistently uses `https://mcp.truealter.com/api/v1/mcp` in place of
  the bare branded host, matching the SDK's `DEFAULT_ENDPOINT` and the
  resolved output of `discover("truealter.com")`.
- **Tool count reconciled with live wire reality** (0.2.4). Summary
  line, Free/Premium tables, and x402 tier-structure table describe
  the **32 tools (24 free L0 + 8 premium L1–L5)** the live server
  enumerates via `tools/list`. The `.well-known/mcp.json` descriptor
  is fixed in lockstep.
- **`SDK_VERSION` constant** moved to a dedicated `src/meta.ts` module
  so `src/wire/` can reference it without creating an import cycle
  through `src/index.ts` (0.3.0). No behavioural change for
  consumers.

### Fixed

- **`loadPrivateKey` no longer crashes under ESM** (0.4.3). The
  PEM-input branch previously did a lazy `require('node:crypto')`,
  which the tsup bundler converted into a `__require` shim that
  throws `Dynamic require of "crypto" is not supported` whenever the
  SDK is loaded as ESM (the default for any consumer with
  `"type": "module"`). Replaced with a static
  `import { createPrivateKey } from 'node:crypto'`, unblocking every
  signed `tools/call` made via `@truealter/sdk` 0.4.x.

### Security

- **`verifyProvenance` now validates the `iss` claim** (0.4.2).
  Previously only `exp` and `iat` were checked, allowing a
  validly-signed token minted by a different ALTER identity to pass
  verification (cross-identity substitution). The expected issuer
  defaults to `did:alter:platform`; callers with non-platform issuers
  may override via the new `expectedIss` option. Closes a provenance
  verification gap.

### Removed

- **Phantom write-side tool bindings** (0.2.4). Seven tools that lived
  in `FREE_TOOL_NAMES` / `PREMIUM_TOOL_NAMES`, the tier/cost/blast
  registries, and as client methods but were **not** served by the
  live MCP server were dropped from the SDK surface to keep the SDK's
  contract equal to the server's contract:
  `create_identity_stub`, `submit_context`, `dispute_attestation`,
  `submit_batch_context`, `submit_structured_profile`,
  `submit_social_links`, `attest_domain`. They will return as typed
  methods once server-side consent gating lands.

## [0.2.1] (2026-04-15)

### Removed

- **Three experimental tool method bindings** whose server-side handlers
  were withdrawn from the live MCP surface in hotfix #421 (11 Apr 2026).
  The SDK still advertised them in `FREE_TOOL_NAMES`, the registries
  (`TOOL_TIERS`, `TOOL_COSTS`, `TOOL_BLAST_RADIUS`), and as methods on
  `AlterClient`. Now removed so the SDK matches what the server actually
  serves; calls would have failed with a tool-not-found error against
  the live endpoint regardless. Corresponding type exports also removed.

### Changed

- **Vocabulary alignment.** Replaced "candidate" with "person" throughout
  README prose and JSDoc comments. ALTER is identity infrastructure, not
  a hiring platform, descriptive copy now matches that framing. Wire
  field names (`candidate_id`, etc.) are unchanged because they are
  server-contract identifiers; only human-readable descriptions moved.
- **Trademark notice** now references "the Trill", the canonical name
  for the `~` mark (locked 7 Apr 2026, brand-internal#100), instead of
  the legacy "Alter Stroke (~) device mark" wording.
- Tool count summary: `40 total, 28 free (L0) + 12 premium` →
  `37 total, 25 free (L0) + 12 premium`.

## [0.2.0] (2026-04-15)

### Changed

- **Package renamed `@alter/identity` → `@truealter/sdk`.** The `@alter`
  npm namespace is not owned by ALTER. Published under the
  owned `@truealter` scope to match the canonical `truealter.com`
  anchor and the existing v0.0.1 placeholder on npm. Consumers of the
  legacy name (unpublished in-repo only) must update their
  `package.json` dependency entry and import paths, the export
  surface is otherwise unchanged.
- **CLI invocation examples updated.** Use `npx alter-identity <cmd>`
  (or `alter-identity <cmd>` post-install), `npx @truealter/sdk` does
  not resolve because the package ships two bins and neither matches
  the unscoped package name.
- **`SDK_NAME` constant** now returns `@truealter/sdk`.
- **Default `clientInfo.name`** in `MCPClient` and `alter-mcp-bridge`
  updated to `@truealter/sdk` / `@truealter/sdk-mcp-bridge` respectively.

## [0.1.1] (2026-04-14)

### Security

- **CRITICAL (C-4): Harden `verify_at` resolution against hostile MCP
  servers.** `verifyProvenance()` previously trusted any `http://` or
  `https://` URL supplied in the server response envelope's `verify_at`
  field when fetching the JWKS for ES256 signature verification. A
  hostile MCP server could point `verify_at` at an attacker-controlled
  JWKS and pass verification with its own signing key.
  - JWKS fetches are now **https-only**, `http:` URLs are rejected
    unconditionally for both `verify_at` hints and caller-supplied
    `jwksUrl` options.
  - Envelope `verify_at` hostnames are gated through a hostname
    allowlist. Default allowlist is `api.truealter.com` and
    `mcp.truealter.com`.
  - Downstream integrators can extend the allowlist without a fork via
    the new `verifyAtAllowlist` option on both `verifyProvenance()` and
    the `AlterClient` constructor.
  - Callers that supply an explicit `jwksUrl` bypass the envelope
    entirely (the caller has already vouched for the origin); the
    `https:` scheme requirement still applies.
  - New exports: `DEFAULT_VERIFY_AT_ALLOWLIST`, `resolveVerifyAt`,
    `VerifyProvenanceOptions`.

### Added

- `DEFAULT_VERIFY_AT_ALLOWLIST`, the frozen default hostname allowlist.
- `resolveVerifyAt(verifyAt, allowlist?)`, exported for advanced
  callers and test harnesses.
- `AlterClientOptions.verifyAtAllowlist`, per-client allowlist override.

## [0.1.0] (2026-04-13)

- Initial public release.
