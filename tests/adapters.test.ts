import { describe, expect, it } from 'vitest';
import { generateClaudeConfig } from '../src/adapters/claude-code.js';
import { generateCursorConfig } from '../src/adapters/cursor.js';
import { generateGenericMcpConfig } from '../src/adapters/generic-mcp.js';

describe('adapters', () => {
  it('claude config defaults to mcp.truealter.com', () => {
    const cfg = generateClaudeConfig();
    expect(cfg.mcpServers.alter.url).toBe('https://mcp.truealter.com/api/v1/mcp');
    expect(cfg.mcpServers.alter.transport).toBe('streamable-http');
  });

  it('attaches X-ALTER-API-Key header when apiKey is set', () => {
    const cfg = generateClaudeConfig({ apiKey: 'ak_test' });
    expect(cfg.mcpServers.alter.headers?.['X-ALTER-API-Key']).toBe('ak_test');
  });

  it('cursor adapter produces equivalent shape', () => {
    const cfg = generateCursorConfig({ apiKey: 'ak_test' });
    expect(cfg.mcpServers.alter.url).toBe('https://mcp.truealter.com/api/v1/mcp');
    expect(cfg.mcpServers.alter.headers?.['X-ALTER-API-Key']).toBe('ak_test');
  });

  it('generic adapter respects custom serverName', () => {
    const cfg = generateGenericMcpConfig({ serverName: 'identity', apiKey: 'ak_test' });
    expect(cfg.mcpServers.identity).toBeDefined();
    expect(cfg.mcpServers.identity.url).toBe('https://mcp.truealter.com/api/v1/mcp');
  });

  it('omits headers when no apiKey or extras are set', () => {
    const cfg = generateGenericMcpConfig();
    expect(cfg.mcpServers.alter.headers).toBeUndefined();
  });
});
