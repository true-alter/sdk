#!/usr/bin/env node
/**
 * alter-mcp-bridge, stdio ↔ Streamable-HTTP MCP bridge powered by @truealter/sdk.
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
 *   2. Every call exercises @truealter/sdk end-to-end, if the bridge
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

import { MCPClient } from '../src/mcp.js';
import { AlterError, AlterPaymentRequired } from '../src/errors.js';
import { SDK_VERSION } from '../src/meta.js';

const ENDPOINT =
  env.ALTER_MCP_ENDPOINT ?? 'https://mcp.truealter.com/api/v1/mcp';
const API_KEY = env.ALTER_API_KEY ?? undefined;

// Extra HTTP headers, useful when the endpoint sits behind an
// additional gate that needs its own credentials. Set
// ALTER_BRIDGE_HEADERS to a JSON object of header name/value pairs and
// each entry is added to every request.
function buildExtraHeaders(): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
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

// Dev-only bridge posture.
// Emit a one-shot advisory to stderr so MCP hosts, demo users, and CI logs
// can see the scope boundary. stdout is the JSON-RPC wire on stdio bridges
// and must NOT be written to here; `console.warn` in Node writes to stderr
// by design, so the JSON-RPC channel stays clean.
console.warn(
  'This bridge is a dev/demo surface. Authenticated MCP tools require per-invocation signing; for production, import `@truealter/sdk` directly. Bridge signing is on the roadmap.',
);

const client = new MCPClient({
  endpoint: ENDPOINT,
  apiKey: API_KEY,
  clientInfo: { name: '@truealter/sdk-mcp-bridge', version: SDK_VERSION },
  extraHeaders: EXTRA_HEADERS,
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
        // Forward anything we don't recognise, the upstream server can
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
