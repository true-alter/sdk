/**
 * min-version-check — worked example for D-MIN-VERSION-FLOOR-1.
 *
 * Run with: `npx tsx index.ts`
 *
 * Demonstrates three patterns:
 *   1. Default lazy preflight — the constructor installs a preflight
 *      hook that fires on the first network call, no manual call needed.
 *   2. Explicit `checkMinVersion()` — call it at startup so the upgrade
 *      prompt surfaces before any real work happens.
 *   3. `unsafe_skipVersionCheck` — escape hatch for tests; the
 *      server-side gate still enforces HTTP 426.
 */

import {
  AlterClient,
  BelowFloorError,
  checkMinVersion,
  SDK_VERSION,
} from '../../src/index.js';

async function demoExplicitPreflight(): Promise<void> {
  console.log(`[demo 1] running checkMinVersion() explicitly (SDK ${SDK_VERSION})…`);
  try {
    const result = await checkMinVersion();
    console.log(
      `  ok — floor=${
        result.floor ? result.floor.min_version : '(none for alter-identity)'
      }; diagnostic=${result.diagnostic}`,
    );
    if (result.warn) console.warn(`  warn: ${result.warn}`);
  } catch (err) {
    if (err instanceof BelowFloorError) {
      console.error(
        `  BLOCKED — your @truealter/sdk is below floor.\n` +
          `    current: ${err.client_version}\n` +
          `    min:     ${err.min_version}\n` +
          `    upgrade: ${err.upgrade_cmd}`,
      );
      process.exit(1);
    }
    throw err;
  }
}

async function demoConstructorLazyPreflight(): Promise<void> {
  console.log(
    `[demo 2] AlterClient constructor — preflight fires lazily on first request`,
  );
  const client = new AlterClient({
    // Defaults are fine for local demo; in production this targets
    // `https://mcp.truealter.com/api/v1/mcp`.
    endpoint: 'https://mcp.truealter.com/api/v1/mcp',
  });
  try {
    // No network call until you hit a method:
    const verified = await client.verify('~alter');
    console.log(`  verified ~alter: ${JSON.stringify(verified.data ?? verified.content?.[0])}`);
  } catch (err) {
    if (err instanceof BelowFloorError) {
      console.error(`  upgrade required: ${err.upgrade_cmd}`);
      process.exit(1);
    }
    // Any other error — network / auth / payment — bubbles up.
    console.error(`  request failed: ${(err as Error).message}`);
  }
}

async function demoUnsafeSkip(): Promise<void> {
  console.log(`[demo 3] unsafe_skipVersionCheck — server-side gate still bites`);
  const client = new AlterClient({
    endpoint: 'https://mcp.truealter.com/api/v1/mcp',
    unsafe_skipVersionCheck: true,
  });
  try {
    // If the SDK is below floor, the server returns HTTP 426 here.
    await client.helloAgent();
    console.log('  hello_agent OK — SDK is above floor or floor not enforced yet');
  } catch (err) {
    console.error(`  request failed: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  await demoExplicitPreflight();
  await demoConstructorLazyPreflight();
  await demoUnsafeSkip();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
