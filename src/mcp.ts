/**
 * Low-level MCP JSON-RPC 2.0 client over Streamable HTTP.
 *
 * The MCP spec (revision 2025-11-25) defines a request/response protocol
 * over HTTP POST with optional `Mcp-Session-Id` correlation. This module
 * is the thin transport, see {@link AlterClient} for the typed wrapper
 * around ALTER's tool surface.
 *
 * Pure native `fetch()`, no axios, no node-fetch, no ws.
 */

import {
  AlterAuthError,
  AlterError,
  AlterInvalidResponse,
  AlterNetworkError,
  AlterPaymentRequired,
  AlterRateLimited,
  AlterTimeoutError,
  AlterToolError,
  type PaymentEnvelope,
} from './errors.js';
import { parsePaymentHeader, X402Client } from './x402.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';

export interface MCPClientInfo {
  name: string;
  version: string;
}

export interface MCPClientOptions {
  /** Streamable HTTP endpoint. Default: https://mcp.truealter.com */
  endpoint?: string;
  /** Optional API key for the `X-ALTER-API-Key` header. */
  apiKey?: string;
  /** Override fetch (testing). */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
  /** Number of retry attempts on transient (429/502/503/504) failures. Default 2. */
  maxRetries?: number;
  /** Client info advertised in `initialize`. */
  clientInfo?: MCPClientInfo;
  /** Optional x402 client for automatic premium tool payment. */
  x402?: X402Client;
  /**
   * Q5c per-invocation signing. When present, every `tools/call` is
   * ES256-signed and submitted with the `Mcp-Invocation-Signature`
   * header. The public half of `privateKey` MUST have been
   * registered via `POST /api/v1/agents/keys` against the same API
   * key configured here. Required whenever `apiKey` is set and the
   * server is in production / staging (hard-required from
   * 2026-04-20).
   */
  signing?: MCPSigningOptions;
  /**
   * Extra HTTP headers added to every request. Useful when the endpoint
   * sits behind an additional gate that requires its own credentials.
   * Protocol-level headers (`Content-Type`, `Accept`) and ALTER-internal
   * headers (`X-ALTER-API-Key`, `Mcp-Session-Id`,
   * `Mcp-Invocation-Signature`) always win over collisions here.
   */
  extraHeaders?: Record<string, string>;
}

export interface MCPSigningOptions {
  /** The signing-key id pre-registered with the server. */
  kid: string;
  /** ES256 P-256 private key: 32-byte scalar or PEM. */
  privateKey: Uint8Array | string;
  /** The caller's bound ~handle. */
  handle: string;
}

export interface MCPCallOptions {
  /** Override the configured x402 client for this single call. */
  x402?: X402Client;
  /** Skip retries on 402 (useful for "is this premium?" probes). */
  noPaymentRetry?: boolean;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: Record<string, unknown>;
}

export interface MCPListToolsResult {
  tools: MCPToolDefinition[];
  _meta?: {
    signatures?: Record<string, { schema_hash: string; signature?: string | null; kid?: string | null }>;
    [extra: string]: unknown;
  };
}

export interface MCPContentBlock {
  type: 'text' | 'json' | string;
  text?: string;
  data?: unknown;
}

export interface MCPCallToolResult<T = unknown> {
  content: MCPContentBlock[];
  isError?: boolean;
  /** Parsed structured payload, set when content[0].type === 'json' or text parses as JSON. */
  data?: T;
  _meta?: {
    provenance?: import('./provenance.js').ProvenanceEnvelope;
    [extra: string]: unknown;
  };
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export class MCPClient {
  public readonly endpoint: string;
  public sessionId: string | null = null;

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly clientInfo: MCPClientInfo;
  private readonly x402?: X402Client;
  private readonly signing?: MCPSigningOptions;
  private readonly extraHeaders?: Record<string, string>;
  private requestCounter = 0;
  private initialised = false;

  constructor(opts: MCPClientOptions = {}) {
    this.endpoint = (opts.endpoint ?? 'https://mcp.truealter.com/api/v1/mcp').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.clientInfo = opts.clientInfo ?? { name: '@truealter/sdk', version: '0.2.0' };
    this.x402 = opts.x402;
    this.signing = opts.signing;
    this.extraHeaders = opts.extraHeaders;
  }

  /**
   * Send the MCP `initialize` handshake and capture the resulting session
   * id. Idempotent, safe to call multiple times.
   */
  async initialize(): Promise<unknown> {
    if (this.initialised) return null;
    const result = await this.rpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    this.initialised = true;
    return result;
  }

  /** List available tools. */
  async listTools(): Promise<MCPListToolsResult> {
    if (!this.initialised) await this.initialize();
    return (await this.rpc('tools/list', {})) as MCPListToolsResult;
  }

  /** Invoke a tool by name. */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
    opts: MCPCallOptions = {},
  ): Promise<MCPCallToolResult<T>> {
    if (!this.initialised) await this.initialize();
    return this.callToolInternal<T>(name, args, opts);
  }

  /** Close the session and release any held resources. */
  async closeSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.fetchImpl(this.endpoint, {
        method: 'DELETE',
        headers: this.buildHeaders(),
      });
    } catch {
      // best-effort
    }
    this.sessionId = null;
    this.initialised = false;
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async callToolInternal<T>(
    name: string,
    args: Record<string, unknown>,
    opts: MCPCallOptions,
  ): Promise<MCPCallToolResult<T>> {
    try {
      const raw = (await this.rpc('tools/call', { name, arguments: args })) as MCPCallToolResult<T>;
      const result = this.shapeToolResult<T>(raw);
      if (result.isError) {
        const text = result.content?.[0]?.text ?? `tool ${name} returned an error`;
        throw new AlterToolError(name, text);
      }
      return result;
    } catch (err) {
      if (err instanceof AlterPaymentRequired && !opts.noPaymentRetry) {
        const x402 = opts.x402 ?? this.x402;
        if (!x402) throw err;
        const settlement = await x402.authorise(err.envelope);
        const retryArgs = { ...args, _payment: X402Client.buildPaymentArg(settlement) };
        return this.callToolInternal<T>(name, retryArgs, { ...opts, noPaymentRetry: true });
      }
      throw err;
    }
  }

  private shapeToolResult<T>(raw: MCPCallToolResult<T>): MCPCallToolResult<T> {
    if (!raw || !Array.isArray(raw.content)) return raw;
    if (raw.data === undefined) {
      const first = raw.content[0];
      if (first && first.type === 'json' && 'data' in first) {
        raw.data = first.data as T;
      } else if (first && first.type === 'text' && first.text) {
        try {
          raw.data = JSON.parse(first.text) as T;
        } catch {
          // leave undefined; caller can read raw.content[0].text
        }
      }
    }
    return raw;
  }

  /**
   * Send a JSON-RPC 2.0 request and return the result. Errors are
   * normalised into the typed {@link AlterError} hierarchy.
   */
  async rpc(method: string, params: Record<string, unknown> | unknown[] | undefined): Promise<unknown> {
    const id = ++this.requestCounter;
    const payload: Record<string, unknown> = {
      jsonrpc: '2.0',
      id,
      method,
    };
    if (params !== undefined) payload.params = params;

    // Q5c, sign `tools/call` when a signing key is configured. Built
    // before the retry loop so a single invocation reuses the same
    // nonce/iat pair across transient-retry attempts. Server Redis
    // replay defence accepts only one successful verification per
    // `(kid, nonce)`, so reusing the header on a retry after a 5xx
    // simply repeats the verification that already passed (or fails
    // the same way it already failed).
    //
    // Operator-visible idempotency break: retry after server-side nonce
    // commit + 5xx will return `nonce_replayed` (intentional fail-closed;
    // operators must re-sign the envelope to retry).
    const signatureHeader = this.buildSignatureHeader(method, params);

    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt <= this.maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let resp: Response;
      try {
        resp = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: this.buildHeaders(signatureHeader),
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isAbort = (err as Error)?.name === 'AbortError';
        if (isAbort) {
          lastErr = new AlterTimeoutError(`MCP ${method} timed out after ${this.timeoutMs}ms`, err);
        } else {
          lastErr = new AlterNetworkError(`MCP ${method}: ${(err as Error).message}`, err);
        }
        if (attempt > this.maxRetries) throw lastErr;
        await this.backoff(attempt);
        continue;
      }
      clearTimeout(timer);

      // Capture session id when present.
      const sessionHeader = resp.headers.get('Mcp-Session-Id');
      if (sessionHeader) this.sessionId = sessionHeader;

      if (resp.status === 401 || resp.status === 403) {
        throw new AlterAuthError(`HTTP ${resp.status} on ${method}`, resp.status);
      }
      if (resp.status === 402) {
        const envelope = await this.extractPaymentEnvelope(resp);
        throw new AlterPaymentRequired(this.guessToolName(payload), envelope);
      }
      if (resp.status === 429) {
        // sdk/L-1 pentest 2026-04-17: Retry-After is server-controlled. Cap
        // to 300 s so a hostile server can't amplify a single 429 into an
        // indefinite sleep / agent hang. Fall back to 60 s when the header
        // is missing or non-numeric.
        const rawRetryAfter = Number(resp.headers.get('Retry-After') ?? 60);
        const retryAfter = Number.isFinite(rawRetryAfter) && rawRetryAfter >= 0
          ? Math.min(rawRetryAfter, 300)
          : 60;
        if (attempt > this.maxRetries) {
          throw new AlterRateLimited(`HTTP 429 on ${method}`, retryAfter);
        }
        await this.backoff(attempt, retryAfter * 1000);
        continue;
      }
      if (RETRYABLE_STATUSES.has(resp.status) && attempt <= this.maxRetries) {
        await this.backoff(attempt);
        continue;
      }
      if (!resp.ok) {
        const body = await safeText(resp);
        throw new AlterError('NETWORK', `HTTP ${resp.status} on ${method}: ${body.slice(0, 200)}`);
      }

      let body: { result?: unknown; error?: { code: number; message: string; data?: unknown } };
      try {
        body = (await resp.json()) as typeof body;
      } catch (err) {
        throw new AlterInvalidResponse(`MCP ${method}: invalid JSON body`, err);
      }

      if (body.error) {
        // Map JSON-RPC errors to typed errors when possible.
        const code = body.error.code;
        const message = body.error.message ?? `MCP ${method} error`;
        if (code === -32001 || code === 402) {
          // Payment-required encoded as an RPC error rather than HTTP 402.
          const data = body.error.data as { envelope?: PaymentEnvelope } | undefined;
          if (data?.envelope) {
            throw new AlterPaymentRequired(this.guessToolName(payload), data.envelope);
          }
        }
        throw new AlterToolError(this.guessToolName(payload), message, code);
      }
      return body.result;
    }
    throw lastErr ?? new AlterNetworkError(`MCP ${method}: exhausted retries`);
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...(this.extraHeaders ?? {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `${this.clientInfo.name}/${this.clientInfo.version}`,
    };
    if (this.apiKey) headers['X-ALTER-API-Key'] = this.apiKey;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (extra) Object.assign(headers, extra);
    return headers;
  }

  /**
   * Produce the `Mcp-Invocation-Signature` header for a `tools/call`
   * payload, when signing is configured. Returns `undefined` when no
   * signing key is attached or the method is not `tools/call`.
   */
  private buildSignatureHeader(
    method: string,
    params: Record<string, unknown> | unknown[] | undefined,
  ): Record<string, string> | undefined {
    if (!this.signing) return undefined;
    if (method !== 'tools/call') return undefined;
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!p?.name) return undefined;
    // Lazy import so consumers that never sign don't load the signer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { signInvocation } = require('./signing.js') as typeof import('./signing.js');
    const headerValue = signInvocation(p.name, p.arguments ?? {}, {
      kid: this.signing.kid,
      privateKey: this.signing.privateKey,
      handle: this.signing.handle,
    });
    return { 'Mcp-Invocation-Signature': headerValue };
  }

  private async extractPaymentEnvelope(resp: Response): Promise<PaymentEnvelope> {
    const headerValue = resp.headers.get('X-402-Payment') ?? resp.headers.get('x-402-payment');
    if (headerValue) {
      const parsed = parsePaymentHeader(headerValue);
      if (parsed) return parsed;
    }
    try {
      const body = (await resp.json()) as { envelope?: PaymentEnvelope; payment?: PaymentEnvelope };
      if (body?.envelope) return body.envelope;
      if (body?.payment) return body.payment;
    } catch {
      // fall through
    }
    return {
      scheme: 'x402',
      network: 'base',
      asset: 'USDC',
      amount: '0',
      recipient: '',
      resource: '',
    };
  }

  private guessToolName(payload: Record<string, unknown>): string {
    const params = payload.params as { name?: string } | undefined;
    return params?.name ?? (payload.method as string) ?? 'unknown';
  }

  private async backoff(attempt: number, hintMs?: number): Promise<void> {
    const ms = hintMs ?? Math.min(1000 * 2 ** (attempt - 1), 8000);
    await new Promise((res) => setTimeout(res, ms));
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
