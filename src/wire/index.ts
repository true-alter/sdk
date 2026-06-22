/**
 * Public `wire` / `unwire` entry points.
 *
 * `wire()` probes for installed MCP clients, merges the ALTER entry
 * into each client's config (via atomic JSON merge or CLI handoff),
 * writes a `wire-state.json` provenance artefact, and returns a
 * structured report. `unwire()` reads that artefact and reverses
 * every target.
 *
 * Synchronous throughout, the CLI path is sequential and the
 * deterministic ordering is worth the tiny blocking cost.
 */

import { spawnSync } from 'node:child_process';

import { DEFAULT_ENDPOINT } from '../client.js';
import { SDK_VERSION } from '../meta.js';
import { generateClaudeDesktopConfig } from '../adapters/claude-desktop.js';
import { generateGenericMcpConfig } from '../adapters/generic-mcp.js';
import { ALL_CLIENTS, type ClientId, type ClientPaths } from './paths.js';
import { probeAll, probeClaudeCode, probeByDir, type ProbeResult } from './probe.js';
import { detectSyncedVolume } from './sync.js';
import { readWireState, writeWireState, type WireState, type WireTarget } from './state.js';
import { atomicJsonMerge, restoreFromBackup } from './write.js';

export interface WireOptions {
  /** Override the endpoint written into every client config. Defaults to DEFAULT_ENDPOINT. */
  endpoint?: string;
  /** Optional API key written into `headers['X-ALTER-API-Key']` for each target. */
  apiKey?: string;
  /** Restrict to a subset of client ids. Default: every detected client. */
  only?: readonly ClientId[];
  /** Skip any client whose probe said "not installed" even if the caller passed it via `only`. */
  skipMissing?: boolean;
}

export interface WireReport {
  state: WireState;
  probes: ProbeResult[];
}

const TIMESTAMP = (): string => String(Math.floor(Date.now() / 1000));
const ISO_NOW = (): string => new Date().toISOString();

function clientById(id: ClientId): ClientPaths {
  const hit = ALL_CLIENTS.find((c) => c.id === id);
  if (!hit) throw new Error(`unknown client id: ${id}`);
  return hit;
}

export function wire(opts: WireOptions = {}): WireReport {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const apiKey = opts.apiKey;
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
          : { path: clientById(id).configPath ?? '', backupPath: null, rootKey: clientById(id).rootKey, serverName: 'alter', preSha256: null, postSha256: '' }),
        reason: probe.reason,
      } as WireTarget);
      continue;
    }

    try {
      if (id === 'claude-code') {
        targets.push(wireClaudeCode({ endpoint, apiKey }));
      } else {
        targets.push(wireFileTarget({ id, endpoint, apiKey, timestamp: ts }));
      }
    } catch (err) {
      const message = (err as Error).message;
      targets.push({
        client: id,
        method: id === 'claude-code' ? 'cli' : 'file',
        status: 'failed',
        ...(id === 'claude-code'
          ? { command: '' }
          : { path: clientById(id).configPath ?? '', backupPath: null, rootKey: clientById(id).rootKey, serverName: 'alter', preSha256: null, postSha256: '' }),
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

function wireFileTarget(args: {
  id: ClientId;
  endpoint: string;
  apiKey: string | undefined;
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
        'Synced volumes propagate credentials across devices, move the config off the sync root, or run wire on the device you want to target.',
    );
  }

  // Build the merged entry using the relevant adapter so the shape
  // stays consistent with `alter-identity config` output.
  const entry =
    args.id === 'claude-desktop'
      ? generateClaudeDesktopConfig({ endpoint: args.endpoint, apiKey: args.apiKey })
      : generateGenericMcpConfig({ endpoint: args.endpoint, apiKey: args.apiKey });

  const rootKey = client.rootKey;
  const serverName = 'alter';

  const result = atomicJsonMerge({
    path: client.configPath,
    timestamp: args.timestamp,
    merge: (existing) => {
      const bucket = (existing[rootKey] as Record<string, unknown> | undefined) ?? {};
      // `entry.mcpServers.alter` is the canonical source shape; for
      // VS Code we hoist it under `servers` instead.
      const source = entry.mcpServers.alter as unknown as Record<string, unknown>;
      return {
        ...existing,
        [rootKey]: {
          ...bucket,
          [serverName]: source,
        },
      };
    },
  });

  return {
    client: args.id,
    method: 'file',
    status: result.noop ? 'already-wired' : 'written',
    path: result.path,
    backupPath: result.backupPath,
    rootKey,
    serverName,
    preSha256: result.preSha256,
    postSha256: result.postSha256,
  };
}

function wireClaudeCode(args: { endpoint: string; apiKey: string | undefined }): WireTarget {
  const cmd = 'claude';
  const argList = [
    'mcp',
    'add',
    '--scope',
    'user',
    '--transport',
    'http',
    'alter',
    args.endpoint,
  ];
  if (args.apiKey) {
    argList.push('--header', `X-ALTER-API-Key:${args.apiKey}`);
  }
  const full = `${cmd} ${argList.join(' ')}`;

  const run = spawnSync(cmd, argList, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 10_000,
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

  // `claude mcp add` exits non-zero when the entry already exists.
  // Detect the common stderr fragment so we report `already-wired`
  // rather than `failed` for the no-op case.
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
export { ALL_CLIENTS, CLAUDE_CODE, CURSOR, CLAUDE_DESKTOP, VSCODE, type ClientId, type ClientPaths } from './paths.js';
export type { WireState, WireTarget, WireTargetFile, WireTargetCli } from './state.js';
