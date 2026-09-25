#!/usr/bin/env node
/**
 * alter-mcp-bridge — stdio ↔ Streamable-HTTP MCP bridge powered by @truealter/sdk.
 *
 * Claude Code, Cursor, and most desktop MCP hosts speak the stdio
 * transport. The live ALTER MCP server speaks Streamable HTTP. This
 * bridge connects them: read JSON-RPC frames from stdin, forward them
 * through the SDK's MCPClient, and write the results back to stdout.
 *
 * Why use the SDK as the transport (instead of forwarding raw HTTP)?
 *
 *   1. We get session id capture, retry, 402 detection, and provenance
 *      verification for free.
 *   2. Every call exercises @truealter/sdk end-to-end — if the bridge
 *      works, the SDK works.
 *   3. We can attach an X402 signer here later and the bridge will
 *      transparently settle premium tool calls.
 *
 * Frame format: line-delimited JSON-RPC (one object per line over
 * stdin/stdout). MCP does not require a specific stdio framing in the
 * spec, but every host I have seen uses LDJSON, including Claude Code.
 */

import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, exit, env } from 'node:process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';

import { MCPClient } from '../src/mcp.js';
import { AlterError, AlterPaymentRequired } from '../src/errors.js';

const ENDPOINT =
  env.ALTER_MCP_ENDPOINT ?? 'https://api.truealter.com/api/v1/mcp';
const API_KEY = env.ALTER_API_KEY ?? undefined;

// Extra HTTP headers. The default endpoint (api.truealter.com) is bearer-first
// and requires no Cloudflare Access service token: member authentication is
// the bearer JWT / member_api_key only. Members are never asked to obtain or
// apply a CF Access token; the bearer credential from `alter login` is the
// whole member auth story.
//
// The CF_ACCESS_CLIENT_ID/SECRET env reads below are functional infra plumbing,
// not a member-facing instruction: they are a legacy opt-in for an OPERATOR who
// has overridden ALTER_MCP_ENDPOINT to a self-hosted CF-gated endpoint, and the
// literal env-var names are the operator-facing contract that must match what
// such an operator sets in their own environment. The behaviour is pinned by
// tests/mcp.test.ts ("forwards extraHeaders on every request"); removing this
// read would break that guard and the custom-endpoint transport path.
// ALTER_BRIDGE_HEADERS is a general escape hatch for arbitrary headers.
// (1) ALTER_BRIDGE_HEADERS wins over (2) CF vars on collision.
function buildExtraHeaders(): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }
  if (env.ALTER_BRIDGE_HEADERS) {
    try {
      const parsed = JSON.parse(env.ALTER_BRIDGE_HEADERS) as Record<string, string>;
      Object.assign(headers, parsed);
    } catch (err) {
      stderr.write(
        `[alter-bridge] warning: ALTER_BRIDGE_HEADERS is not valid JSON; ignored (${(err as Error).message})\n`,
      );
    }
  }
  return Object.keys(headers).length ? headers : undefined;
}

const EXTRA_HEADERS = buildExtraHeaders();

// --- ES256 per-invocation signing -------------------------------------------
// The server requires every authenticated `tools/call` to carry an
// `Mcp-Invocation-Signature` header. MCPClient accepts signing options
// at construction; we resolve them here from the env-key path (Priority 1)
// so the CLI launcher's ALTER_SIGNING_KEY injection works in this bridge too.
//
// Priority matches src/mcp-bridge.ts loadSigningKey exactly:
//   1. ALTER_SIGNING_KEY (inline PEM) + ALTER_SIGNING_KID / session.signing_kid
//   2. ALTER_SIGNING_KEY_FILE
//   3. Per-kid PEM file: ~/.config/alter/signing-keys/<kid>.pem
//   4. Legacy default:   ~/.config/alter/signing-key.pem

const xdgConfig = env.XDG_CONFIG_HOME ?? nodePath.join(os.homedir(), '.config');

interface SessionJson {
  jwt?: string;
  member_api_key?: string;
  signing_kid?: string;
  handle?: string;
}

function readSession(): SessionJson {
  const sessionFile = env.ALTER_SESSION_FILE ?? nodePath.join(xdgConfig, 'alter', 'session.json');
  try {
    const raw = fs.readFileSync(sessionFile, 'utf8');
    const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(clean) as SessionJson;
  } catch {
    return {};
  }
}

interface ResolvedSigning {
  kid: string;
  privateKey: string; // PEM
  handle: string;
}

// Resolve signing options to pass to MCPClient at construction.
// Returns null when no key is resolvable.
// EXPORTED so tests can import and assert on the real runtime env-priority
// logic; a change here will break bridge-env-signing.test.ts (intentional).
export function resolveSigningOptions(session: SessionJson): ResolvedSigning | null {
  // Priority 1: inline env PEM (CLI launcher injects this).
  const envPem = env.ALTER_SIGNING_KEY;
  if (envPem) {
    const envKid = env.ALTER_SIGNING_KID ?? session.signing_kid;
    if (envKid) {
      // Validate the PEM is parseable before wiring it.
      try {
        crypto.createPrivateKey(envPem);
        return { kid: envKid, privateKey: envPem, handle: session.handle ?? '' };
      } catch (e) {
        stderr.write(`bridge: ALTER_SIGNING_KEY parse error: ${(e as Error).message}\n`);
        // Fall through to file-based sources.
      }
    }
    // ALTER_SIGNING_KEY set but no kid resolvable; fall through.
  }

  // Priority 2-4: file-based fallbacks.
  const kid = session.signing_kid;
  if (!kid) return null;
  const candidates: string[] = [];
  if (env.ALTER_SIGNING_KEY_FILE) candidates.push(env.ALTER_SIGNING_KEY_FILE);
  candidates.push(nodePath.join(xdgConfig, 'alter', 'signing-keys', `${kid}.pem`));
  candidates.push(nodePath.join(xdgConfig, 'alter', 'signing-key.pem'));
  for (const p of candidates) {
    try {
      const pem = fs.readFileSync(p, 'utf8');
      crypto.createPrivateKey(pem); // validate before returning
      return { kid, privateKey: pem, handle: session.handle ?? '' };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

const _session = readSession();
const _signingOpts = resolveSigningOptions(_session);
if (API_KEY && !_signingOpts) {
  stderr.write(
    `bridge: no signing key for kid ${_session.signing_kid ?? '(unset)'}: run 'alter login' to provision one\n`,
  );
}

const client = new MCPClient({
  endpoint: ENDPOINT,
  apiKey: API_KEY,
  clientInfo: { name: '@truealter/sdk-mcp-bridge', version: '0.2.0' },
  extraHeaders: EXTRA_HEADERS,
  ..._signingOpts
    ? {
        signing: {
          kid: _signingOpts.kid,
          privateKey: _signingOpts.privateKey,
          handle: _signingOpts.handle,
        },
      }
    : {},
});

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function send(response: JsonRpcResponse): void {
  stdout.write(JSON.stringify(response) + '\n');
}

function logDebug(...args: unknown[]): void {
  if (env.ALTER_BRIDGE_DEBUG) {
    stderr.write(`[alter-bridge] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  }
}

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  try {
    let result: unknown;
    switch (req.method) {
      case 'initialize':
        // The SDK does its own initialize; we re-handshake here so the
        // host's protocolVersion / clientInfo flow upstream untouched.
        result = await client.rpc('initialize', (req.params as Record<string, unknown>) ?? {});
        break;
      case 'initialized':
      case 'notifications/initialized':
        // Notifications have no response.
        return { jsonrpc: '2.0', id, result: null };
      case 'tools/list':
        result = await client.rpc('tools/list', (req.params as Record<string, unknown>) ?? {});
        break;
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!params.name) throw new AlterError('TOOL_ERROR', 'tools/call missing "name"');
        result = await client.callTool(params.name, params.arguments ?? {});
        break;
      }
      case 'resources/list':
      case 'resources/read':
      case 'prompts/list':
      case 'prompts/get':
      case 'ping':
        result = await client.rpc(req.method, (req.params as Record<string, unknown>) ?? {});
        break;
      default:
        // Forward anything we don't recognise — the upstream server can
        // accept or reject it. This keeps the bridge protocol-version
        // independent.
        result = await client.rpc(req.method, (req.params as Record<string, unknown>) ?? {});
    }
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    if (err instanceof AlterPaymentRequired) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: 402,
          message: `x402 payment required for ${err.tool}`,
          data: { envelope: err.envelope },
        },
      };
    }
    if (err instanceof AlterError) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message, data: { code: err.code } },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: (err as Error).message ?? 'internal error' },
    };
  }
}

async function main(): Promise<void> {
  logDebug('starting; endpoint=', ENDPOINT, 'apiKey=', API_KEY ? '(set)' : '(none)');

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      logDebug('skipping non-JSON line:', trimmed.slice(0, 80));
      continue;
    }
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      logDebug('skipping malformed request:', trimmed.slice(0, 80));
      continue;
    }
    const response = await handle(req);
    // MCP notifications (id absent) get no response.
    if (req.id !== undefined && req.id !== null) {
      send(response);
    }
  }

  logDebug('stdin closed; exiting');
  await client.closeSession().catch(() => {
    /* ignore */
  });
}

main().catch((err: unknown) => {
  stderr.write(`[alter-bridge] fatal: ${(err as Error).message}\n`);
  exit(1);
});
