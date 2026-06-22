/**
 * ES256 provenance verification.
 *
 * ALTER signs medium- and high-blast-radius MCP responses with an ES256
 * JWS attestation in `_meta.provenance.token`. The signing key rotates
 * periodically and is published at `<api-host>/.well-known/alter-keys.json`
 * as a JWKS.
 *
 * This module verifies tokens *without* a JWT library, pure WebCrypto
 * (subtle.verify) keeps the dep graph small and works in every modern
 * runtime (Node 18+, Deno, Bun, Cloudflare Workers, browser).
 */

import { AlterNetworkError, AlterProvenanceError } from './errors.js';
import { base64urlDecode, base64urlEncode } from './auth.js';

export interface ProvenanceEnvelope {
  version: string;
  token: string;
  purpose?: string;
  expires_at?: string;
  tool?: string;
  blast_radius?: 'low' | 'medium' | 'high';
  verify_at?: string;
  [extra: string]: unknown;
}

export interface ProvenancePayload {
  iss: string;
  iat: number;
  exp: number;
  purpose: string;
  tool: string;
  blast_radius: 'medium' | 'high';
  data_hash: string;
  requester: string;
  jti: string;
}

export interface ProvenanceVerification {
  valid: boolean;
  payload?: ProvenancePayload;
  reason?: string;
  /** Issuer's `kid` claim from the JWS header. */
  kid?: string;
}

export interface JsonWebKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface JwksDocument {
  keys: JsonWebKey[];
}

const _jwksCache = new Map<string, { fetched: number; jwks: JwksDocument }>();
const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_MAX_BYTES = 64 * 1024;
const JWKS_CACHE_MAX_ENTRIES = 32;

/**
 * Default hostnames that `envelope.verify_at` is trusted to resolve to.
 *
 * Without this allowlist, a hostile MCP server could point `verify_at`
 * at an attacker-controlled JWKS and pass ES256 verification with its own
 * signing key, the classic "confused-deputy via server-supplied trust
 * anchor" pattern. Any hostname not on this list (or the caller-supplied
 * extension) is rejected before a network fetch is issued. Downstream
 * integrators with their own deployment can extend the list via the
 * `verifyAtAllowlist` option on {@link verifyProvenance} or the
 * `verifyAtAllowlist` constructor option on `AlterClient`.
 */
export const DEFAULT_VERIFY_AT_ALLOWLIST: readonly string[] = Object.freeze([
  'api.truealter.com',
  'mcp.truealter.com',
]);

/**
 * The `iss` claim that ALTER's platform signs into every provenance token.
 * Verifiers check `payload.iss` against this constant (or the caller-supplied
 * `expectedIss` override) to prevent cross-identity substitution.
 */
export const ALTER_PLATFORM_ISS = 'did:alter:platform';

export interface VerifyProvenanceOptions {
  /**
   * Override the JWKS URL entirely. Takes precedence over both the
   * allowlist and any `verify_at` on the envelope, if the caller pins
   * an explicit URL, we use it verbatim (the caller has already vouched
   * for the origin).
   */
  jwksUrl?: string;
  /**
   * Hostnames that are trusted when resolving `envelope.verify_at`.
   * Defaults to {@link DEFAULT_VERIFY_AT_ALLOWLIST}. Passing a list
   * here *replaces* the default, include the ALTER canonicals if you
   * still want them accepted.
   */
  verifyAtAllowlist?: readonly string[];
  fetch?: typeof fetch;
  now?: number;
  /**
   * Expected `iss` claim. Defaults to {@link ALTER_PLATFORM_ISS}
   * (`"did:alter:platform"`). Pass an explicit value only when verifying
   * tokens minted by a non-platform issuer (e.g. a test fixture or a
   * whitelabelled deployment). An empty string disables the check, not
   * recommended for production use.
   */
  expectedIss?: string;
}

/**
 * Verify a provenance JWS token against ALTER's published JWKS.
 *
 * Pass either a {@link ProvenanceEnvelope} (the value of `_meta.provenance`)
 * or the bare JWS string. The function fetches the JWKS lazily, caches it
 * for five minutes, and validates the ES256 signature plus standard
 * registered claims (`exp`, `iat`).
 *
 * Security: when the envelope carries a `verify_at` hint, the hostname
 * MUST be on the allowlist (default: `api.truealter.com`,
 * `mcp.truealter.com`; extend via `verifyAtAllowlist`). `http:` URLs are
 * rejected unconditionally, JWKS fetch must be TLS.
 */
export async function verifyProvenance(
  envelope: ProvenanceEnvelope | string,
  opts: VerifyProvenanceOptions = {},
): Promise<ProvenanceVerification> {
  const token = typeof envelope === 'string' ? envelope : envelope.token;
  if (!token) return { valid: false, reason: 'empty token' };

  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  let header: { alg?: string; kid?: string };
  let payload: ProvenancePayload;
  let signedInput: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('JWS must have three segments');
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1]))) as ProvenancePayload;
    signedInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    signatureBytes = base64urlDecode(parts[2]);
  } catch (err) {
    return { valid: false, reason: `malformed JWS: ${(err as Error).message}` };
  }

  if (header.alg !== 'ES256') {
    return { valid: false, reason: `unsupported alg: ${header.alg}`, kid: header.kid };
  }

  // Discover JWKS URL: explicit option > envelope.verify_at (gated) > default
  const allowlist = opts.verifyAtAllowlist ?? DEFAULT_VERIFY_AT_ALLOWLIST;
  let jwksUrl: string;
  if (opts.jwksUrl) {
    // Caller-supplied URL takes precedence and bypasses the allowlist -
    // the caller has already vouched for this origin. We still enforce
    // https-only to keep JWKS fetches off plaintext HTTP.
    if (!opts.jwksUrl.startsWith('https://')) {
      return {
        valid: false,
        reason: `jwksUrl must be https: got ${opts.jwksUrl}`,
        kid: header.kid,
      };
    }
    jwksUrl = opts.jwksUrl;
  } else if (typeof envelope === 'object' && envelope.verify_at) {
    try {
      jwksUrl = resolveVerifyAt(envelope.verify_at, allowlist);
    } catch (err) {
      return {
        valid: false,
        reason: `verify_at rejected: ${(err as Error).message}`,
        kid: header.kid,
      };
    }
  } else {
    jwksUrl = 'https://api.truealter.com/.well-known/alter-keys.json';
  }

  let jwks: JwksDocument;
  try {
    jwks = await fetchJwks(jwksUrl, fetchImpl);
  } catch (err) {
    return { valid: false, reason: `jwks fetch: ${(err as Error).message}`, kid: header.kid };
  }

  const jwk = jwks.keys.find((k) => (header.kid ? k.kid === header.kid : true));
  if (!jwk) {
    return { valid: false, reason: `no JWK for kid=${header.kid}`, kid: header.kid };
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await importEs256JwkAsPublicKey(jwk);
  } catch (err) {
    return { valid: false, reason: `jwk import: ${(err as Error).message}`, kid: header.kid };
  }

  // ES256 signatures in JWS are raw r||s (64 bytes), which is exactly
  // what WebCrypto expects for ECDSA.
  let signatureValid = false;
  try {
    signatureValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(signedInput),
    );
  } catch (err) {
    return { valid: false, reason: `verify: ${(err as Error).message}`, kid: header.kid };
  }

  if (!signatureValid) {
    return { valid: false, reason: 'signature mismatch', kid: header.kid };
  }

  if (typeof payload.exp === 'number' && payload.exp < now) {
    return { valid: false, reason: 'expired', payload, kid: header.kid };
  }
  if (typeof payload.iat === 'number' && payload.iat > now + 300) {
    return { valid: false, reason: 'issued in the future', payload, kid: header.kid };
  }

  // Validate `iss` claim to prevent cross-identity substitution. The expected
  // issuer defaults to the ALTER platform DID; callers may override via
  // `opts.expectedIss` for non-platform issuers.
  // An explicit empty string opts out of the check (test fixtures only).
  const expectedIss = opts.expectedIss !== undefined ? opts.expectedIss : ALTER_PLATFORM_ISS;
  if (expectedIss !== '' && payload.iss !== expectedIss) {
    return {
      valid: false,
      reason: `iss mismatch: expected "${expectedIss}", got "${payload.iss}"`,
      payload,
      kid: header.kid,
    };
  }

  return { valid: true, payload, kid: header.kid };
}

/**
 * Tool definition signature verification.
 *
 * ALTER signs each tool's input schema at startup and exposes the
 * signatures via the MCP `tools/list` `_meta.signatures` map. This helper
 * checks that each tool's schema hash matches the signed value.
 */
export interface SignedToolDefinition {
  name: string;
  inputSchema: unknown;
}

export interface ToolSignatureMap {
  [toolName: string]: {
    schema_hash: string;
    signature?: string | null;
    signed_at?: number;
    kid?: string | null;
  };
}

export async function verifyToolSignatures(
  tools: SignedToolDefinition[],
  signatures: ToolSignatureMap,
): Promise<{ tool: string; valid: boolean; reason?: string }[]> {
  const out: { tool: string; valid: boolean; reason?: string }[] = [];
  for (const tool of tools) {
    const sig = signatures[tool.name];
    if (!sig) {
      out.push({ tool: tool.name, valid: false, reason: 'no signature published' });
      continue;
    }
    const expectedHash = await sha256Hex(canonicalJson(tool.inputSchema));
    if (expectedHash !== sig.schema_hash) {
      out.push({ tool: tool.name, valid: false, reason: 'schema hash mismatch' });
      continue;
    }
    out.push({ tool: tool.name, valid: true });
  }
  return out;
}

/**
 * Fetch the ALTER public key set. Cached in-process for five minutes.
 */
export async function fetchPublicKeys(jwksUrl: string, fetchImpl: typeof fetch = fetch): Promise<JwksDocument> {
  return fetchJwks(jwksUrl, fetchImpl);
}

// ── Internals ────────────────────────────────────────────────────────────

async function fetchJwks(url: string, fetchImpl: typeof fetch): Promise<JwksDocument> {
  // Cache keyed on origin+pathname so userinfo / query / fragment variants
  // collapse to one entry and cannot poison the cache independently.
  const cacheKey = jwksCacheKey(url);

  const cached = _jwksCache.get(cacheKey);
  if (cached && Date.now() - cached.fetched < JWKS_TTL_MS) return cached.jwks;

  let resp: Response;
  try {
    // `redirect: "manual"`, the allowlist gate runs on the initial URL only;
    // a 3xx to an attacker-controlled origin would otherwise silently defeat
    // the allowlist. Any redirect is rejected explicitly below.
    resp = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
  } catch (err) {
    throw new AlterNetworkError(`fetch ${url}: ${(err as Error).message}`, err);
  }
  // Manual-redirect mode surfaces 3xx as opaque-redirect (status 0) in browsers
  // and as the actual status in Node. Either way, reject: the Location target
  // is NOT allowlist-validated.
  if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
    throw new AlterProvenanceError(
      `${url} → redirect rejected (allowlist enforces initial URL only)`,
    );
  }
  if (!resp.ok) throw new AlterNetworkError(`${url} → HTTP ${resp.status}`);

  // Bound the JWKS body so a hostile origin can't OOM the agent process with
  // a multi-GB response. Prefer the advertised Content-Length; fall back to
  // capping the text body.
  const contentLength = resp.headers.get('content-length');
  if (contentLength !== null) {
    const n = Number.parseInt(contentLength, 10);
    if (Number.isFinite(n) && n > JWKS_MAX_BYTES) {
      throw new AlterProvenanceError(
        `${url} → JWKS too large: ${n} > ${JWKS_MAX_BYTES} bytes`,
      );
    }
  }
  const body = await resp.text();
  if (body.length > JWKS_MAX_BYTES) {
    throw new AlterProvenanceError(
      `${url} → JWKS too large: ${body.length} > ${JWKS_MAX_BYTES} bytes`,
    );
  }
  let doc: JwksDocument;
  try {
    doc = JSON.parse(body) as JwksDocument;
  } catch (err) {
    throw new AlterProvenanceError(`invalid JWKS at ${url}: ${(err as Error).message}`);
  }
  if (!doc || !Array.isArray(doc.keys)) {
    throw new AlterProvenanceError(`invalid JWKS at ${url}`);
  }

  // FIFO eviction, Map preserves insertion order, so the first key is the
  // oldest. Keeps the cache bounded under legitimate rotation and hostile
  // cache-fill attempts alike.
  if (_jwksCache.size >= JWKS_CACHE_MAX_ENTRIES && !_jwksCache.has(cacheKey)) {
    const oldest = _jwksCache.keys().next().value;
    if (oldest !== undefined) _jwksCache.delete(oldest);
  }
  _jwksCache.set(cacheKey, { fetched: Date.now(), jwks: doc });
  return doc;
}

function jwksCacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Resolve a `verify_at` hint from a provenance envelope into a concrete
 * JWKS URL, enforcing scheme + hostname allowlisting.
 *
 * - Relative paths (`/…` or `foo/bar`) resolve against `api.truealter.com`
 *   over https, the canonical ALTER JWKS host.
 * - Absolute URLs must use `https:` (plaintext `http:` is rejected
 *   unconditionally) and the hostname must be a case-insensitive exact
 *   match against `allowlist`.
 * - Anything else throws; callers convert the throw into a
 *   `ProvenanceVerification` failure.
 *
 * Exported for tests; public consumers should prefer the higher-level
 * {@link verifyProvenance} entry point.
 */
export function resolveVerifyAt(
  verifyAt: string,
  allowlist: readonly string[] = DEFAULT_VERIFY_AT_ALLOWLIST,
): string {
  if (typeof verifyAt !== 'string' || verifyAt.length === 0) {
    throw new Error('verify_at must be a non-empty string');
  }

  // Reject plaintext HTTP before we even try to parse, belt and braces.
  if (/^http:\/\//i.test(verifyAt)) {
    throw new Error(`http: scheme is not permitted (got ${verifyAt})`);
  }

  // Relative path → resolve against the canonical ALTER API host.
  if (!/^https:\/\//i.test(verifyAt)) {
    if (verifyAt.includes('://')) {
      throw new Error(`unsupported scheme in verify_at: ${verifyAt}`);
    }
    return `https://api.truealter.com${verifyAt.startsWith('/') ? '' : '/'}${verifyAt}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(verifyAt);
  } catch {
    throw new Error(`malformed verify_at URL: ${verifyAt}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`verify_at must be https: ${verifyAt}`);
  }

  // Reject `user:pass@host` forms, the Basic-auth credential would be
  // sent verbatim to the JWKS origin, leaking whatever the caller embedded
  // into a URL that only looked trusted because of the hostname.
  if (parsed.username || parsed.password) {
    throw new Error(`verify_at must not contain userinfo: ${verifyAt}`);
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = allowlist.some((h) => h.toLowerCase() === host);
  if (!allowed) {
    throw new Error(
      `hostname ${host} is not on the verify_at allowlist (${allowlist.join(', ')})`,
    );
  }

  return parsed.toString();
}

async function importEs256JwkAsPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      ext: true,
    } as JsonWebKey & { ext: boolean },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Coerce a Uint8Array to a fresh ArrayBuffer-backed BufferSource.
 *
 * Modern WebCrypto type definitions reject `Uint8Array<SharedArrayBuffer>`,
 * which is the default for `Uint8Array` in TypeScript ≥5.7 even when the
 * underlying buffer is a regular ArrayBuffer. Slicing through `.buffer`
 * with explicit offsets returns a guaranteed ArrayBuffer view.
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/**
 * Canonical-JSON serialiser matching `tool_signing.compute_tool_schema_hash`
 * in the Python server: sorted keys, no whitespace, comma+colon separators.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

// Re-export base64url helpers for downstream consumers.
export { base64urlEncode, base64urlDecode };
