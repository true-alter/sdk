/**
 * Claude Code MCP bridge adapter.
 *
 * Claude Code's HTTP MCP transport requires StreamableHTTP (GET+SSE),
 * which the ~Alter Cloudflare Worker endpoint does not support (POST
 * only). Every other MCP client that needs stdio already has a bridge
 * (see claude-desktop.ts). This adapter generates the stdio config
 * shape for Claude Code using the same `alter mcp-bridge` command.
 *
 * The bridge reads session.json for auth + cf-access.env for the
 * Cloudflare Access gate, so credentials never land in the Claude Code
 * config file: they stay in the user-private ~Alter config directory.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

/**
 * Resolve the path to the bridge entry point.
 *
 * Priority:
 *   1. CLI launcher: `alter mcp-bridge` (or `alter.cmd mcp-bridge` on
 *      Windows). Preferred because the launcher can inject the keychain
 *      signing key via ALTER_SIGNING_KEY + ALTER_SIGNING_KID into the
 *      child process environment. Requires the ~Alter CLI to be installed.
 *   2. Direct dist bridge: `node dist/mcp-bridge.js`. Used only when the
 *      `alter` binary cannot be resolved on PATH. This path cannot inject
 *      keychain keys, so invocation signing is degraded.
 *
 * Cross-platform `alter` binary resolution:
 *   - Windows: tries `alter.cmd` first (npm .cmd shim), then `alter.exe`.
 *   - POSIX (Linux, macOS): uses `alter`.
 *   Resolution is PATH-based; the binary must be on the user's PATH (which
 *   npm global installs ensures).
 *
 * Falls back to null only if the dist bridge file is also absent.
 */
export function resolveBridgePath(): { command: string; args: string[] } | null {
  // Priority 1: CLI launcher (preferred, keychain-capable).
  // Resolve the alter binary cross-platform.
  let alterBin: string;
  if (platform() === 'win32') {
    // npm on Windows installs a .cmd shim alongside the .js entry point.
    // Prefer .cmd so the shell can locate it on PATH without a .exe search.
    // existsSync cannot resolve PATH-relative names, so we rely on the
    // convention: if the ~Alter CLI is installed globally on Windows, alter.cmd
    // is present on PATH. We do a cheap which-style check via the env PATH.
    const pathDirs = (process.env.PATH ?? '').split(';');
    const cmdFound = pathDirs.some((dir) => {
      try { return existsSync(join(dir, 'alter.cmd')); } catch { return false; }
    });
    alterBin = cmdFound ? 'alter.cmd' : 'alter.exe';
  } else {
    alterBin = 'alter';
  }

  // Verify the binary is resolvable by attempting a synchronous which-equivalent:
  // search each PATH directory for the binary. This avoids spawning a child
  // process at config-generation time.
  const pathSep = platform() === 'win32' ? ';' : ':';
  const pathDirs = (process.env.PATH ?? '').split(pathSep);
  const alterResolvable = pathDirs.some((dir) => {
    try { return existsSync(join(dir, alterBin)); } catch { return false; }
  });

  if (alterResolvable) {
    // Return the ABSOLUTE path to the binary so CC's stripped-env spawn
    // (env:{}, no PATH) can exec it without a PATH search.
    const alterAbsPath = pathDirs
      .map((dir) => join(dir, alterBin))
      .find((p) => { try { return existsSync(p); } catch { return false; } })!;
    return { command: alterAbsPath, args: ['mcp-bridge'] };
  }

  // Priority 2: direct dist bridge (degraded, no keychain injection).
  const distBridge = join(__dirname, 'mcp-bridge.js');
  if (existsSync(distBridge)) {
    return { command: 'node', args: [distBridge] };
  }

  return null;
}

export interface ClaudeCodeBridgeConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function generateClaudeCodeBridgeArgs(opts: {
  endpoint?: string;
  apiKey?: string;
}): ClaudeCodeBridgeConfig {
  const resolved = resolveBridgePath();
  if (!resolved) {
    throw new Error(
      'Cannot find ALTER MCP bridge. Install @truealter/sdk or @truealter/cli.',
    );
  }

  const env: Record<string, string> = {};
  if (opts.endpoint) env.ALTER_PUBLIC_MCP_ENDPOINT = opts.endpoint;
  if (opts.apiKey) env.ALTER_API_KEY = opts.apiKey;

  return {
    command: resolved.command,
    args: resolved.args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
