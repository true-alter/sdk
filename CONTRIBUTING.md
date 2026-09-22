# Contributing to @truealter/sdk

This repository is the home of the SDK that ships on npm as [`@truealter/sdk`](https://www.npmjs.com/package/@truealter/sdk).

## Quick orientation

The source each release is built and published from is the [`export/main`](https://github.com/true-alter/sdk/tree/export/main) branch: `src/` for the library, `bin/` for the MCP bridge, `examples/` for worked examples. This branch, `main`, carries the documentation, the release workflow and the issue tracker.

To read or run the source:

```bash
git clone --branch export/main https://github.com/true-alter/sdk.git alter-sdk
cd alter-sdk
npm install
npm run typecheck
npm run build
```

## Reporting bugs

[Open an issue](https://github.com/true-alter/sdk/issues) with:

- The method you called, the arguments you passed (redact real identifiers where relevant), and the SDK version.
- The error message or unexpected behaviour, ideally with a minimal reproduction script.
- Whether the same call reproduces against the live MCP endpoint (`https://mcp.truealter.com`) via `curl`, helps us distinguish SDK bug from server bug.
- Node / Deno / Bun / runtime version.

## Small patches welcome

Typo fixes, README clarifications, tightened error messages, better TypeScript types: open an issue with the change you want, or a PR against `main` for anything on this branch. `export/main` is written by the release pipeline and never by hand, so a source patch is taken from the issue rather than merged onto that branch.

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

Every non-trivial change needs a test. Provenance, discovery, x402 and auth each have their own coverage, say in the issue which one your change belongs under and what it asserts.

## Security issues

Do **not** open public GitHub issues for vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure address.

## Licensing

By submitting a pull request you agree that your contribution is licensed under Apache-2.0, matching the rest of the repository.
