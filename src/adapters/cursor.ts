/**
 * Cursor MCP config helper.
 *
 * Cursor reads MCP servers from `.cursor/mcp.json`. Same shape as
 * Claude Code's `.mcp.json`.
 */

import { generateGenericMcpConfig, type GenerateMcpConfigOptions, type GenericMcpConfig } from './generic-mcp.js';

export function generateCursorConfig(opts: GenerateMcpConfigOptions = {}): GenericMcpConfig {
  return generateGenericMcpConfig({ serverName: 'alter', ...opts });
}
