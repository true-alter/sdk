/**
 * Claude Code MCP config helper.
 *
 * Claude Code reads MCP servers from the project-level `.mcp.json` or
 * the user-level Claude Code config. The shape matches `mcpServers`.
 */

import { generateGenericMcpConfig, type GenerateMcpConfigOptions, type GenericMcpConfig } from './generic-mcp.js';

export function generateClaudeConfig(opts: GenerateMcpConfigOptions = {}): GenericMcpConfig {
  return generateGenericMcpConfig({ serverName: 'alter', ...opts });
}
