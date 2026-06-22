/**
 * ES256 per-invocation signing for MCP tool calls (Q5c).
 *
 * The server-side Q5c gate (hard-required from 2026-04-20) demands
 * every authenticated `tools/call` carries an `Mcp-Invocation-Signature`
 * header, a compact JWS (header.payload.signature) signed ES256
 * (ECDSA on P-256 + SHA-256) by a private key whose public half has
 * been pre-registered via `POST /api/v1/agents/keys`.
 *
 * This module produces the header. The wire-format contract MUST
 * match `backend/app/mcp/invocation_signing.py` byte-for-byte -
 * particularly the canonical JSON encoding of `tool_args` and the
 * header + claim shape.
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { createPrivateKey } from 'node:crypto';

// ---------------------------------------------------------------------------
// Canonical JSON, mirrors backend/app/mcp/invocation_signing.py.
// ---------------------------------------------------------------------------

/**
 * Stable stringify mirroring Python's
 *   `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
 *
 * Rules:
 *   - object keys are sorted ascending by codepoint
 *   - no whitespace
 *   - `ensure_ascii=False`, non-ASCII characters pass through verbatim
 *     (not re-encoded as \\uXXXX). UTF-8 encoding happens at the byte
 *     layer before hashing.
 *
 * This is RFC-8785 adjacent; it is NOT a full JCS implementation
 * (numeric canonicalisation is delegated to the caller).
 */
export function canonicalStringify(value: unknown): string {
  return stringifyInner(value);
}

function stringifyInner(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new TypeError('canonicalStringify: undefined is not representable in JSON');
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalStringify: non-finite numbers are not representable');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringifyInner(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => encodeString(k) + ':' + stringifyInner(obj[k]))
        .join(',') +
      '}'
    );
  }
  throw new TypeError(`canonicalStringify: unsupported type ${typeof value}`);
}

/**
 * JSON string escape that matches Python `json.dumps(ensure_ascii=False)`.
 *
 * Python escapes the control set (U+0000..U+001F), the double-quote,
 * and the backslash. Anything else passes through verbatim. Node's
 * built-in `JSON.stringify` does the same, we reuse it.
 */
function encodeString(s: string): string {
  return JSON.stringify(s);
}

/**
 * Hex SHA-256 of the canonical JSON encoding of `toolArgs`. Matches
 * `canonical_args_sha256` in the server-side verifier.
 */
export function canonicalArgsSha256(toolArgs: Record<string, unknown>): string {
  const canonical = canonicalStringify(toolArgs ?? {});
  const bytes = new TextEncoder().encode(canonical);
  const digest = sha256(bytes);
  return bytesToHex(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function base64urlEncode(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  // Node Buffer if available, else manual.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw).toString('base64url');
  }
  // Browser fallback.
  let binary = '';
  for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ---------------------------------------------------------------------------
// Private-key loading (raw d-scalar or PEM)
// ---------------------------------------------------------------------------

/**
 * Load an ES256 P-256 private key.
 *
 * Accepts:
 *   - a 32-byte `Uint8Array` containing the raw d-scalar
 *   - a PEM string (PKCS#8 or SEC1). Node's `crypto.createPrivateKey`
 *     is used when available to parse the PEM; on non-Node runtimes
 *     only the raw-bytes form is supported.
 */
export function loadPrivateKey(key: Uint8Array | string): Uint8Array {
  if (key instanceof Uint8Array) {
    if (key.length !== 32) {
      throw new TypeError('ES256 raw private key must be 32 bytes.');
    }
    return key;
  }
  if (typeof key === 'string' && key.includes('-----BEGIN')) {
    const keyObj = createPrivateKey({ key, format: 'pem' });
    const jwk = keyObj.export({ format: 'jwk' }) as { crv?: string; d?: string };
    if (jwk.crv !== 'P-256' || !jwk.d) {
      throw new TypeError('PEM is not a P-256 private key.');
    }
    // jwk.d is base64url
    return base64urlDecodeToBytes(jwk.d);
  }
  throw new TypeError('loadPrivateKey: expected Uint8Array(32) or PEM string.');
}

function base64urlDecodeToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export interface InvocationClaims {
  /** Tool name, must equal the `tools/call` `params.name`. */
  tool: string;
  /** Hex SHA-256 of canonical-JSON `tool_args`. */
  args_sha256: string;
  /** Random string, at least ~16 bytes of entropy (base64url). */
  nonce: string;
  /** Epoch seconds. Server accepts ±60s skew. */
  iat: number;
  /** The caller's bound ~handle. */
  iss: string;
}

export interface SignInvocationOptions {
  /** The signing-key id pre-registered on the server. */
  kid: string;
  /** P-256 private key (32-byte Uint8Array or PEM string). */
  privateKey: Uint8Array | string;
  /** The caller's bound ~handle. */
  handle: string;
  /** Override nonce (tests). Defaults to 24 random bytes base64url. */
  nonce?: string;
  /** Override iat (tests). Defaults to now. */
  iatSeconds?: number;
}

/**
 * Produce the `Mcp-Invocation-Signature` header value for a single
 * `tools/call`. The returned string is a compact JWS:
 *   `base64url(header) . base64url(payload) . base64url(signature)`
 *
 * Usage:
 *
 * ```ts
 * const header = signInvocation("get_profile", { member_id: "abc" }, {
 *   kid, privateKey, handle: "~tester",
 * });
 * fetch(url, { headers: { "Mcp-Invocation-Signature": header } });
 * ```
 */
export function signInvocation(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: SignInvocationOptions,
): string {
  const { kid, privateKey, handle } = options;
  const nonce = options.nonce ?? base64urlEncode(randomBytes(24));
  const iat = options.iatSeconds ?? Math.floor(Date.now() / 1000);

  const claims: InvocationClaims = {
    tool: toolName,
    args_sha256: canonicalArgsSha256(toolArgs ?? {}),
    nonce,
    iat,
    iss: handle,
  };

  const headerB64 = base64urlEncode(JSON.stringify({ alg: 'ES256', kid }));
  const payloadB64 = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signingBytes = new TextEncoder().encode(signingInput);

  const dBytes = loadPrivateKey(privateKey);
  // @noble/curves 1.6+ `p256.sign` returns an `ECDSASigRecovered`
  // instance; `.toCompactRawBytes()` yields the 64-byte JWS ES256 wire
  // form (32-byte r followed by 32-byte s).
  const digest = sha256(signingBytes);
  const sig = p256.sign(digest, dBytes, { prehash: false });
  const sigBytes = sig.toCompactRawBytes();
  const sigB64 = base64urlEncode(sigBytes);

  return `${signingInput}.${sigB64}`;
}
