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

export type ClientId = 'claude-code' | 'cursor' | 'claude-desktop' | 'vscode' | 'openclaw' | 'codex-cli';

/**
 * Which entry shape a client's config wants, declared per record so the
 * wire step never compares against a client id. Adding a client is a row
 * in {@link ALL_CLIENTS}, never a new branch in `wire/index.ts`.
 *
 *   - `claude-code-cli`  Claude Code owns its own MCP registry and is wired
 *                        through a CLI handoff (`claude mcp add`) rather
 *                        than a config file. Names the HANDOFF, not the
 *                        client: a second CLI-registry client declares its
 *                        own value here rather than reusing this one, since
 *                        the argv shape each CLI accepts differs.
 *   - `codex-cli`        Codex CLI also owns its own MCP registry, wired
 *                        through `codex mcp add <name> --url <url>`, which
 *                        writes the `mcp_servers.<name>` table in
 *                        `~/.codex/config.toml` itself, so no TOML writer is
 *                        needed. Its `add` subcommand cannot set a literal
 *                        header; the only credential it takes is
 *                        `--bearer-token-env-var <NAME>`, which names an env
 *                        var Codex reads at connect time.
 *   - `stdio-bridge`     the client speaks stdio only, so the entry is the
 *                        `alter mcp-bridge` command/args/env shape.
 *   - `remote-http`      the client dials the endpoint itself, so the entry
 *                        carries the URL, transport and headers.
 */
export type EntryAdapterId = 'claude-code-cli' | 'codex-cli' | 'stdio-bridge' | 'remote-http';

/**
 * Declarative rewrite applied to the generated server entry before it is
 * merged into a client's config, for a client whose schema differs from
 * the adapter's canonical field names. All three operations are applied
 * generically in `wire/index.ts` (see `applyEntryFieldMap`), in a fixed
 * order: `omit`, then `rename`, then `add`.
 *
 * Every operation fails loudly rather than silently producing a wrong
 * entry, because the failure this shape exists to prevent is silent: a
 * client that accepts an entry naming the wrong field and quietly selects
 * a different transport gives the member a working-looking install that
 * behaves differently.
 */
export interface EntryFieldMap {
  /**
   * Fields dropped from the entry, for a client whose schema validator
   * rejects keys it does not recognise.
   */
  readonly omit?: readonly string[];
  /**
   * Source-field to target-field renames, for a client that spells a
   * canonical field differently (`url` as `httpUrl`, `serverUrl`, `uri`).
   * Applied after `omit`. Throws when the source field is absent (a silent
   * no-op would leave the original field in place, which is exactly the
   * failure being prevented) or when the target field already exists.
   */
  readonly rename?: Readonly<Record<string, string>>;
  /**
   * Constant fields set on the entry, for a client that requires a
   * discriminator the adapters do not emit (`type: 'remote'`,
   * `type: 'http'`). Applied last. Throws rather than overwriting a field
   * the entry already carries; use `rename` or `omit` for that.
   */
  readonly add?: Readonly<Record<string, string | number | boolean>>;
}

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
   * Which entry shape this client's config wants. Required, and
   * deliberately so: a new record that omitted it would otherwise default
   * to some shape, and a stdio client handed a remote entry (or the
   * reverse) is a silent wrong write. The compiler is the guard.
   */
  entryAdapter: EntryAdapterId;
  /**
   * Declarative rewrite of the generated entry for a client whose schema
   * differs from the adapter's field names: drop, rename, add. Applied
   * generically in `wire/index.ts`; most clients leave this unset.
   */
  entryFieldMap?: EntryFieldMap;
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
  // Wired through `claude mcp add`, not by merging a file; configPath is
  // null and configKeyPath is retained only for the wire-state record.
  entryAdapter: 'claude-code-cli',
};

export const CURSOR: ClientPaths = {
  id: 'cursor',
  label: 'Cursor',
  configPath: cursorConfigPath,
  probeDir: cursorDir,
  configKeyPath: ['mcpServers'],
  entryAdapter: 'remote-http',
};

export const CLAUDE_DESKTOP: ClientPaths = {
  id: 'claude-desktop',
  label: 'Claude Desktop',
  configPath: claudeDesktopConfigPath(),
  probeDir: claudeDesktopDir(),
  configKeyPath: ['mcpServers'],
  // Claude Desktop speaks stdio only: the entry is the `alter mcp-bridge`
  // command/args/env shape, not a URL.
  entryAdapter: 'stdio-bridge',
};

export const VSCODE: ClientPaths = {
  id: 'vscode',
  label: 'VS Code',
  configPath: vscodeConfigPath(),
  probeDir: vscodeDir(),
  // VS Code's user-scoped mcp.json uses `servers`, not `mcpServers`.
  configKeyPath: ['servers'],
  entryAdapter: 'remote-http',
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
  entryAdapter: 'remote-http',
  // OpenClaw's mcp.servers.<name> schema (docs.openclaw.ai/cli/mcp) is a
  // strict allowlist (url, transport, headers, timeouts, auth, tls,
  // toolFilter, ...) with no `description` field; its config loader
  // rejects unrecognised keys outright (confirmed live: an unrelated
  // unknown key elsewhere in a real openclaw.json produced a hard
  // "Unrecognized key" validation error, not a warning). The generic
  // adapter always sets `description`, so it is dropped here.
  entryFieldMap: { omit: ['description'] },
};

// Codex CLI stores MCP servers through its own CLI (`codex mcp add`), the
// same shape as Claude Code: the effective state lives in
// ~/.codex/config.toml (TOML, mcp_servers.<name> table), but we never write
// that file directly.
const codexCliProbeDir = join(HOME, '.codex');

export const CODEX_CLI: ClientPaths = {
  id: 'codex-cli',
  label: 'Codex CLI',
  configPath: null,
  probeDir: codexCliProbeDir,
  // Not a real merge target (see entryAdapter below); retained only for
  // the wire-state record, matching the TOML table Codex actually uses.
  configKeyPath: ['mcp_servers'],
  // Wired through `codex mcp add`, not by merging a file; configPath is
  // null for the same reason Claude Code's is.
  entryAdapter: 'codex-cli',
};

export const ALL_CLIENTS: readonly ClientPaths[] = [
  CLAUDE_CODE,
  CURSOR,
  CLAUDE_DESKTOP,
  VSCODE,
  OPENCLAW,
  CODEX_CLI,
];

/** Directory holding our own wire-state + identity.json. */
export function alterConfigDir(): string {
  return join(xdgConfig(), 'alter');
}

export function wireStatePath(): string {
  return join(alterConfigDir(), 'wire-state.json');
}
