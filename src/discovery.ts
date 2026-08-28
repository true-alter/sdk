/**
 * MCP endpoint discovery.
 *
 * Implements the three-step discovery cascade defined in
 * `draft-morrison-mcp-dns-discovery-01`:
 *
 *   1. DNS TXT record at `_mcp.<domain>` with `mcp=<url>` attribute
 *   2. HTTPS GET `https://<domain>/.well-known/mcp.json`
 *   3. HTTPS GET `https://<domain>/.well-known/alter.json`
 *
 * The DNS lookup is only attempted in environments that expose `dns`
 * (Node, Bun, Deno with the node compatibility layer). Browsers and
 * Cloudflare Workers fall through to the `.well-known` lookups.
 */

import { AlterDiscoveryError, AlterNetworkError } from './errors.js';

export interface DiscoveryResult {
  /** Resolved MCP endpoint URL. */
  url: string;
  /** MCP transport, currently always `streamable-http`. */
  transport: 'streamable-http';
  /** Source of the discovery hit, useful for diagnostics. */
  source: 'dns' | 'mcp.json' | 'alter.json' | 'override';
  /** Optional Ed25519 public key from `alter.json` for provenance verification. */
  publicKey?: string;
  /** Optional x402 contract address. */
  x402Contract?: string;
  /** Capability level (E1-E4) when present. */
  capability?: string;
  /** Raw discovery document, kept for callers that want to inspect it. */
  raw?: Record<string, unknown>;
}

export interface DiscoveryOptions {
  /** Cache hits in memory for the duration of this process. Default true. */
  cache?: boolean;
  /** Skip DNS lookup even when available. */
  skipDns?: boolean;
  /** Per-request timeout in milliseconds. Default 5_000. */
  timeoutMs?: number;
  /** Override fetch implementation (for testing). */
  fetch?: typeof fetch;
}

const _cache = new Map<string, DiscoveryResult>();

/**
 * Resolve the ALTER MCP endpoint for `domain`.
 *
 * Order: cache → DNS TXT → mcp.json → alter.json. Throws
 * {@link AlterDiscoveryError} if every step fails.
 */
export async function discover(domain: string, opts: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const { cache = true, skipDns = false, timeoutMs = 5_000, fetch: fetchImpl = fetch } = opts;
  const host = normaliseDomain(domain);

  if (cache && _cache.has(host)) return _cache.get(host)!;

  const errors: string[] = [];

  // 1. DNS TXT
  if (!skipDns) {
    try {
      const dnsHit = await tryDns(host);
      if (dnsHit) {
        const parsed = validateDiscoveredUrl(dnsHit, 'dns');
        const result: DiscoveryResult = {
          url: parsed.toString().replace(/\/$/, ''),
          transport: 'streamable-http',
          source: 'dns',
        };
        if (cache) _cache.set(host, result);
        return result;
      }
    } catch (err) {
      errors.push(`dns: ${(err as Error).message}`);
    }
  }

  // 2. .well-known/mcp.json
  try {
    const result = await tryWellKnown(host, 'mcp.json', timeoutMs, fetchImpl);
    if (result) {
      if (cache) _cache.set(host, result);
      return result;
    }
  } catch (err) {
    errors.push(`mcp.json: ${(err as Error).message}`);
  }

  // 3. .well-known/alter.json
  try {
    const result = await tryWellKnown(host, 'alter.json', timeoutMs, fetchImpl);
    if (result) {
      if (cache) _cache.set(host, result);
      return result;
    }
  } catch (err) {
    errors.push(`alter.json: ${(err as Error).message}`);
  }

  throw new AlterDiscoveryError(
    `No MCP discovery hit for ${host}: ${errors.join('; ') || 'all sources empty'}`,
  );
}

/** Wipe the in-memory discovery cache. */
export function clearDiscoveryCache(): void {
  _cache.clear();
}

// ── Internals ────────────────────────────────────────────────────────────

function normaliseDomain(input: string): string {
  // Strip protocol, path, port, trailing slashes.
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '');
  host = host.split('/')[0];
  host = host.split(':')[0];
  if (!host) throw new AlterDiscoveryError(`Empty domain: "${input}"`);
  return host;
}

/**
 * Validate a URL returned from DNS TXT or `.well-known` discovery before
 * accepting it as an MCP endpoint.
 *
 * - Requires `https:` (rejects `http:` and any non-https scheme).
 * - Rejects `user:pass@host`, Basic-auth credentials in a discovery doc
 *   would leak to whatever host sits behind them.
 * - Requires a non-empty hostname.
 *
 * Throws {@link AlterDiscoveryError} on any violation; returns the parsed
 * `URL` on success so callers can re-use the normalised form.
 */
function validateDiscoveredUrl(url: string, source: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AlterDiscoveryError(`${source}: malformed URL ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new AlterDiscoveryError(
      `${source}: non-https MCP endpoint rejected (got ${parsed.protocol}//${parsed.hostname})`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new AlterDiscoveryError(
      `${source}: MCP endpoint must not contain userinfo (user:pass@host)`,
    );
  }
  if (!parsed.hostname) {
    throw new AlterDiscoveryError(`${source}: MCP endpoint missing hostname`);
  }
  return parsed;
}

async function tryDns(host: string): Promise<string | null> {
  // DNS lookups only work where `node:dns` is available. We import lazily
  // so the module stays tree-shakeable in the browser.
  let resolveTxt: (name: string) => Promise<string[][]>;
  try {
    const dns = await import('node:dns/promises');
    resolveTxt = dns.resolveTxt.bind(dns);
  } catch {
    return null;
  }

  let records: string[][];
  try {
    records = await resolveTxt(`_mcp.${host}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTFOUND / ENODATA are normal misses, not errors.
    if (code === 'ENOTFOUND' || code === 'ENODATA') return null;
    throw err;
  }

  for (const chunks of records) {
    const joined = chunks.join('');
    const parsed = parseDnsTxt(joined);
    if (parsed.mcp) return parsed.mcp;
  }
  return null;
}

function parseDnsTxt(record: string): Record<string, string> {
  // Records are key=value pairs separated by whitespace or semicolons.
  const out: Record<string, string> = {};
  for (const part of record.split(/[;\s]+/)) {
    const [k, ...rest] = part.split('=');
    if (!k || rest.length === 0) continue;
    out[k.toLowerCase()] = rest.join('=');
  }
  return out;
}

async function tryWellKnown(
  host: string,
  file: 'mcp.json' | 'alter.json',
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<DiscoveryResult | null> {
  const url = `https://${host}/.well-known/${file}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    // `redirect: "manual"`, the URL is constructed from caller-supplied
    // domain input; a 3xx to an attacker-controlled origin would silently
    // hand that origin's JSON (including `pk`/`x402`/`cap`) to the SDK as
    // authoritative discovery data. Any redirect is rejected explicitly below.
    resp = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (err) {
    throw new AlterNetworkError(`fetch ${url}: ${(err as Error).message}`, err);
  } finally {
    clearTimeout(timer);
  }

  // Manual-redirect mode surfaces 3xx as opaque-redirect (status 0) in browsers
  // and as the actual status in Node. Either way, reject: the Location target
  // is NOT within the validated domain.
  if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
    throw new AlterNetworkError(
      `${url} → redirect rejected (discovery must not follow redirects; validate the server configuration)`,
    );
  }
  if (resp.status === 404) return null;
  if (!resp.ok) throw new AlterNetworkError(`${url} → HTTP ${resp.status}`);

  const doc = (await resp.json()) as Record<string, unknown>;

  if (file === 'mcp.json') {
    // mcp.json may carry remotes[] or a top-level url
    const remotes = (doc.remotes as Array<{ url?: string; transportType?: string }>) || [];
    const remote = remotes.find((r) => r.transportType === 'streamable-http' || r.transportType === 'http');
    const rawUrl = remote?.url || (doc.url as string | undefined);
    if (!rawUrl) return null;
    const parsed = validateDiscoveredUrl(rawUrl, 'mcp.json');
    return { url: parsed.toString().replace(/\/$/, ''), transport: 'streamable-http', source: 'mcp.json', raw: doc };
  }

  // alter.json, { v, mcp, pk, x402, cap, ... }
  const mcpHost = doc.mcp as string | undefined;
  if (!mcpHost) return null;
  const normalised = ensureMcpPath(mcpHost);
  validateDiscoveredUrl(normalised, 'alter.json');
  return {
    url: normalised,
    transport: 'streamable-http',
    source: 'alter.json',
    publicKey: doc.pk as string | undefined,
    x402Contract: doc.x402 as string | undefined,
    capability: doc.cap as string | undefined,
    raw: doc,
  };
}

/**
 * `.well-known/alter.json` carries the bare branded host
 * (`https://mcp.truealter.com`) but the actual JSON-RPC endpoint lives
 * at `/api/v1/mcp`. If the discovered URL has no path component, append
 * it. URLs that already include a path are left alone, newer descriptors
 * may move the endpoint.
 */
function ensureMcpPath(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname === '' || u.pathname === '/') u.pathname = '/api/v1/mcp';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}
