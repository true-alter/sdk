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

export type ClientId = 'claude-code' | 'cursor' | 'claude-desktop' | 'vscode' | 'openclaw';

export interface ClientPaths {
  id: ClientId;
  /** Human-readable label. */
  label: string;
  /** The config file the wire step will mutate (or null if the client uses a CLI-only handoff). */
  configPath: string | null;
  /** A sibling directory whose presence counts as "the client is installed on this box". */
  probeDir: string;
  /**
   * The key path, walked top-down, under which our per-server entry is
   * merged. Most clients keep their servers bucket at the config root
   * (`['mcpServers']` or `['servers']`); a client whose schema nests the
   * bucket under an intermediate object (e.g. OpenClaw's `mcp.servers`)
   * declares the full path here instead of a single flat key. The merge
   * in `wire/index.ts` walks this generically: it never special-cases
   * a client id.
   */
  configKeyPath: readonly string[];
  /**
   * Fields to drop from the generated server entry before it is merged
   * into this client's config, for a client whose schema validator
   * rejects keys it does not recognise. Applied generically in
   * `wire/index.ts`; most clients leave this unset.
   */
  omitEntryFields?: readonly string[];
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
// ordering and legacy format migration: we do not touch that file
// directly.
const claudeCodeProbeDir = join(HOME, '.claude');

export const CLAUDE_CODE: ClientPaths = {
  id: 'claude-code',
  label: 'Claude Code',
  configPath: null,
  probeDir: claudeCodeProbeDir,
  configKeyPath: ['mcpServers'],
};

export const CURSOR: ClientPaths = {
  id: 'cursor',
  label: 'Cursor',
  configPath: cursorConfigPath,
  probeDir: cursorDir,
  configKeyPath: ['mcpServers'],
};

export const CLAUDE_DESKTOP: ClientPaths = {
  id: 'claude-desktop',
  label: 'Claude Desktop',
  configPath: claudeDesktopConfigPath(),
  probeDir: claudeDesktopDir(),
  configKeyPath: ['mcpServers'],
};

export const VSCODE: ClientPaths = {
  id: 'vscode',
  label: 'VS Code',
  configPath: vscodeConfigPath(),
  probeDir: vscodeDir(),
  // VS Code's user-scoped mcp.json uses `servers`, not `mcpServers`.
  configKeyPath: ['servers'],
};

// OpenClaw keeps a single config file at ~/.openclaw/openclaw.json on every
// platform: its own docs (docs.openclaw.ai) and a live Windows default-path
// issue (openclaw/openclaw#66523) both confirm it does not platform-branch
// this path the way Claude Desktop/VS Code do. `homedir()` already resolves
// to the right root on Windows (the profile dir), so no APPDATA branch is
// needed here, matching the convention the other path builders use.
const openclawDir = join(HOME, '.openclaw');
const openclawConfigPath = join(openclawDir, 'openclaw.json');

export const OPENCLAW: ClientPaths = {
  id: 'openclaw',
  label: 'OpenClaw',
  configPath: openclawConfigPath,
  probeDir: openclawDir,
  // OpenClaw nests MCP servers two levels deep, mcp.servers.<name>, unlike
  // every other client's flat top-level bucket.
  configKeyPath: ['mcp', 'servers'],
  // OpenClaw's mcp.servers.<name> schema (docs.openclaw.ai/cli/mcp) is a
  // strict allowlist (url, transport, headers, timeouts, auth, tls,
  // toolFilter, ...) with no `description` field; its config loader
  // rejects unrecognised keys outright (confirmed live: an unrelated
  // unknown key elsewhere in a real openclaw.json produced a hard
  // "Unrecognized key" validation error, not a warning). The generic
  // adapter always sets `description`, so it is dropped here.
  omitEntryFields: ['description'],
};

export const ALL_CLIENTS: readonly ClientPaths[] = [
  CLAUDE_CODE,
  CURSOR,
  CLAUDE_DESKTOP,
  VSCODE,
  OPENCLAW,
];

/** Directory holding our own wire-state + identity.json. */
export function alterConfigDir(): string {
  return join(xdgConfig(), 'alter');
}

export function wireStatePath(): string {
  return join(alterConfigDir(), 'wire-state.json');
}
