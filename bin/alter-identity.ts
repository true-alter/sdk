#!/usr/bin/env node
/**
 * alter-identity CLI.
 *
 *   alter-identity init                 generate keypair, discover endpoint, write config
 *   alter-identity verify <handle>      verify an ALTER identity
 *   alter-identity status               show connection state and cached identity
 *   alter-identity config [--claude|--cursor|--generic]   print MCP config snippet
 *
 * Pure Node, uses `node:fs`, `node:path`, `node:os`. The CLI is the
 * one place we are allowed to depend on Node-only APIs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { argv, exit, stderr, stdin, stdout, env } from 'node:process';
import { createInterface } from 'node:readline';

import { AlterClient } from '../src/client.js';
import type { MCPCallToolResult } from '../src/mcp.js';
import { discover } from '../src/discovery.js';
import { generateKeypair, keypairFromPrivateKey, type Ed25519Keypair } from '../src/auth.js';
import { generateClaudeConfig } from '../src/adapters/claude-code.js';
import { generateCursorConfig } from '../src/adapters/cursor.js';
import { generateClaudeDesktopConfig } from '../src/adapters/claude-desktop.js';
import { generateGenericMcpConfig } from '../src/adapters/generic-mcp.js';
import { SDK_NAME, SDK_VERSION } from '../src/meta.js';
import {
  wire,
  unwire,
  probeAll,
  type ClientId,
  type WireReport,
  type UnwireReport,
} from '../src/wire/index.js';

interface ConfigFile {
  endpoint?: string;
  apiKey?: string;
  keypair?: Ed25519Keypair;
  initialisedAt?: string;
}

const CONFIG_DIR = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'alter');
const CONFIG_PATH = join(CONFIG_DIR, 'identity.json');

async function main(): Promise<void> {
  const [, , command, ...rest] = argv;
  switch (command) {
    case 'init':
      await runInit(rest);
      break;
    case 'verify':
      await runVerify(rest);
      break;
    case 'status':
      await runStatus();
      break;
    case 'config':
      await runConfig(rest);
      break;
    case 'wire':
      await runWire(rest);
      break;
    case 'unwire':
      await runUnwire();
      break;
    case 'message':
      await runMessage(rest);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    case 'version':
    case '--version':
    case '-v':
      stdout.write(`${SDK_NAME} ${SDK_VERSION}\n`);
      break;
    default:
      stderr.write(`unknown command: ${command}\n\n`);
      printHelp();
      exit(2);
  }
}

function printHelp(): void {
  stdout.write(`${SDK_NAME} ${SDK_VERSION}

Usage:
  alter-identity init [--wire|--no-wire] [--yes]
                                            Generate keypair, discover MCP, optionally wire detected AI clients
  alter-identity verify <~handle|email>     Verify an identity
  alter-identity status                     Show connection state
  alter-identity config [--claude|--cursor|--claude-desktop|--generic]
                                            Print MCP config snippet
  alter-identity wire [--only=<ids>] [--yes]
                                            Merge ALTER into detected AI clients (Claude Code, Cursor, Claude Desktop)
  alter-identity unwire                     Restore every target from its backup sibling

Alter-to-Alter Messaging:
  alter-identity message send <~handle> <body>     Send a direct message (body '-' = stdin)
  alter-identity message inbox [--unread]          List your inbound messages
  alter-identity message thread <~handle>          Bidirectional thread view with a peer
  alter-identity message grant <~handle>           Allow a peer to message you
  alter-identity message revoke <~handle>          Revoke a peer's grant

Config: ${CONFIG_PATH}
`);
}

async function runInit(args: string[]): Promise<void> {
  const force = args.includes('--force') || args.includes('-f');
  const wireFlag = args.includes('--wire');
  const noWireFlag = args.includes('--no-wire');
  const yesFlag = args.includes('--yes') || args.includes('-y');
  if (wireFlag && noWireFlag) {
    stderr.write('error: --wire and --no-wire are mutually exclusive\n');
    exit(2);
  }

  const existing = readConfig();
  if (existing && !force) {
    stdout.write(`already initialised at ${CONFIG_PATH} (re-run with --force to overwrite)\n`);
    return;
  }

  stdout.write('• Generating Ed25519 keypair...\n');
  const keypair = generateKeypair();

  stdout.write('• Discovering MCP endpoint for truealter.com...\n');
  let endpoint: string;
  try {
    const result = await discover('truealter.com');
    endpoint = result.url;
    stdout.write(`  → ${endpoint} (via ${result.source})\n`);
  } catch (err) {
    endpoint = 'https://mcp.truealter.com/api/v1/mcp';
    stdout.write(`  → ${endpoint} (discovery failed: ${(err as Error).message})\n`);
  }

  const cfg: ConfigFile = { endpoint, keypair, initialisedAt: new Date().toISOString() };
  writeConfig(cfg);
  stdout.write(`• Wrote config to ${CONFIG_PATH}\n`);
  stdout.write(`  did: ${keypair.did}\n`);

  // Wire decision. --no-wire wins silently; --wire/--yes wires without
  // prompting; no flag + TTY prompts; no flag + non-TTY skips.
  let shouldWire = false;
  if (noWireFlag) {
    shouldWire = false;
  } else if (wireFlag || yesFlag) {
    shouldWire = true;
  } else if (stdin.isTTY) {
    const probes = probeAll();
    const found = probes.filter((p) => p.installed).map((p) => p.client.label);
    if (found.length === 0) {
      stdout.write('\nNo MCP-aware clients detected on this machine, skipping wire.\n');
    } else {
      stdout.write(`\nDetected MCP-aware clients: ${found.join(', ')}\n`);
      shouldWire = await confirm('Wire detected AI clients to ALTER?', true);
    }
  }

  if (shouldWire) {
    stdout.write('\n• Wiring detected AI clients...\n');
    const report = wire({ endpoint });
    printWireReport(report);
  }

  stdout.write(`\nNext: alter-identity verify ~truealter\n`);
}

async function runVerify(args: string[]): Promise<void> {
  const handle = args[0];
  if (!handle) {
    stderr.write('usage: alter-identity verify <~handle|email|uuid>\n');
    exit(2);
  }
  const cfg = readConfig() ?? {};
  const client = new AlterClient({ endpoint: cfg.endpoint, apiKey: cfg.apiKey });
  try {
    const result = await client.verify(handle);
    const text = result.content?.[0]?.text ?? JSON.stringify(result.data ?? result, null, 2);
    stdout.write(text + '\n');
  } catch (err) {
    stderr.write(`verify failed: ${(err as Error).message}\n`);
    exit(1);
  }
}

async function runStatus(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) {
    stdout.write(`not initialised, run \`alter-identity init\`\n`);
    return;
  }
  stdout.write(`config:        ${CONFIG_PATH}\n`);
  stdout.write(`endpoint:      ${cfg.endpoint ?? '(default)'}\n`);
  stdout.write(`api key:       ${cfg.apiKey ? '(set)' : '(none)'}\n`);
  if (cfg.keypair) {
    const recovered = keypairFromPrivateKey(cfg.keypair.privateKey);
    stdout.write(`did:           ${recovered.did}\n`);
  }
  stdout.write(`initialised:   ${cfg.initialisedAt ?? '(unknown)'}\n`);

  // Probe the endpoint
  const client = new AlterClient({ endpoint: cfg.endpoint, apiKey: cfg.apiKey });
  try {
    const stats = await client.getNetworkStats();
    const text = stats.content?.[0]?.text ?? JSON.stringify(stats.data ?? '');
    stdout.write(`network probe: ok, ${text.slice(0, 120)}\n`);
  } catch (err) {
    stdout.write(`network probe: failed, ${(err as Error).message}\n`);
  }
}

async function runConfig(args: string[]): Promise<void> {
  const cfg = readConfig() ?? {};
  const opts = { endpoint: cfg.endpoint, apiKey: cfg.apiKey };
  let out: unknown;
  if (args.includes('--cursor')) out = generateCursorConfig(opts);
  else if (args.includes('--claude-desktop')) out = generateClaudeDesktopConfig(opts);
  else if (args.includes('--generic')) out = generateGenericMcpConfig(opts);
  else out = generateClaudeConfig(opts); // default
  stdout.write(JSON.stringify(out, null, 2) + '\n');
}

async function runWire(args: string[]): Promise<void> {
  const yesFlag = args.includes('--yes') || args.includes('-y');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg
    ? (onlyArg.slice('--only='.length).split(',').filter(Boolean) as ClientId[])
    : undefined;

  const cfg = readConfig() ?? {};
  if (!cfg.endpoint) {
    stderr.write('error: no endpoint, run `alter-identity init` first\n');
    exit(2);
  }

  if (!yesFlag && stdin.isTTY) {
    const probes = probeAll();
    const found = probes.filter((p) => p.installed).map((p) => p.client.label);
    if (found.length === 0) {
      stdout.write('No MCP-aware clients detected on this machine. Nothing to do.\n');
      return;
    }
    stdout.write(`Detected: ${found.join(', ')}\n`);
    const proceed = await confirm('Wire these clients to ALTER?', true);
    if (!proceed) {
      stdout.write('aborted.\n');
      return;
    }
  }

  const report = wire({ endpoint: cfg.endpoint, apiKey: cfg.apiKey, only });
  printWireReport(report);
}

async function runUnwire(): Promise<void> {
  const report = unwire();
  printUnwireReport(report);
}

function printWireReport(report: WireReport): void {
  for (const target of report.state.targets) {
    const tag = `[${target.client}]`;
    switch (target.status) {
      case 'written':
        if (target.method === 'file') {
          stdout.write(`  ✓ ${tag} wrote ${target.path} (backup: ${target.backupPath ?? '(none, created new file)'})\n`);
        } else {
          stdout.write(`  ✓ ${tag} registered via \`${target.command}\`\n`);
        }
        break;
      case 'already-wired':
        stdout.write(`  · ${tag} already wired, no change\n`);
        break;
      case 'skipped':
        stdout.write(`  - ${tag} skipped (${target.reason ?? 'not installed'})\n`);
        break;
      case 'failed':
        stderr.write(`  ✗ ${tag} failed: ${target.reason ?? 'unknown'}\n`);
        break;
    }
  }
  stdout.write(`\nwire-state → ${join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'alter', 'wire-state.json')}\n`);
  stdout.write('run `alter-identity unwire` to reverse.\n');
}

function printUnwireReport(report: UnwireReport): void {
  if (!report.state) {
    stdout.write('nothing to unwire, no wire-state.json found\n');
    return;
  }
  if (report.state.targets.length === 0) {
    stdout.write('wire-state.json is empty, nothing to unwire\n');
    return;
  }
  for (const entry of report.undone) {
    const tag = `[${entry.client}]`;
    switch (entry.action) {
      case 'restored':
        stdout.write(`  ✓ ${tag} restored from backup\n`);
        break;
      case 'removed':
        stdout.write(`  ✓ ${tag} removed (file was created by wire)\n`);
        break;
      case 'cli-removed':
        stdout.write(`  ✓ ${tag} removed via \`claude mcp remove\`\n`);
        break;
      case 'skipped':
        stdout.write(`  · ${tag} skipped (${entry.reason ?? ''})\n`);
        break;
      case 'failed':
        stderr.write(`  ✗ ${tag} failed: ${entry.reason ?? ''}\n`);
        break;
    }
  }
}

async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  const answer = await new Promise<string>((resolve) => {
    rl.question(question + suffix, (ans) => resolve(ans));
  });
  rl.close();
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultYes;
  return trimmed === 'y' || trimmed === 'yes';
}

// ── Alter-to-Alter Messaging ────────────────────────────────────────────

async function runMessage(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub) {
    stderr.write('usage: alter-identity message <send|inbox|thread|grant|revoke> ...\n');
    exit(2);
  }

  const cfg = readConfig() ?? {};
  const client = new AlterClient({ endpoint: cfg.endpoint, apiKey: cfg.apiKey });

  const printResult = (result: MCPCallToolResult): void => {
    const text = result.content?.[0]?.text;
    if (text) {
      stdout.write(text + '\n');
      return;
    }
    if (result.data !== undefined) {
      stdout.write(JSON.stringify(result.data, null, 2) + '\n');
      return;
    }
    stdout.write(JSON.stringify(result, null, 2) + '\n');
  };

  try {
    switch (sub) {
      case 'send': {
        const to = rest[0];
        let body = rest[1];
        if (!to || !body) {
          stderr.write('usage: alter-identity message send <~handle> <body|->\n');
          exit(2);
        }
        if (body === '-') {
          // Read body from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of (await import('node:process')).stdin) {
            chunks.push(chunk as Buffer);
          }
          body = Buffer.concat(chunks).toString('utf8').trim();
          if (!body) {
            stderr.write('error: empty body on stdin\n');
            exit(2);
          }
        }
        const result = await client.messageSend({ to, body });
        printResult(result);
        break;
      }
      case 'inbox': {
        const unreadOnly = rest.includes('--unread');
        const sinceArg = rest.find((a) => a.startsWith('--since='));
        const since = sinceArg ? sinceArg.slice('--since='.length) : undefined;
        const result = await client.messageInbox({
          unread_only: unreadOnly || undefined,
          since,
        });
        printResult(result);
        break;
      }
      case 'thread': {
        const peer = rest[0];
        if (!peer) {
          stderr.write('usage: alter-identity message thread <~handle>\n');
          exit(2);
        }
        const result = await client.messageThread({ with: peer });
        printResult(result);
        break;
      }
      case 'grant': {
        const peer = rest[0];
        if (!peer) {
          stderr.write('usage: alter-identity message grant <~handle>\n');
          exit(2);
        }
        const result = await client.messageGrant({ peer });
        printResult(result);
        break;
      }
      case 'revoke': {
        const peer = rest[0];
        if (!peer) {
          stderr.write('usage: alter-identity message revoke <~handle>\n');
          exit(2);
        }
        const result = await client.messageRevoke({ peer });
        printResult(result);
        break;
      }
      case 'mark-read': {
        const ids = rest.filter((a) => !a.startsWith('--'));
        if (ids.length === 0) {
          stderr.write('usage: alter-identity message mark-read <id> [<id> ...]\n');
          exit(2);
        }
        const result = await client.messageMarkRead({ message_ids: ids });
        printResult(result);
        break;
      }
      case 'redact': {
        const id = rest[0];
        if (!id) {
          stderr.write('usage: alter-identity message redact <id>\n');
          exit(2);
        }
        const result = await client.messageRedact({ message_id: id });
        printResult(result);
        break;
      }
      default:
        stderr.write(`unknown message subcommand: ${sub}\n`);
        exit(2);
    }
  } catch (err) {
    stderr.write(`message ${sub} failed: ${(err as Error).message}\n`);
    exit(1);
  }
}

function readConfig(): ConfigFile | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ConfigFile;
  } catch {
    return null;
  }
}

function writeConfig(cfg: ConfigFile): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

main().catch((err: unknown) => {
  stderr.write(`error: ${(err as Error).message}\n`);
  exit(1);
});
