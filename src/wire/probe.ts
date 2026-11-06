/**
 * Detect which MCP-aware clients are installed on this machine.
 *
 * Probe signals, per client:
 *   - claude-code   : `claude` binary resolvable on PATH (spawn `--version`)
 *   - cursor        : `~/.cursor/` directory exists
 *   - claude-desktop: platform config directory exists
 *   - vscode        : VS Code user data directory exists
 *   - openclaw      : `~/.openclaw/` directory exists
 *   - codex-cli     : `codex` binary resolvable on PATH (spawn `--version`)
 *
 * The probe is deliberately permissive: "the config directory exists"
 * means either the app is installed or was recently installed. Wire
 * will still refuse if the config file ends up on a synced volume.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { ALL_CLIENTS, type ClientId, type ClientPaths } from './paths.js';

export interface ProbeResult {
  client: ClientPaths;
  installed: boolean;
  /** Only present for a CLI-binary client: records `<binary> --version` output when resolvable. */
  version?: string;
  /** Diagnostic trail: why we said installed/not. */
  reason: string;
}

/**
 * Shared shape for every client whose install signal is "its own CLI
 * binary resolves on PATH", so a second CLI-registry client is a one-line
 * call rather than a copy of the whole try/catch. Exported for tests.
 */
export function probeCliBinary(clientId: ClientId, binary: string): ProbeResult {
  const client = ALL_CLIENTS.find((c) => c.id === clientId);
  if (!client) throw new Error(`unknown client id: ${clientId}`);
  // `spawnSync` with a non-existent binary throws on Linux/macOS but
  // returns error.code === 'ENOENT' on Node ≥ 16. Normalise both paths.
  try {
    const result = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 5_000,
    });
    if (result.error) {
      return {
        client,
        installed: false,
        reason: `${binary} binary not on PATH (${result.error.message})`,
      };
    }
    if (result.status === 0) {
      return {
        client,
        installed: true,
        version: result.stdout.trim() || undefined,
        reason: `${binary} --version returned 0`,
      };
    }
    return {
      client,
      installed: false,
      reason: `${binary} --version exited ${String(result.status)}`,
    };
  } catch (err) {
    return {
      client,
      installed: false,
      reason: (err as Error).message,
    };
  }
}

export function probeClaudeCode(): ProbeResult {
  return probeCliBinary('claude-code', 'claude');
}

export function probeCodexCli(): ProbeResult {
  return probeCliBinary('codex-cli', 'codex');
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
    probeByDir('openclaw'),
    probeCodexCli(),
  ];
}
