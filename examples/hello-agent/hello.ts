/**
 * hello.ts: first connection to ~alter, using the SDK client directly.
 *
 * Four free, no-payment calls chained together: handshake, resolve a
 * handle, list the archetype taxonomy, read network-wide stats. All
 * four work with no credential at all, at the anonymous free tier.
 *
 * Run it as-is:
 *   npx tsx examples/hello-agent/hello.ts
 *
 * With an API key (from `alter register` / `alter login`, or an
 * autonomous agent's own self-minted key), the same client reaches
 * the rest of the tool surface:
 *   ALTER_API_KEY=alt_live_... npx tsx examples/hello-agent/hello.ts
 */

import { AlterClient } from '../../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.ALTER_API_KEY;
  const alter = new AlterClient(apiKey ? { apiKey } : {});

  console.log(apiKey ? '(authenticated)\n' : '(anonymous, free tier; set ALTER_API_KEY for more)\n');

  console.log('1. helloAgent(), handshake');
  const hello = await alter.helloAgent();
  console.log('  ', hello.content[0].text.split('\n')[0]);

  console.log('2. resolveHandle("~alter")');
  const resolved = await alter.resolveHandle('~alter');
  console.log(
    `   canonical=${resolved._meta?.handle} kind=${resolved._meta?.kind} addressable=${resolved._meta?.addressable}`,
  );

  console.log('3. listArchetypes()');
  const archetypes = await alter.listArchetypes();
  const names = archetypes.content[0].text
    .split('\n')
    .filter((line) => line.startsWith('- The '))
    .map((line) => line.split(' (')[0].slice(2));
  console.log(`   ${names.length} archetypes: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '...' : ''}`);

  console.log('4. getNetworkStats()');
  const stats = await alter.getNetworkStats();
  console.log(
    `   identities=${stats._meta?.total_identities} verified=${stats._meta?.total_verified} queries=${stats._meta?.total_queries}`,
  );

  console.log('\nTool reference: https://truealter.com/docs/mcp/tools');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
