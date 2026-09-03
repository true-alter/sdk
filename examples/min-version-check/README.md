# min-version-check, D-MIN-VERSION-FLOOR-1 worked example

Third-party integrators MUST call `checkMinVersion()` (or rely on the
default constructor preflight) before talking to ~alter. The SDK throws
a typed `BelowFloorError` when the running version is below the
published floor; the server-side gate (HTTP 426 Upgrade Required)
catches anything the client misses.

This example shows both shapes, the explicit pre-flight, and the
implicit constructor-level lazy invocation.

## Run

```sh
cd examples/min-version-check
npm install
npx tsx index.ts
```

(`tsx` is dev-only; for production you'd build via `tsc` or `tsup`.)

## What it does

1. Constructs an `AlterClient` with the default lazy preflight.
2. Demonstrates the explicit `checkMinVersion()` form.
3. Catches `BelowFloorError` and prints the upgrade command.
4. Shows the `unsafe_skipVersionCheck` escape hatch, discouraged.

## When to call it

- Production integrators: rely on the default constructor preflight.
  The hook fires on the first network call, caches the verdict in
  memory for an hour, and refreshes once a day from disk.
- CLI / CI pipelines: call `checkMinVersion()` explicitly at startup
  to surface upgrade prompts before any real work happens.
- Tests: pass `unsafe_skipVersionCheck: true` to skip the client-side
  preflight (the server-side gate still enforces HTTP 426).

## Read more

- Decision spec, `D-MIN-VERSION-FLOOR-1` in the Strategic Decisions Register.
- Ed25519 signing details match ~alter's server-side floor-signing verifier byte-for-byte (the SDK carries public keys only).
- Connectivity ladder + offline lockout, §8 and §9 of the spec.
