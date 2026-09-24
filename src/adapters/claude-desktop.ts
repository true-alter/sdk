/**
 * Claude Desktop MCP config helper.
 *
 * Claude Desktop speaks stdio only: it does not currently dial
 * Streamable-HTTP MCP servers directly. The canonical bridge is the
 * `alter` CLI's `mcp-bridge` subcommand. The SDK no longer publishes a
 * standalone bridge binary; the CLI launches the bridge by file path.
 * Desktop hosts spawn `alter mcp-bridge` as a child process and read
 * JSON-RPC over stdin/stdout.
 *
 * Config file path varies by platform and is resolved in
 * `src/wire/paths.ts`. This adapter only produces the config *shape*.
 */

import { MEMBER_BRIDGE_ENDPOINT } from '../client.js';

export interface ClaudeDesktopServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface ClaudeDesktopConfig {
  mcpServers: Record<string, ClaudeDesktopServerConfig>;
}

export interface GenerateClaudeDesktopOptions {
  /** Override the MCP endpoint the bridge dials. Defaults to DEFAULT_ENDPOINT. */
  endpoint?: string;
  /** Optional API key passed via `ALTER_API_KEY` env so it never lands in argv. */
  apiKey?: string;
  /** Identifier used by Claude Desktop for this server. Default: `alter`. */
  serverName?: string;
  /** Override the bridge command (e.g. `npx`). Default: the `alter` CLI. */
  bridgeCommand?: string;
  /** Extra args appended after the default `mcp-bridge` subcommand arg. */
  extraArgs?: string[];
  /**
   * Target platform the config is generated for. Defaults to
   * `process.platform`. Explicit injection keeps the Windows-safe command
   * resolution deterministically testable (see `generateClaudeDesktopConfig`).
   */
  platform?: NodeJS.Platform;
}

export function generateClaudeDesktopConfig(
  opts: GenerateClaudeDesktopOptions = {},
): ClaudeDesktopConfig {
  const serverName = opts.serverName ?? 'alter';
  const plat = opts.platform ?? process.platform;
  const env: Record<string, string> = {};
  // Use the bearer-first member runtime endpoint for the bridge process.
  // The bridge reads ALTER_MCP_ENDPOINT and calls api.truealter.com directly
  // with the member bearer; no CF Access service token is required.
  env.ALTER_MCP_ENDPOINT = opts.endpoint ?? MEMBER_BRIDGE_ENDPOINT;
  if (opts.apiKey) env.ALTER_API_KEY = opts.apiKey;

  // The `mcp-bridge` subcommand is always the first arg now that the bridge
  // is invoked through the `alter` CLI, not a bare bridge binary. Extra args
  // (if any) trail it.
  const bridgeArgs = ['mcp-bridge', ...(opts.extraArgs ?? [])];

  // Resolve the platform-safe command/args pair.
  //
  //   - Explicit override (e.g. `npx`): passed through verbatim; the caller
  //     owns the spawn shape.
  //   - Default, Windows: Claude Desktop spawns the configured `command`
  //     WITHOUT a shell. npm installs the CLI as `alter.cmd` (a batch shim),
  //     and a shell-less Windows spawn cannot resolve a bare `alter` — nor
  //     execute a `.cmd` directly (Node refuses `.cmd`/`.bat` without a shell
  //     since CVE-2024-27980). Route through `cmd /c` so cmd.exe resolves the
  //     shim on PATH via PATHEXT. This mirrors the Windows-safe spawn note in
  //     wire/index.ts.
  //   - Default, POSIX (Linux/macOS): the bare `alter` launcher works, matching
  //     claude-code-bridge.ts `{ command: 'alter', args: ['mcp-bridge'] }`.
  let command: string;
  let args: string[];
  if (opts.bridgeCommand) {
    command = opts.bridgeCommand;
    args = bridgeArgs;
  } else if (plat === 'win32') {
    command = 'cmd';
    args = ['/c', 'alter', ...bridgeArgs];
  } else {
    command = 'alter';
    args = bridgeArgs;
  }

  const entry: ClaudeDesktopServerConfig = {
    command,
    args,
    env,
    description: '~Alter Identity - psychometric identity field for AI agents',
  };

  return { mcpServers: { [serverName]: entry } };
}
