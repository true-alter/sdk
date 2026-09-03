/**
 * Public `wire` / `unwire` entry points.
 *
 * `wire()` probes for installed MCP clients, merges the ~Alter entry
 * into each client's config (via atomic JSON merge or CLI handoff),
 * writes a `wire-state.json` provenance artefact, and returns a
 * structured report. `unwire()` reads that artefact and reverses
 * every target.
 *
 * Synchronous throughout: the CLI path is sequential and the
 * deterministic ordering is worth the tiny blocking cost.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { DEFAULT_ENDPOINT, MEMBER_BRIDGE_ENDPOINT } from '../client.js';
import { SDK_VERSION } from '../meta.js';
import { generateClaudeDesktopConfig } from '../adapters/claude-desktop.js';
import { generateGenericMcpConfig } from '../adapters/generic-mcp.js';
import { ALL_CLIENTS, type ClientId, type ClientPaths } from './paths.js';
import { probeAll, probeClaudeCode, probeByDir, type ProbeResult } from './probe.js';
import { detectSyncedVolume } from './sync.js';
import { readWireState, writeWireState, type WireState, type WireTarget } from './state.js';
import { atomicJsonMerge, restoreFromBackup } from './write.js';

export interface CfAccessCredentials {
  clientId: string;
  clientSecret: string;
}

export interface WireOptions {
  /** Override the endpoint written into every client config. Defaults to DEFAULT_ENDPOINT. */
  endpoint?: string;
  /** Optional API key written into `headers['X-ALTER-API-Key']` for each target. */
  apiKey?: string;
  /** CF Access service token credentials. Auto-read from ~/.config/alter/cf-access.env when absent. */
  cfAccess?: CfAccessCredentials;
  /** Restrict to a subset of client ids. Default: every detected client. */
  only?: readonly ClientId[];
  /** Skip any client whose probe said "not installed" even if the caller passed it via `only`. */
  skipMissing?: boolean;
  /**
   * Absolute path to the `alter` CLI launcher entry (its `dist/index.js`).
   * When set, Claude Code is wired to run `node <launcherPath> mcp-bridge`,
   * which injects the ES256 signing credential (ALTER_SIGNING_KEY /
   * ALTER_SIGNING_KID) from the OS secure store before spawning the bridge,
   * so MCP tool calls are signed. When absent (standalone SDK use without the
   * CLI), wiring falls back to `node <bridge>`: anonymous / L0, no signing.
   */
  launcherPath?: string;
}

export interface WireReport {
  state: WireState;
  probes: ProbeResult[];
}

const TIMESTAMP = (): string => String(Math.floor(Date.now() / 1000));
const ISO_NOW = (): string => new Date().toISOString();

// Functional infra plumbing, not a member-facing instruction. Members
// authenticate with the bearer credential from `alter login` and are never
// asked to obtain or apply a CF Access token. This optional read supports an
// OPERATOR who self-hosts a CF-gated endpoint; the CF_ACCESS_CLIENT_ID/SECRET
// keys are the operator-facing file-format contract for ~/.config/alter/
// cf-access.env and must match what such an operator writes there. Absent file
// is the common case and is handled silently.
function readCfAccessEnv(): CfAccessCredentials | undefined {
  const envPath = join(homedir(), '.config', 'alter', 'cf-access.env');
  try {
    const content = readFileSync(envPath, 'utf8');
    let clientId = '';
    let clientSecret = '';
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).replace(/^export\s+/, '').trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'CF_ACCESS_CLIENT_ID') clientId = val;
      if (key === 'CF_ACCESS_CLIENT_SECRET') clientSecret = val;
    }
    if (clientId && clientSecret) return { clientId, clientSecret };
  } catch {
    // File not present: CF Access not configured on this machine.
  }
  return undefined;
}

function clientById(id: ClientId): ClientPaths {
  const hit = ALL_CLIENTS.find((c) => c.id === id);
  if (!hit) throw new Error(`unknown client id: ${id}`);
  return hit;
}

export function wire(opts: WireOptions = {}): WireReport {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const apiKey = opts.apiKey;
  const cfAccess = opts.cfAccess ?? readCfAccessEnv();
  const launcherPath = opts.launcherPath;
  const probes = probeAll();
  const selection: ClientId[] = (opts.only ?? probes.filter((p) => p.installed).map((p) => p.client.id)) as ClientId[];
  const ts = TIMESTAMP();
  const targets: WireTarget[] = [];

  for (const id of selection) {
    const probe = id === 'claude-code' ? probeClaudeCode() : probeByDir(id);
    if (!probe.installed && opts.skipMissing !== false) {
      targets.push({
        client: id,
        method: id === 'claude-code' ? 'cli' : 'file',
        status: 'skipped',
        ...(id === 'claude-code'
          ? { command: '' }
          : { path: clientById(id).configPath ?? '', backupPath: null, configKeyPath: clientById(id).configKeyPath, serverName: 'alter', preSha256: null, postSha256: '' }),
        reason: probe.reason,
      } as WireTarget);
      continue;
    }

    try {
      if (id === 'claude-code') {
        targets.push(wireClaudeCode({ endpoint, apiKey, cfAccess, launcherPath }));
      } else {
        targets.push(wireFileTarget({ id, endpoint, apiKey, cfAccess, timestamp: ts }));
      }
    } catch (err) {
      const message = (err as Error).message;
      targets.push({
        client: id,
        method: id === 'claude-code' ? 'cli' : 'file',
        status: 'failed',
        ...(id === 'claude-code'
          ? { command: '' }
          : { path: clientById(id).configPath ?? '', backupPath: null, configKeyPath: clientById(id).configKeyPath, serverName: 'alter', preSha256: null, postSha256: '' }),
        reason: message,
      } as WireTarget);
    }
  }

  const state: WireState = {
    version: 1,
    sdkVersion: SDK_VERSION,
    writtenAt: ISO_NOW(),
    endpoint,
    targets,
  };
  writeWireState(state);
  return { state, probes };
}

/**
 * Merge a single named server entry into `existing` at `keyPath`,
 * preserving every sibling key at every level along the way. Handles
 * both a flat one-segment path (`['mcpServers']`) and a nested path
 * (`['mcp', 'servers']`) with the same logic: recurse one segment at a
 * time, rebuilding only the branch that changed. Pure + exported for
 * tests.
 */
export function mergeAtKeyPath(
  existing: Record<string, unknown>,
  keyPath: readonly string[],
  serverName: string,
  source: Record<string, unknown>,
): Record<string, unknown> {
  if (keyPath.length === 0) {
    throw new Error('configKeyPath must have at least one segment');
  }
  const [head, ...rest] = keyPath;
  const child = (existing[head] as Record<string, unknown> | undefined) ?? {};

  if (rest.length === 0) {
    return {
      ...existing,
      [head]: {
        ...child,
        [serverName]: source,
      },
    };
  }

  return {
    ...existing,
    [head]: mergeAtKeyPath(child, rest, serverName, source),
  };
}

/** Return a shallow copy of `obj` with the named fields removed. Exported for tests. */
export function omitFields(
  obj: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out = { ...obj };
  for (const field of fields) delete out[field];
  return out;
}

function wireFileTarget(args: {
  id: ClientId;
  endpoint: string;
  apiKey: string | undefined;
  cfAccess: CfAccessCredentials | undefined;
  timestamp: string;
}): WireTarget {
  const client = clientById(args.id);
  if (!client.configPath) {
    throw new Error(`client ${client.id} has no file-based config path`);
  }

  const sync = detectSyncedVolume(client.configPath);
  if (sync) {
    throw new Error(
      `refusing to wire ${client.label}: config path ${sync.resolvedPath} lives under ${sync.matchedPrefix}. ` +
        'Synced volumes propagate credentials across devices: move the config off the sync root, or run wire on the device you want to target.',
    );
  }

  // Build the merged entry using the relevant adapter so the shape
  // stays consistent with `alter-identity config` output.
  const cfHeaders: Record<string, string> = {};
  if (args.cfAccess) {
    cfHeaders['CF-Access-Client-Id'] = args.cfAccess.clientId;
    cfHeaders['CF-Access-Client-Secret'] = args.cfAccess.clientSecret;
  }

  const entry =
    args.id === 'claude-desktop'
      ? generateClaudeDesktopConfig({ endpoint: args.endpoint, apiKey: args.apiKey })
      : generateGenericMcpConfig({ endpoint: args.endpoint, apiKey: args.apiKey, headers: cfHeaders });

  const configKeyPath = client.configKeyPath;
  const serverName = 'alter';

  // `entry.mcpServers.alter` is the canonical source shape every adapter
  // produces; each client hoists it under its own configKeyPath instead.
  const rawSource = entry.mcpServers.alter as unknown as Record<string, unknown>;
  const source = client.omitEntryFields
    ? omitFields(rawSource, client.omitEntryFields)
    : rawSource;

  const result = atomicJsonMerge({
    path: client.configPath,
    timestamp: args.timestamp,
    merge: (existing) => mergeAtKeyPath(existing, configKeyPath, serverName, source),
  });

  return {
    client: args.id,
    method: 'file',
    status: result.noop ? 'already-wired' : 'written',
    path: result.path,
    backupPath: result.backupPath,
    configKeyPath,
    serverName,
    preSha256: result.preSha256,
    postSha256: result.postSha256,
  };
}

/**
 * Remove a secret value from a human-facing string (the wired command echo
 * surfaced by `alter wire --json` and persisted into wire-state.json). The
 * member key lives in the real argv as `--env ALTER_API_KEY=<key>`; this
 * redacts every occurrence of the literal value so it never reaches a log,
 * a JSON dump, or the on-disk provenance artefact. No-op when the secret is
 * absent. Exported for tests.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('***redacted***');
}

/**
 * Build the `claude mcp add ...` argv for the ~Alter server.
 *
 * `subprocessArgv` is the already-resolved stdio command Claude Code runs
 * after the `--` terminator: `['node', <launcher>, 'mcp-bridge']` for the
 * signing launcher (injects ALTER_SIGNING_KEY/KID from the OS secure store),
 * `['node', <bridge>]` for standalone SDK use (anonymous / L0), or `null` to
 * fall back to the HTTP transport.
 *
 * Arg ordering matters: Claude Code's `--env` is a VARIADIC option
 * (`-e, --env <env...>`), so the server name MUST come before the `--env`
 * flags or the variadic greedily consumes it. The trailing `--` terminates
 * the variadic and separates the subprocess command.
 *
 * Pure + exported for tests.
 */
export function buildClaudeCodeAddArgs(args: {
  apiKey: string | undefined;
  subprocessArgv: string[] | null;
  endpoint: string;
}): string[] {
  if (args.subprocessArgv) {
    return [
      'mcp',
      'add',
      '--scope',
      'user',
      'alter',
      '--env',
      `ALTER_MCP_ENDPOINT=${MEMBER_BRIDGE_ENDPOINT}`,
      '--env',
      `ALTER_PUBLIC_MCP_ENDPOINT=${MEMBER_BRIDGE_ENDPOINT}`,
      ...(args.apiKey ? ['--env', `ALTER_API_KEY=${args.apiKey}`] : []),
      '--',
      ...args.subprocessArgv,
    ];
  }
  return [
    'mcp',
    'add',
    '--scope',
    'user',
    '--transport',
    'http',
    'alter',
    args.endpoint,
    ...(args.apiKey ? ['--header', `X-ALTER-API-Key:${args.apiKey}`] : []),
  ];
}

function wireClaudeCode(args: {
  endpoint: string;
  apiKey: string | undefined;
  cfAccess: CfAccessCredentials | undefined;
  launcherPath?: string;
}): WireTarget {
  const cmd = 'claude';

  // The ~Alter MCP endpoint is POST-only (no StreamableHTTP SSE support).
  // Claude Code's HTTP transport sends GET first, which 404s. Use a
  // stdio bridge that proxies JSON-RPC with full auth header injection.
  //
  // When the bridge (stdio) path is used, bake the member endpoint and API
  // key into the SAVED Claude Code entry via `--env KEY=VAL` flags. This
  // ensures every future spawn of the bridge (including Claude Code restarts
  // and stripped-env spawns on Windows) targets the bearer-first member
  // runtime endpoint and never falls back to the CF-Access-gated host.
  //
  // The member bridge endpoint is always MEMBER_BRIDGE_ENDPOINT
  // (https://api.truealter.com/api/v1/mcp), not args.endpoint which is the
  // public-discovery DEFAULT_ENDPOINT. The bridge is exclusively a member
  // runtime path; it must never default to the CF-gated host.
  // Arg ordering matters: Claude Code's `--env` is a VARIADIC option
  // (`-e, --env <env...>`), so the server name MUST come before the `--env`
  // flags or the variadic greedily consumes it ("Invalid environment variable
  // format: alter"). The trailing `--` terminates the variadic and separates
  // the subprocess command: `add <name> --env K=V ... -- node <bridge>`.
  const bridgePath = resolveBridgeScript();

  // Preferred subprocess: the `alter mcp-bridge` launcher (args.launcherPath
  // points at the CLI's dist entry). The launcher injects ALTER_SIGNING_KEY /
  // ALTER_SIGNING_KID from the OS secure store before spawning the bridge, so
  // MCP tool calls are signed (ES256). Run it as `node <launcher> mcp-bridge`
  // by ABSOLUTE path: never a bare `alter` on PATH, because Claude Code spawns
  // MCP servers with a stripped environment on Windows and a .cmd/.ps1 bin
  // shim cannot be spawned without a shell. Fall back to `node <bridge>` for
  // standalone SDK installs where the CLI is absent: that path is anonymous /
  // L0 (no secure store, no signing).
  const launcher =
    args.launcherPath && existsSync(args.launcherPath) ? args.launcherPath : null;
  const subprocessArgv = launcher
    ? ['node', launcher, 'mcp-bridge']
    : bridgePath
      ? ['node', bridgePath]
      : null;

  const argList = buildClaudeCodeAddArgs({
    apiKey: args.apiKey,
    subprocessArgv,
    endpoint: args.endpoint,
  });

  // The echoed/persisted command string must never carry the cleartext member
  // key: it is surfaced by `alter wire --json` and written into wire-state.json.
  // The real argList (key in --env, never argv) is what spawnSync runs; only
  // this human-facing echo is redacted.
  const full = redactSecret(`${cmd} ${argList.join(' ')}`, args.apiKey);

  const run = spawnSync(cmd, argList, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 10_000,
    env: subprocessArgv
      ? {
          ...process.env,
          ALTER_MCP_ENDPOINT: MEMBER_BRIDGE_ENDPOINT,
          ALTER_PUBLIC_MCP_ENDPOINT: MEMBER_BRIDGE_ENDPOINT,
          ...(args.apiKey ? { ALTER_API_KEY: args.apiKey } : {}),
        }
      : undefined,
  });

  if (run.error) {
    return {
      client: 'claude-code',
      method: 'cli',
      status: 'failed',
      command: full,
      stdout: run.stdout,
      stderr: run.stderr,
      reason: run.error.message,
    };
  }

  const stderr = (run.stderr ?? '').toLowerCase();
  const alreadyExists = stderr.includes('already exists') || stderr.includes('already configured');

  if (run.status === 0) {
    return { client: 'claude-code', method: 'cli', status: 'written', command: full, stdout: run.stdout, stderr: run.stderr };
  }
  if (alreadyExists) {
    return { client: 'claude-code', method: 'cli', status: 'already-wired', command: full, stdout: run.stdout, stderr: run.stderr };
  }
  return {
    client: 'claude-code',
    method: 'cli',
    status: 'failed',
    command: full,
    stdout: run.stdout,
    stderr: run.stderr,
    reason: `claude mcp add exited ${String(run.status)}`,
  };
}

function resolveBridgeScript(): string | null {
  // Use import.meta.url (ESM-safe) instead of the CJS __filename global,
  // and use the statically-imported existsSync/join/dirname rather than
  // dynamic require() calls. The dynamic require pattern caused esbuild to
  // emit an __require shim that throws "Dynamic require of fs is not
  // supported" when the bundle runs in an ESM context (Node 18+, type:module
  // packages). Static imports are resolved at bundle time and never hit the
  // shim path.
  const here = dirname(fileURLToPath(import.meta.url));

  // The build emits the zero-dependency bridge at dist/bin/mcp-bridge.js.
  // In the bundled SDK the wire code runs from dist/index.js, so `here` is
  // the dist root and the bridge sits in its `bin` subdir. Check that first:
  // without it resolveBridgeScript returned null and wireClaudeCode silently
  // fell through to the HTTP-transport branch (a GET-first transport the
  // POST-only ~Alter endpoint cannot serve), the real "Failed to connect" path.
  const distBinBridge = join(here, 'bin', 'mcp-bridge.js');
  if (existsSync(distBinBridge)) return distBinBridge;

  // Same bridge, addressed from a nested module dir (here = dist/<sub>).
  const nestedDistBinBridge = join(here, '..', 'dist', 'bin', 'mcp-bridge.js');
  if (existsSync(nestedDistBinBridge)) return nestedDistBinBridge;

  // Legacy/dev layouts where the bridge sits at the dist root.
  const siblingBridge = join(here, '..', 'dist', 'mcp-bridge.js');
  if (existsSync(siblingBridge)) return siblingBridge;

  // Fallback: look relative to this source file (dev/monorepo layout)
  const srcBridge = join(here, '..', 'mcp-bridge.js');
  if (existsSync(srcBridge)) return srcBridge;

  // npm global install layout: node_modules/@truealter/sdk/dist/mcp-bridge.js
  const npmGlobalBridge = join(here, 'mcp-bridge.js');
  if (existsSync(npmGlobalBridge)) return npmGlobalBridge;

  return null;
}

export interface UnwireReport {
  state: WireState | null;
  undone: Array<{ client: ClientId; action: 'restored' | 'removed' | 'cli-removed' | 'skipped' | 'failed'; reason?: string }>;
}

export function unwire(): UnwireReport {
  const state = readWireState();
  const undone: UnwireReport['undone'] = [];
  if (!state || state.targets.length === 0) {
    return { state, undone };
  }

  for (const target of state.targets) {
    try {
      if (target.method === 'file') {
        if (target.status === 'written') {
          restoreFromBackup(target.path, target.backupPath);
          undone.push({ client: target.client, action: target.backupPath ? 'restored' : 'removed' });
        } else {
          undone.push({ client: target.client, action: 'skipped', reason: `target status was ${target.status}` });
        }
      } else if (target.method === 'cli') {
        if (target.status === 'written') {
          const run = spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'alter'], {
            encoding: 'utf8',
            shell: process.platform === 'win32',
            timeout: 10_000,
          });
          if (run.error) {
            undone.push({ client: target.client, action: 'failed', reason: run.error.message });
          } else if (run.status === 0) {
            undone.push({ client: target.client, action: 'cli-removed' });
          } else {
            undone.push({ client: target.client, action: 'failed', reason: `claude mcp remove exited ${String(run.status)}` });
          }
        } else {
          undone.push({ client: target.client, action: 'skipped', reason: `target status was ${target.status}` });
        }
      }
    } catch (err) {
      undone.push({ client: target.client, action: 'failed', reason: (err as Error).message });
    }
  }

  // Clear the state so subsequent `unwire` runs are no-ops.
  writeWireState({
    version: 1,
    sdkVersion: state.sdkVersion,
    writtenAt: ISO_NOW(),
    endpoint: state.endpoint,
    targets: [],
  });

  return { state, undone };
}

// Re-export the subset of surface useful to library consumers.
export { readWireState, writeWireState } from './state.js';
export { probeAll, probeClaudeCode, probeByDir, type ProbeResult } from './probe.js';
export { detectSyncedVolume } from './sync.js';
export { sha256 } from './write.js';
export {
  ALL_CLIENTS,
  CLAUDE_CODE,
  CURSOR,
  CLAUDE_DESKTOP,
  VSCODE,
  OPENCLAW,
  type ClientId,
  type ClientPaths,
} from './paths.js';
export type { WireState, WireTarget, WireTargetFile, WireTargetCli } from './state.js';
