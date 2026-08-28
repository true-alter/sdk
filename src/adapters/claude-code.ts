/**
 * Claude Code MCP config helper.
 *
 * Claude Code reads MCP servers from `.mcp.json` (project) or
 * `~/.claude/mcp.json` (user). The shape matches `mcpServers`.
 */

import { generateGenericMcpConfig, type GenerateMcpConfigOptions, type GenericMcpConfig } from './generic-mcp.js';

export function generateClaudeConfig(opts: GenerateMcpConfigOptions = {}): GenericMcpConfig {
  return generateGenericMcpConfig({ serverName: 'alter', ...opts });
}
