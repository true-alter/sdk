import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateClaudeDesktopConfig } from '../src/adapters/claude-desktop.js';
import { detectSyncedVolume } from '../src/wire/sync.js';
import { atomicJsonMerge, restoreFromBackup, sha256 } from '../src/wire/write.js';

describe('wire / sync.ts, synced-volume refusal', () => {
  it('refuses iCloud paths', () => {
    const hit = detectSyncedVolume('/Users/user/Library/Mobile Documents/com~apple~CloudDocs/.cursor/mcp.json');
    expect(hit).not.toBeNull();
    expect(hit?.matchedPrefix).toBe('Library/Mobile Documents/com~apple~CloudDocs');
  });

  it('refuses OneDrive paths', () => {
    const hit = detectSyncedVolume('/home/user/OneDrive/Apps/Claude/claude_desktop_config.json');
    expect(hit).not.toBeNull();
    expect(hit?.matchedPrefix).toBe('OneDrive');
  });

  it('refuses Dropbox paths', () => {
    const hit = detectSyncedVolume('/Users/user/Dropbox/.cursor/mcp.json');
    expect(hit).not.toBeNull();
    expect(hit?.matchedPrefix).toBe('Dropbox');
  });

  it('refuses Google Drive paths', () => {
    const hit = detectSyncedVolume('/Users/user/Library/CloudStorage/GoogleDrive-user/Cursor/mcp.json');
    expect(hit).not.toBeNull();
  });

  it('allows normal home paths', () => {
    const hit = detectSyncedVolume('/home/user/.cursor/mcp.json');
    expect(hit).toBeNull();
  });
});

describe('wire / write.ts, atomic JSON merge', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'alter-wire-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a new file when target does not exist', () => {
    const path = join(tmp, 'mcp.json');
    const result = atomicJsonMerge({
      path,
      timestamp: '1',
      merge: () => ({ mcpServers: { alter: { url: 'https://mcp.truealter.com/api/v1/mcp' } } }),
    });
    expect(result.backupPath).toBeNull();
    expect(result.noop).toBe(false);
    expect(result.preSha256).toBeNull();
    expect(existsSync(path)).toBe(true);
    const written = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(written.mcpServers.alter).toBeDefined();
  });

  it('merges into existing file and writes backup sibling', () => {
    const path = join(tmp, 'mcp.json');
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'foo' } } }, null, 2) + '\n');
    const result = atomicJsonMerge({
      path,
      timestamp: '42',
      merge: (existing) => {
        const bucket = (existing.mcpServers as Record<string, unknown>) ?? {};
        return { ...existing, mcpServers: { ...bucket, alter: { url: 'x' } } };
      },
    });
    expect(result.backupPath).toBe(`${path}.alter-backup-42`);
    expect(existsSync(result.backupPath!)).toBe(true);
    const merged = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(merged.mcpServers).sort()).toEqual(['alter', 'other']);
  });

  it('is idempotent, no-op when merge produces identical bytes', () => {
    const path = join(tmp, 'mcp.json');
    const initial = JSON.stringify({ mcpServers: { alter: { url: 'x' } } }, null, 2) + '\n';
    writeFileSync(path, initial);
    const result = atomicJsonMerge({
      path,
      timestamp: 'x',
      merge: () => ({ mcpServers: { alter: { url: 'x' } } }),
    });
    expect(result.noop).toBe(true);
    expect(result.backupPath).toBeNull();
    // Backup sibling must NOT have been created for the no-op path.
    expect(existsSync(`${path}.alter-backup-x`)).toBe(false);
  });

  it('rejects malformed JSON rather than silently overwriting', () => {
    const path = join(tmp, 'mcp.json');
    writeFileSync(path, '{this is not json');
    expect(() =>
      atomicJsonMerge({
        path,
        timestamp: 'x',
        merge: () => ({}),
      }),
    ).toThrow(/not valid JSON/);
  });

  it('rejects non-object JSON root', () => {
    const path = join(tmp, 'mcp.json');
    writeFileSync(path, JSON.stringify(['a', 'b']) + '\n');
    expect(() =>
      atomicJsonMerge({
        path,
        timestamp: 'x',
        merge: (e) => e,
      }),
    ).toThrow(/not an object/);
  });

  it('restoreFromBackup rewinds a merged file to its pre-state', () => {
    const path = join(tmp, 'mcp.json');
    const original = JSON.stringify({ mcpServers: { other: { command: 'foo' } } }, null, 2) + '\n';
    writeFileSync(path, original);
    const result = atomicJsonMerge({
      path,
      timestamp: '7',
      merge: (e) => ({ ...e, mcpServers: { ...(e.mcpServers as Record<string, unknown>), alter: { url: 'x' } } }),
    });
    expect(result.backupPath).not.toBeNull();

    restoreFromBackup(path, result.backupPath);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('restoreFromBackup with null backup unlinks the file', () => {
    const path = join(tmp, 'mcp.json');
    writeFileSync(path, '{"created": true}');
    restoreFromBackup(path, null);
    expect(existsSync(path)).toBe(false);
  });

  it('sha256 matches known vector', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('adapters / claude-desktop', () => {
  it('produces stdio shape pointing at alter-mcp-bridge', () => {
    const cfg = generateClaudeDesktopConfig();
    expect(cfg.mcpServers.alter.command).toBe('alter-mcp-bridge');
    expect(cfg.mcpServers.alter.env?.ALTER_MCP_ENDPOINT).toBe('https://mcp.truealter.com/api/v1/mcp');
    expect(cfg.mcpServers.alter.env?.ALTER_API_KEY).toBeUndefined();
  });

  it('threads apiKey through env, not argv', () => {
    const cfg = generateClaudeDesktopConfig({ apiKey: 'ak_test' });
    expect(cfg.mcpServers.alter.env?.ALTER_API_KEY).toBe('ak_test');
    // Must NEVER land in argv, ps listings leak argv but not env.
    expect(cfg.mcpServers.alter.args).toBeUndefined();
  });

  it('honours custom serverName', () => {
    const cfg = generateClaudeDesktopConfig({ serverName: 'identity' });
    expect(cfg.mcpServers.identity).toBeDefined();
    expect(cfg.mcpServers.alter).toBeUndefined();
  });

  it('honours custom bridgeCommand', () => {
    const cfg = generateClaudeDesktopConfig({ bridgeCommand: 'npx alter-mcp-bridge' });
    expect(cfg.mcpServers.alter.command).toBe('npx alter-mcp-bridge');
  });
});
