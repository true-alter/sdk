/**
 * Detect which MCP-aware clients are installed on this machine.
 *
 * Probe signals, per client:
 *   - claude-code   : `claude` binary resolvable on PATH (spawn `--version`)
 *   - cursor        : `~/.cursor/` directory exists
 *   - claude-desktop: platform config directory exists
 *   - vscode        : VS Code user data directory exists
 *
 * The probe is deliberately permissive — "the config directory exists"
 * means either the app is installed or was recently installed. Wire
 * will still refuse if the config file ends up on a synced volume.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { ALL_CLIENTS, type ClientId, type ClientPaths } from './paths.js';

export interface ProbeResult {
  client: ClientPaths;
  installed: boolean;
  /** Only present for claude-code — records `claude --version` output when resolvable. */
  version?: string;
  /** Diagnostic trail — why we said installed/not. */
  reason: string;
}

export function probeClaudeCode(): ProbeResult {
  // `spawnSync` with a non-existent binary throws on Linux/macOS but
  // returns error.code === 'ENOENT' on Node ≥ 16. Normalise both paths.
  try {
    const result = spawnSync('claude', ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 5_000,
    });
    if (result.error) {
      return {
        client: ALL_CLIENTS.find((c) => c.id === 'claude-code')!,
        installed: false,
        reason: `claude binary not on PATH (${result.error.message})`,
      };
    }
    if (result.status === 0) {
      return {
        client: ALL_CLIENTS.find((c) => c.id === 'claude-code')!,
        installed: true,
        version: result.stdout.trim() || undefined,
        reason: 'claude --version returned 0',
      };
    }
    return {
      client: ALL_CLIENTS.find((c) => c.id === 'claude-code')!,
      installed: false,
      reason: `claude --version exited ${String(result.status)}`,
    };
  } catch (err) {
    return {
      client: ALL_CLIENTS.find((c) => c.id === 'claude-code')!,
      installed: false,
      reason: (err as Error).message,
    };
  }
}

export function probeByDir(id: ClientId): ProbeResult {
  const client = ALL_CLIENTS.find((c) => c.id === id);
  if (!client) throw new Error(`unknown client id: ${id}`);
  const installed = existsSync(client.probeDir);
  return {
    client,
    installed,
    reason: installed ? `found ${client.probeDir}` : `no directory at ${client.probeDir}`,
  };
}

export function probeAll(): ProbeResult[] {
  return [
    probeClaudeCode(),
    probeByDir('cursor'),
    probeByDir('claude-desktop'),
    probeByDir('vscode'),
  ];
}
