/**
 * Generic MCP client config generator.
 *
 * Produces the JSON shape consumed by every MCP-aware editor: Claude
 * Code, Cursor, Continue, Cline, Windsurf, etc. The exact key under
 * which the entry lives differs between editors, hence the dedicated
 * `claude-code.ts` and `cursor.ts` adapters.
 */

import { DEFAULT_ENDPOINT } from '../client.js';

// Some MCP hosts insist on the bare branded URL in their config UI even
// though the wire endpoint sits at /api/v1/mcp. We export both so the
// adapter can choose the right shape per editor.
const BRANDED_HOST = 'https://mcp.truealter.com';
export { BRANDED_HOST };

export interface McpServerConfig {
  url: string;
  transport: 'streamable-http';
  headers?: Record<string, string>;
  description?: string;
}

export interface GenerateMcpConfigOptions {
  /** Override the MCP endpoint. */
  endpoint?: string;
  /** Optional API key. Sent as `X-ALTER-API-Key`. */
  apiKey?: string;
  /** Identifier the host editor uses for this server. Default: `alter`. */
  serverName?: string;
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
}

export interface GenericMcpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Build a generic `mcpServers` config object that can be merged into any
 * MCP-aware editor's settings file.
 */
export function generateGenericMcpConfig(opts: GenerateMcpConfigOptions = {}): GenericMcpConfig {
  const serverName = opts.serverName ?? 'alter';
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.apiKey) headers['X-ALTER-API-Key'] = opts.apiKey;

  const entry: McpServerConfig = {
    url: opts.endpoint ?? DEFAULT_ENDPOINT,
    transport: 'streamable-http',
    description: 'ALTER Identity, psychometric identity field for AI agents',
  };
  if (Object.keys(headers).length > 0) entry.headers = headers;

  return { mcpServers: { [serverName]: entry } };
}
