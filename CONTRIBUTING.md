# Contributing to @truealter/sdk

This repository is the **public source** of the SDK that ships on npm as [`@truealter/sdk`](https://www.npmjs.com/package/@truealter/sdk). Patches merged here are incorporated into tagged releases.

## Quick orientation

- **Source:** `src/`
- **Tests:** `tests/` (vitest)
- **Binaries:** `bin/` (`alter-identity`, `alter-mcp-bridge`)
- **Examples:** `examples/`
- **CI:** `.github/workflows/ci.yml`, typecheck, vitest, build

```bash
git clone https://github.com/true-alter/alter-identity.git
cd alter-identity
npm install
npm run typecheck
npm test
npm run build
```

## Reporting bugs

[Open an issue](https://github.com/true-alter/alter-identity/issues) with:

- The method you called, the arguments you passed (redact real identifiers where relevant), and the SDK version.
- The error message or unexpected behaviour, ideally with a minimal reproduction script.
- Whether the same call reproduces against the live MCP endpoint (`https://mcp.truealter.com`) via `curl`, helps us distinguish SDK bug from server bug.
- Node / Deno / Bun / runtime version.

## Small patches welcome

Typo fixes, README clarifications, tightened error messages, extra test coverage, better TypeScript types: open a PR against `main`. Keep each PR focused on one concern.

## Larger design changes

Open an issue **before** the PR so we can talk about scope. The SDK surface is constrained by the MCP server it talks to; changes that add client-side state machines, retry policies, or tool-discovery magic that the server doesn't back will typically be redirected.

Specific asks that come up often:

- **Adding a new tool to the typed surface.** The server has to ship the tool first. If you're looking at an undocumented tool, that's almost always a sign the SDK is ahead of the server. File an issue against the live MCP server rather than a PR here.
- **Swapping the crypto backend.** `@noble/ed25519` + `@noble/hashes` was chosen deliberately for a zero-deps-beyond-noble surface. Pull requests replacing them with larger toolkits (jose, etc.) will be declined unless there's a concrete protocol reason.
- **Wallet integration.** The SDK is explicitly wallet-agnostic, `X402Signer` is the seam. Don't ship a viem/ethers dependency from here.

## Style

- TypeScript, strict mode. ESM + CJS dual output via `tsup`.
- Prose: Australian English in README/docs; US English in code identifiers (`color`, `initialize`).
- No telemetry, no auto-update pingers, no background network activity. If a PR introduces any, it will not land.
- Match the existing error taxonomy (`AlterError`, `AlterProvenanceError`, etc.) rather than throwing bare `Error`s.

## Tests

Every non-trivial change needs a test. Provenance, discovery, x402, and auth have dedicated test files, extend the nearest match. `tests/` is wired to vitest; `npm test` runs the whole suite.

## Security issues

Do **not** open public GitHub issues for vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure address.

## Licensing

By submitting a pull request you agree that your contribution is licensed under Apache-2.0, matching the rest of the repository.
