# Changelog

All notable changes to `@truealter/sdk` (formerly `@alter/identity`, renamed 2026-04-15) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The published README is now the uplifted listing README.** npm renders the
  README as the package's landing page, and the copy the publish path reads
  (`packages/alter-identity/README.md`) was a spec sheet opening on transport
  and wire-protocol detail, while the uplifted README written for readers sat
  on `true-alter/sdk` main and reached npm at no point, because the export
  curates from this directory rather than from that branch. The two are now
  the same document.
- **The masthead image resolves on npm.** It was a relative path to
  `docs/alter-mark.svg`, which the `files` whitelist has never shipped, so the
  top of the npm listing rendered as a broken image. It is now the absolute
  raw URL, which resolves on GitHub and on npm alike.

### Fixed

- **Advertised tool counts corrected to 47 (38 free + 9 premium).** The
  published README carried 42 (33 free + 9 premium). The freshness gate reads
  the live predicate and now reconciles against it.
- **The freshness gate reads the README's prose count form.** It matched only
  the bulleted spec-sheet line, so a README stating its counts correctly in
  prose failed as though the statement were missing. The pressure that creates
  is to write the README for the regex.


### Fixed

- **Advertised tool counts now match the live server.** The README claimed 36
  publicly advertised tools (27 free + 9 premium); the server advertises 40
  (31 free + 9 premium). The README says in its own words that these track the
  live server at every publish, so the gap was a false claim shipping inside
  the tarball, not a stale nicety.
- **`pricing.generated.ts` regenerated against the live backend.** It was the
  cause, not a side effect. The generated surface had fallen behind and the
  README count is derived from it. `get_started` (L0) and `alter_graph` +
  `alter_why` (L3, $0.30) were missing from the tier and pricing maps, so a
  client reading tiers from the SDK saw three tools the server serves as
  absent. `ADVERTISED_TOOL_COUNTS` moves to 31 free / 9 premium / 40 total.

### Added

- **`checkMinVersion()` + `BelowFloorError`: client version-floor preflight.**
  Every `AlterClient` invocation now preflights the public
  `GET /v1/clients/min-version` floor endpoint lazily on first request (not on
  import, not in the constructor). The SDK verifies the Ed25519 signature on the
  floor document against the published `key_id`, compares its own version
  against the floor for `alter-identity`, and throws a typed `BelowFloorError`
  when below. The error carries the canonical envelope fields
  (`client_version`, `min_version`, `upgrade_cmd`, `channel`, `message`) as
  enumerable properties.
- **`X-Alter-Client-{Id,Version,Channel}` identity headers** attached to every
  outbound `MCPClient` request. The server-side floor middleware uses these to
  enforce HTTP 426 on below-floor clients regardless of whether the SDK ran its
  own preflight.
- **`unsafe_skipVersionCheck` constructor option.** An escape hatch that skips
  the client-side preflight only. The server-side gate still rejects below-floor
  clients with HTTP 426. Named to discourage casual use.
- **In-memory (1h, clamped `[60s, 24h]`) + disk (24h fresh / 7d warn) cache**
  for the floor document at
  `${XDG_CONFIG_HOME:-~/.config}/alter/floor-cache.json`. The disk cache
  verifies file ownership + mode `0600` before trusting it (POSIX) and uses
  atomic tmp + rename writes to survive concurrent invocations. Below-floor and
  offline together is the only intentional offline-block case.
- **Worked example** at `examples/min-version-check/` showing the three patterns
  (explicit, lazy via constructor, opt-out).

### Changed

- **`X402Client` now warns when recipient validation is off.** Constructing an
  `X402Client` without a `recipientAllowlist` leaves recipient gating disabled,
  which is the long-standing default and stays that way so existing integrators
  keep working. It is no longer silent. The constructor logs a one-off runtime
  warning naming the option to pass. Pass an empty array to opt out deliberately
  and silence the warning.
- **`DEFAULT_RECIPIENT_ALLOWLIST` now carries the live Base mainnet AlterRouter
  address.** It previously held a burn-address placeholder, so passing it as an
  allowlist would have rejected every real settlement. The address is the one
  already published at `https://truealter.com/.well-known/alter.json`.

### Notes

- Ed25519 verification matches the ~alter server-side floor-signing verifier and
  the canonical `alter-cli` client byte-for-byte. Signature = hex-encoded
  64-byte Ed25519 signature over the canonical JSON of `{floors, served_at}`
  (sorted keys at every depth, compact separators, raw UTF-8;
  `cache_ttl_seconds` is outside the signed bytes); `key_id` = first 8 hex chars
  of `SHA-256(raw 32-byte public key)`.
- The shipped `KNOWN_FLOOR_PUBLIC_KEYS` map carries the dev/non-prod and
  production Ed25519 PUBLIC keys (`key_id` to SPKI-PEM), mirroring `alter-cli`.
  No signing secret ships in the client. The scheme is asymmetric, so the
  shipped keys verify only and cannot forge. An unknown `key_id` or an invalid
  signature is a cache miss (refetch), never a pass; the disk cache re-verifies
  on every read.

## [0.5.9] - 2026-06-23

### Fixed

- **Tool type definitions now cover the full advertised tool set (27 free, 9
  premium).** An earlier 0.5.8 build typed a reduced set, so `FREE_TOOL_NAMES`,
  `PREMIUM_TOOL_NAMES`, and the derived tool-name union were out of step with
  the live server's `tools/list`. This release regenerates the typed tuples from
  the canonical advertised set, and the README tool table is consistent with
  them. No runtime or wire-format change: the additional names were always
  callable on the server, they simply gained static types here.

## [0.5.7] - 2026-06-18

### Changed

- **Doc-comments in the published type declarations now describe behaviour in
  plain, developer-facing language.** Each reads by what it does: the
  version-floor logic points at "the CLI client", the floor-signing parity note
  points at the server-side floor-signing implementation, and the theme and
  homepage type docs cite the spec by its plain name. The `generated_by` example
  uses a neutral public-package tag. Every wire-format contract is preserved. No
  code or behavioural change.
- **Build hygiene.** Two unused imports were removed, and a file's interpreter
  line was restored to the first line so a full type check passes clean. No
  behavioural change.

## [0.5.6] - 2026-06-18

### Changed

- **Publishable bundle rebuilt and re-verified.** The `dist/` artefacts were
  regenerated from source. No code or behavioural change.

## [0.5.5] - 2026-06-18

### Changed

- **README brand form: the product and protocol name reads as `~Alter` /
  `~alter` in prose throughout.** The npm landing page now uses the canonical
  handle form across the title, headings, descriptions, and the tool table,
  consistent with every other public surface. Code identifiers, environment
  variables, header literals, and the legal entity name are unchanged.
- **Documentation prose hygiene pass.** Changelog headers and body copy were
  restructured to drop the em-dash in favour of colons, commas, and full stops,
  matching the shipped prose standard. No code or behavioural change.
- **Cloudflare Access env reads documented in place.** Every
  `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` reference in the shipped
  bridge and library is infrastructure plumbing for an operator who self-hosts a
  Cloudflare-Access-gated endpoint, never a member-facing instruction: members
  authenticate with the credential from `alter login` and are never asked to
  obtain or apply a Cloudflare Access token. The rationale is now documented
  inline at both read sites. The bridge's bearer-first default endpoint and the
  `alter login` re-authentication remedy are unchanged. No behavioural change.

## [0.5.4] - 2026-06-12

### Fixed

- **Claude Code MCP onboarding now connects out of the box.** The member bridge
  defaulted to `mcp.truealter.com`, which sits behind Cloudflare Access and
  returns an HTML login page on a 2xx. Claude Code cannot JSON-parse that
  response, so it reported "Failed to connect" on every fresh wiring. Five
  coordinated fixes close the gap:
  1. `wireClaudeCode` now bakes `ALTER_MCP_ENDPOINT` and
     `ALTER_PUBLIC_MCP_ENDPOINT` into the saved Claude Code entry via
     `--env KEY=VAL` flags, so every future bridge spawn targets the
     bearer-first `api.truealter.com` endpoint regardless of how Claude Code
     launches it (including stripped-env spawns on Windows).
  2. `src/mcp-bridge.ts` default endpoint changed from `mcp.truealter.com` to
     `api.truealter.com/api/v1/mcp`. That bridge is only ever spawned for
     authenticated members; it must never default to the Access-gated host.
  3. The wiring `spawnSync` env also carries both env-var names, as a
     belt-and-braces measure for the `claude mcp add` invocation itself.
  4. `resolveBridgeScript` now finds the bridge at `dist/bin/mcp-bridge.js`. The
     build emits the bridge under `bin/`, but the resolver only checked
     `dist/mcp-bridge.js`, so it returned null and `wireClaudeCode` silently
     fell through to the HTTP-transport branch, wiring a `--transport http`
     entry against the GET-first-incompatible, Access-gated host. Fix (1) above
     only takes effect once the stdio bridge branch is actually reachable.
  5. The `claude mcp add` argument order now places the server name before the
     `--env` flags. Claude Code's `--env` is a variadic option, so a trailing
     server name was consumed as an env value ("Invalid environment variable
     format: alter"); the name now precedes the flags, with `--` terminating the
     variadic before the bridge command.

## [0.5.2] - 2026-06-05

### Added

- **`src/pricing.generated.ts`: generated source of truth for pricing and
  advertised tool counts.** Exports `GENERATED_TOOL_TIERS`,
  `GENERATED_TOOL_PRICING`, `TIER_PRICES`, `ADVERTISED_TOOL_COUNTS`
  (26 free + 8 premium = 34 total), and `REVENUE_SPLIT`. Generated from the live
  MCP pricing surface (`TOOL_PRICING`, `TOOL_TIERS`) and the public tool
  advertisement list (`PUBLIC_ADVERTISED_TOOLS`). Makes pricing drift
  structurally impossible.
- **Publish-time freshness gate.** Regenerates the pricing surface from the live
  values, compares it against the committed `pricing.generated.ts`, and fails on
  any mismatch. It also checks the local package version against the published
  npm version (a network failure warns, it does not hard-fail). Wired into
  `prepublishOnly`.
- **Mechanical leak gate wired into `prepublishOnly`.** The SDK's
  `prepublishOnly` now builds, then runs the publish gate over `dist`, then runs
  the freshness gate. This gives the SDK parity with the CLI's gate.

### Fixed

- **Stale advertised tool counts in `types.ts` and `README.md`.** `types.ts`
  section headers updated: "24 tools" to "26 advertised tools" (free), "12 tools"
  to "8 advertised tools" (premium). `README.md` updated from "40 typed and
  wired: 24 free + 9 premium + 7 messaging" to "34 publicly advertised: 26 free
  + 8 premium". Both now reference `ADVERTISED_TOOL_COUNTS` from
  `pricing.generated.ts` as the authoritative count.
- **Figures in shipped docs are now generated, not transcribed.** The prior
  release shipped doc-comments and README figures copied by hand, which is how
  they drifted. The new `prepublishOnly` gates make that class of drift
  detectable before publish, and block the release when the committed generated
  surface is out of step with the live values.

## [0.5.1] - 2026-05-28

### Changed

- Maintenance release. No functional change.

## [0.5.0] - 2026-05-11

### Changed

- **Version unification with `@truealter/cli` 0.5.0, plus well-known publication
  parity.** Cuts `@truealter/sdk` from `0.4.3` to `0.5.0` alongside
  `@truealter/cli` 0.5.0. This closes a multi-week drift between the published
  SDK version, the version advertised at
  `https://truealter.com/.well-known/alter-versions.json` (stuck at `0.4.2`
  while the package shipped `0.4.3`), and the version advertised at
  `https://truealter.com/.well-known/mcp.json` (also `0.4.2`). All three
  surfaces now publish `0.5.0` from the same commit. No code changes:
  `verifyProvenance`, `MCPClient.extraHeaders`, and the `loadPrivateKey` ESM fix
  from 0.4.2/0.4.3 ship unchanged. The minor bump conveys the cross-artefact
  coordination, not new SDK behaviour. The themes lockfile example string in
  `src/themes.ts` now references `alter-cli/0.5.0` accordingly.

## [0.4.3] - 2026-05-09

### Fixed

- **`loadPrivateKey` no longer crashes under ESM.** The PEM-input branch did a
  lazy `require('node:crypto')`, which the tsup bundler converted into a
  `__require` shim that throws `Dynamic require of "crypto" is not supported`
  whenever the SDK is loaded as ESM (the default for any consumer with
  `"type": "module"`). Replaced with a static
  `import { createPrivateKey } from 'node:crypto'`, mirroring the existing
  static `crypto` import used by the protocol-version hash. This unblocks every
  signed `tools/call` made via `@truealter/sdk` 0.4.x, from both the
  `alter-mcp-bridge` and `@truealter/cli` (`alter msg`, `alter room`).

### Added

- **`MCPClient` `extraHeaders` option.** Arbitrary HTTP headers added to every
  request, useful when the endpoint sits behind an edge gate that needs its own
  credentials, for example Cloudflare Access service tokens
  (`CF-Access-Client-Id` + `CF-Access-Client-Secret`). Protocol-level headers
  (`Content-Type`, `Accept`) and the protocol's own headers (`X-ALTER-API-Key`,
  `Mcp-Session-Id`, `Mcp-Invocation-Signature`) always win over user-supplied
  collisions, so the option cannot be used to spoof auth.
- **`alter-mcp-bridge` env-var hooks for edge-gate credentials.** The bridge
  reads `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` (auto-mapped to the
  corresponding Cloudflare Access headers) and `ALTER_BRIDGE_HEADERS` (a JSON
  object, the full escape hatch) at start-up, and threads them through
  `MCPClient.extraHeaders`. This lets the bridge reach MCP endpoints behind
  Cloudflare Access without an SDK fork.

## [0.4.2] - 2026-05-09

### Security

- **`verifyProvenance` now validates the `iss` claim** after ES256 signature
  verification. Previously only `exp` and `iat` were checked, so a
  validly-signed token minted by a different ~alter identity passed
  verification (cross-identity substitution). The expected issuer defaults to
  `did:alter:platform`, matching the server-side mint constant; callers with
  non-platform issuers may override via the new `expectedIss` option.

## [0.3.0] - 2026-04-22

### Added

- **`alter-identity wire` / `alter-identity unwire` subcommands.** `wire` probes
  for installed MCP-aware clients (Claude Code, Cursor, Claude Desktop, VS Code)
  and merges ~alter into each one's config in a single idempotent step.
  File-based targets go through an atomic merge that reads, SHA-256s, parses,
  merges, writes, and atomically renames, copying the original to
  `<path>.alter-backup-<timestamp>` before replacing it. Claude Code goes
  through the `claude mcp add --scope user --transport http` handoff rather than
  touching `~/.claude.json` directly. `unwire` reverses every target using the
  recorded backup siblings (or `claude mcp remove` for the CLI target).
- **`wire-state.json` provenance artefact.** Written to
  `$XDG_CONFIG_HOME/alter/wire-state.json` after every wire run. Holds the SDK
  version, endpoint, timestamp, and per-target record (pre/post SHA-256, backup
  path, status). Used by `unwire` as the canonical rollback map, and
  audit-friendly by design.
- **Init bundles wire with a consent prompt.** `alter-identity init` now prints
  the detected clients and asks before touching anything. Flags: `--wire` and
  `--yes` skip the prompt and proceed; `--no-wire` skips the prompt and
  declines; non-interactive callers (no TTY) default to declining, so CI runs
  never wire silently.
- **Synced-volume refusal.** Wire refuses any target whose resolved path sits
  under iCloud Drive, OneDrive, Dropbox, Google Drive, Box, pCloud, Sync.com, or
  MEGA. Wire consent is per-device; a synced config would propagate ~alter
  credentials to every other machine the user syncs with.
- **`generateClaudeDesktopConfig()` adapter + exports.** Produces the
  stdio-shape config Claude Desktop expects, using the existing
  `alter-mcp-bridge` binary to bridge stdio to streamable-HTTP. New CLI flag:
  `alter-identity config --claude-desktop`.
- **Public SDK exports** for the wire surface: `wire`, `unwire`, `probeAll`,
  `probeClaudeCode`, `probeByDir`, `detectSyncedVolume`, `readWireState`,
  `writeWireState`, `sha256`, `ALL_CLIENTS`, `CLAUDE_CODE`, `CURSOR`,
  `CLAUDE_DESKTOP`, `VSCODE`, plus `ClientId`, `ClientPaths`, `ProbeResult`,
  `WireOptions`, `WireReport`, `UnwireReport`, `WireState`, `WireTarget`,
  `WireTargetFile`, `WireTargetCli` types.

### Changed

- **`SDK_VERSION` constant** moved to a dedicated `src/meta.ts` module so
  `src/wire/` can reference it without creating an import cycle through
  `src/index.ts`. No behavioural change for consumers. The `SDK_NAME` /
  `SDK_VERSION` re-exports on `src/index.ts` are unchanged.
- **`SDK_VERSION`** bumped to `0.3.0`.

## [0.2.4] - 2026-04-17

### Added

- **`helloAgent()` method + `HelloAgentInput` / `HelloAgentOutput` types.**
  Wraps the live server's `hello_agent` handshake tool, which returns server
  version, authentication status, trust tier, and tool counts. Recommended as
  the first call before any other tool invocation.
- **`resolveHandle()` method + `AlterResolveHandleInput` /
  `AlterResolveHandleOutput` types.** Wraps the `alter_resolve_handle` tool, the
  public `~handle` entry point. Accepts either a `{ query }` object or a bare
  handle string for ergonomics. No auth required; returns canonical form, kind,
  and addressability without exposing PII.

### Removed

- **Tool bindings the live server does not serve.** Seven tools lived in
  `FREE_TOOL_NAMES` / `PREMIUM_TOOL_NAMES`, `ToolInputs` / `ToolOutputs`,
  `TOOL_TIERS` / `TOOL_COSTS` / `TOOL_BLAST_RADIUS`, and as client methods, but
  were not served by the live MCP server, so calling them failed with
  `tool_not_found`:
  - `create_identity_stub` + `createIdentityStub()` + its I/O types
  - `submit_context` + `submitContext()` + its I/O types
  - `dispute_attestation` + `disputeAttestation()` + its I/O types
  - `submit_batch_context` + `submitBatchContext()` + its I/O types
  - `submit_structured_profile` + `submitStructuredProfile()` + its I/O types
  - `submit_social_links` + `submitSocialLinks()` + its I/O types
  - `attest_domain` + `attestDomain()` + its I/O types

  Keeping them as typed methods implied they were callable. Removing them keeps
  the SDK's contract equal to the server's contract. They will return once the
  server serves them.

### Changed

- **README MCP endpoint corrections.** The config-generator code samples
  (`generateClaudeConfig`, `generateCursorConfig`, `generateGenericMcpConfig`),
  the low-level `MCPClient` example, the `AlterClient` x402 example, the
  `discover()` return-shape comment, and the "Local Daemon vs Remote MCP" closer
  all showed the bare branded host `https://mcp.truealter.com` as the
  `endpoint`. Passing that bare host to any of them produces a config whose
  streamable-HTTP POSTs land at `/` and return `405 Method Not Allowed`. The
  wire endpoint is `/api/v1/mcp`. The README now consistently uses
  `https://mcp.truealter.com/api/v1/mcp` in every code sample, matching the
  SDK's `DEFAULT_ENDPOINT` and the resolved output of
  `discover("truealter.com")` after `ensureMcpPath` is applied.
- **Tool count reconciled with live wire reality.** The summary line, the
  free/premium tables, and the x402 tier-structure table now describe the
  **32 tools (24 free L0 + 8 premium L1 to L5)** the live server enumerates via
  `tools/list`. The previous "45 total (32 free + 13 premium)" came from the
  `.well-known/mcp.json` descriptor, which was stale; that file is also
  corrected to 32/24/8 in this release, and `version` is bumped to match.
- **`SDK_VERSION` constant** updated to `0.2.4` (was `0.1.1`, drifted across
  three intervening releases).
- **Module-level JSDoc** at the top of `src/index.ts` and `src/client.ts` now
  describes the 32-tool surface and correctly distinguishes the wire endpoint
  from the branded discovery host.

## [0.2.3] - 2026-04-16

### Changed

- **README endpoint disambiguation.** The `Live MCP endpoint` line previously
  showed only `https://mcp.truealter.com`, which is the branded discovery host.
  POSTing JSON-RPC there returns `405 Method Not Allowed`. The README now calls
  out both surfaces explicitly: the branded host (which serves
  `.well-known/mcp.json`) and the streamable-HTTP wire endpoint at
  `https://mcp.truealter.com/api/v1/mcp` (the SDK default in
  `DEFAULT_ENDPOINT`). The `Initialise the client` code sample was updated to
  match, since passing the bare host string *replaces* the default and would 405
  in production.
- **Tool count clarified as SDK-wrapped vs server-advertised.** The live server
  advertises 45 total tools (32 free + 13 premium); this SDK types 37 (25 free +
  12 premium). The README now shows both, and points readers at the `genericMcp`
  adapter for the untyped remainder. No behavioural change. The typed surface is
  unchanged pending a follow-up that wraps the additional server tools.

## [0.2.1] - 2026-04-15

### Removed

- **Three experimental tool method bindings** whose server-side handlers were
  withdrawn from the live MCP surface on 11 Apr 2026. The SDK still advertised
  them in `FREE_TOOL_NAMES`, the registries (`TOOL_TIERS`, `TOOL_COSTS`,
  `TOOL_BLAST_RADIUS`), and as methods on `AlterClient`. They are now removed so
  the SDK matches what the server actually serves; calls would have failed with
  a tool-not-found error against the live endpoint regardless. The corresponding
  type exports are also removed.

### Changed

- **Vocabulary alignment.** Replaced "member" with "person" throughout README
  prose and JSDoc comments. ~Alter is identity infrastructure, not a hiring
  platform, so descriptive copy now matches that framing. Wire field names
  (`member_id`, and the like) are unchanged because they are server-contract
  identifiers; only human-readable descriptions moved.
- **Trademark notice** now references "the Trill", the canonical name for the
  `~` mark, instead of the legacy "Alter Stroke (~) device mark" wording.
- Tool count summary: `40 total: 28 free (L0) + 12 premium` to
  `37 total: 25 free (L0) + 12 premium`.

## [0.2.0] - 2026-04-15

### Changed

- **Package renamed `@alter/identity` to `@truealter/sdk`.** The `@alter` npm
  namespace is not ours. The package is published under the owned `@truealter`
  scope, matching the canonical `truealter.com` anchor and the existing v0.0.1
  placeholder on npm. Consumers of the legacy name (unpublished, in-repo only)
  must update their `package.json` dependency entry and import paths. The export
  surface is otherwise unchanged.
- **CLI invocation examples updated.** Use `npx alter-identity <cmd>` (or
  `alter-identity <cmd>` post-install). `npx @truealter/sdk` does not resolve,
  because the package ships two bins and neither matches the unscoped package
  name.
- **`SDK_NAME` constant** now returns `@truealter/sdk`.
- **Default `clientInfo.name`** in `MCPClient` and `alter-mcp-bridge` updated to
  `@truealter/sdk` / `@truealter/sdk-mcp-bridge` respectively.

## [0.1.1] - 2026-04-14

### Security

- **Harden `verify_at` resolution against hostile MCP servers.**
  `verifyProvenance()` previously trusted any `http://` or `https://` URL
  supplied in the server response envelope's `verify_at` field when fetching the
  JWKS for ES256 signature verification. A hostile MCP server could point
  `verify_at` at an attacker-controlled JWKS and pass verification with its own
  signing key.
  - JWKS fetches are now **https-only**: `http:` URLs are rejected
    unconditionally, for both `verify_at` hints and caller-supplied `jwksUrl`
    options.
  - Envelope `verify_at` hostnames are gated through a hostname allowlist. The
    default allowlist is `api.truealter.com` and `mcp.truealter.com`.
  - Downstream integrators can extend the allowlist without a fork via the new
    `verifyAtAllowlist` option on both `verifyProvenance()` and the
    `AlterClient` constructor.
  - Callers that supply an explicit `jwksUrl` bypass the envelope entirely (the
    caller has already vouched for the origin); the `https:` scheme requirement
    still applies.
  - New exports: `DEFAULT_VERIFY_AT_ALLOWLIST`, `resolveVerifyAt`,
    `VerifyProvenanceOptions`.

### Added

- `DEFAULT_VERIFY_AT_ALLOWLIST`: the frozen default hostname allowlist.
- `resolveVerifyAt(verifyAt, allowlist?)`: exported for advanced callers and
  test harnesses.
- `AlterClientOptions.verifyAtAllowlist`: per-client allowlist override.

## [0.1.0] - 2026-04-13

- Initial public release.
