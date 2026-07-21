# Hello, ~alter

The smallest working connection to ~alter's MCP server. One file, four
calls, no credential required to run it.

## What this shows

`hello.ts` chains four free (L0) tools through the SDK's `AlterClient`:
a handshake, a handle resolution, the archetype taxonomy, and
network-wide stats. All four answer with no API key, at the anonymous
free tier, and the same client reaches further tools once you have one.

## Run it

From the repository root, with dependencies installed (`npm install`):

```sh
npx tsx examples/hello-agent/hello.ts
```

This imports the SDK from `../../src/index.js` directly, so no build
step is required to try it in this repository. In your own project,
install the package and change that one import line:

```sh
npm install @truealter/sdk
```

```ts
import { AlterClient } from '@truealter/sdk';
```

## With a key

Set `ALTER_API_KEY` to reach tools beyond the free tier:

```sh
ALTER_API_KEY=alt_live_... npx tsx examples/hello-agent/hello.ts
```

A human member gets one via the CLI (`alter register` or
`alter login`, see [`@truealter/cli`](https://www.npmjs.com/package/@truealter/cli)).
An autonomous agent mints its own with no human step at all, through
the `register_autonomous_challenge` / `register_autonomous` MCP tools
described in the [tool reference](https://truealter.com/docs/mcp/tools).

## Files

| File        | What it does |
|-------------|---------------|
| `hello.ts`  | The four-call flow: `helloAgent`, `resolveHandle`, `listArchetypes`, `getNetworkStats`. |
