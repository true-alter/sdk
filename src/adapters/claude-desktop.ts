/**
 * Claude Desktop MCP config helper.
 *
 * Claude Desktop speaks stdio only — it does not currently dial
 * Streamable-HTTP MCP servers directly. The canonical bridge is our
 * own `alter-mcp-bridge` binary, which is published alongside this CLI
 * in the same npm package. Desktop hosts then spawn the bridge as a
 * child process and read JSON-RPC over stdin/stdout.
 *
 * Config file path varies by platform and is resolved in
 * `src/wire/paths.ts`. This adapter only produces the config *shape*.
 */

import { DEFAULT_ENDPOINT } from '../client.js';

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
  /** Override the bridge command (e.g. `npx alter-mcp-bridge`). Default: bare `alter-mcp-bridge`. */
  bridgeCommand?: string;
  /** Extra args appended after the default bridge args. */
  extraArgs?: string[];
}

export function generateClaudeDesktopConfig(
  opts: GenerateClaudeDesktopOptions = {},
): ClaudeDesktopConfig {
  const serverName = opts.serverName ?? 'alter';
  const bridgeCommand = opts.bridgeCommand ?? 'alter-mcp-bridge';
  const env: Record<string, string> = {};
  env.ALTER_MCP_ENDPOINT = opts.endpoint ?? DEFAULT_ENDPOINT;
  if (opts.apiKey) env.ALTER_API_KEY = opts.apiKey;

  const entry: ClaudeDesktopServerConfig = {
    command: bridgeCommand,
    env,
    description: 'ALTER Identity — psychometric identity field for AI agents',
  };
  if (opts.extraArgs && opts.extraArgs.length > 0) {
    entry.args = [...opts.extraArgs];
  }

  return { mcpServers: { [serverName]: entry } };
}
