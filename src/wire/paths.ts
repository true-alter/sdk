/**
 * Platform-specific MCP client config paths.
 *
 * `wire` needs to know, per-client, which file to merge into. The paths
 * here follow each vendor's public documentation. Where a vendor has
 * not settled on a canonical location, we follow the most commonly
 * observed convention and surface the choice via probe diagnostics.
 */

import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

export type NodePlatform = NodeJS.Platform;

export type ClientId = 'claude-code' | 'cursor' | 'claude-desktop' | 'vscode';

export interface ClientPaths {
  id: ClientId;
  /** Human-readable label. */
  label: string;
  /** The config file the wire step will mutate (or null if the client uses a CLI-only handoff). */
  configPath: string | null;
  /** A sibling directory whose presence counts as "the client is installed on this box". */
  probeDir: string;
  /** The `mcpServers`-shaped root key under which our entry is written. Defaults to `mcpServers`. */
  rootKey: string;
}

const HOME = homedir();
const PLAT = platform() as NodePlatform;

function appData(): string {
  return env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
}

function xdgConfig(): string {
  return env.XDG_CONFIG_HOME ?? join(HOME, '.config');
}

function macAppSupport(): string {
  return join(HOME, 'Library', 'Application Support');
}

function claudeDesktopConfigPath(): string {
  if (PLAT === 'darwin') return join(macAppSupport(), 'Claude', 'claude_desktop_config.json');
  if (PLAT === 'win32') return join(appData(), 'Claude', 'claude_desktop_config.json');
  return join(xdgConfig(), 'Claude', 'claude_desktop_config.json');
}

function claudeDesktopDir(): string {
  if (PLAT === 'darwin') return join(macAppSupport(), 'Claude');
  if (PLAT === 'win32') return join(appData(), 'Claude');
  return join(xdgConfig(), 'Claude');
}

function vscodeConfigPath(): string {
  if (PLAT === 'darwin') return join(macAppSupport(), 'Code', 'User', 'mcp.json');
  if (PLAT === 'win32') return join(appData(), 'Code', 'User', 'mcp.json');
  return join(xdgConfig(), 'Code', 'User', 'mcp.json');
}

function vscodeDir(): string {
  if (PLAT === 'darwin') return join(macAppSupport(), 'Code', 'User');
  if (PLAT === 'win32') return join(appData(), 'Code', 'User');
  return join(xdgConfig(), 'Code', 'User');
}

const cursorDir = join(HOME, '.cursor');
const cursorConfigPath = join(cursorDir, 'mcp.json');

// Claude Code stores MCP servers through its own CLI (`claude mcp add`).
// The effective state lives in ~/.claude.json, but the CLI owns write
// ordering and legacy format migration, we do not touch that file
// directly.
const claudeCodeProbeDir = join(HOME, '.claude');

export const CLAUDE_CODE: ClientPaths = {
  id: 'claude-code',
  label: 'Claude Code',
  configPath: null,
  probeDir: claudeCodeProbeDir,
  rootKey: 'mcpServers',
};

export const CURSOR: ClientPaths = {
  id: 'cursor',
  label: 'Cursor',
  configPath: cursorConfigPath,
  probeDir: cursorDir,
  rootKey: 'mcpServers',
};

export const CLAUDE_DESKTOP: ClientPaths = {
  id: 'claude-desktop',
  label: 'Claude Desktop',
  configPath: claudeDesktopConfigPath(),
  probeDir: claudeDesktopDir(),
  rootKey: 'mcpServers',
};

export const VSCODE: ClientPaths = {
  id: 'vscode',
  label: 'VS Code',
  configPath: vscodeConfigPath(),
  probeDir: vscodeDir(),
  // VS Code's user-scoped mcp.json uses `servers`, not `mcpServers`.
  rootKey: 'servers',
};

export const ALL_CLIENTS: readonly ClientPaths[] = [CLAUDE_CODE, CURSOR, CLAUDE_DESKTOP, VSCODE];

/** Directory holding our own wire-state + identity.json. */
export function alterConfigDir(): string {
  return join(xdgConfig(), 'alter');
}

export function wireStatePath(): string {
  return join(alterConfigDir(), 'wire-state.json');
}
