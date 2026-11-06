/**
 * ES256 per-invocation signing for MCP tool calls, and the matching verifier.
 *
 * The server-side signature gate requires that
 * every authenticated `tools/call` carries an `Mcp-Invocation-Signature`
 * header: a compact JWS (header.payload.signature) signed ES256
 * (ECDSA on P-256 + SHA-256) by a private key whose public half has
 * been pre-registered via `POST /api/v1/agents/keys`.
 *
 * This module produces the header. The wire-format contract MUST
 * match ~Alter's server-side per-invocation signature verifier
 * byte-for-byte: particularly the canonical JSON encoding of
 * `tool_args` and the header + claim shape.
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { createPrivateKey, createPublicKey } from 'node:crypto';

import { canonicalStringify, parseStrictWire } from './canonical.js';

// The canonical form lives in its own module; it is re-exported here so the
// import path callers already use keeps working.
export { canonicalStringify };

/**
 * Hex SHA-256 of the canonical JSON encoding of `toolArgs`. Matches the
 * server's own args digest.
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

/** Lifetime given to a signed invocation when the caller sets none, in seconds. */
export const INVOCATION_DEFAULT_TTL_SECONDS = 120;

/** Longest lifetime a signed invocation may be given, and the most a verifier accepts, in seconds. */
export const INVOCATION_MAX_TTL_SECONDS = 3600;

/** Clock difference {@link verifyInvocation} tolerates by default, in seconds. */
export const INVOCATION_CLOCK_SKEW_SECONDS = 60;

/** Shortest `nonce` the verifier accepts: 16 random bytes in base64url. */
const MIN_NONCE_LENGTH = 22;

export interface InvocationClaims {
  /** Tool name: must equal the `tools/call` `params.name`. */
  tool: string;
  /** Hex SHA-256 of canonical-JSON `tool_args`. */
  args_sha256: string;
  /** Random string, at least ~16 bytes of entropy (base64url). */
  nonce: string;
  /** Epoch seconds. Server accepts ±60s skew. */
  iat: number;
  /** Expiry, epoch seconds: `iat` plus the invocation's lifetime. */
  exp: number;
  /** Unique id for this invocation, 128 random bits in base64url. */
  jti: string;
  /** The caller's bound ~handle. */
  iss: string;
  /** The verifier this invocation is addressed to. Present when `audience` was given. */
  aud?: string;
}

export interface SignInvocationOptions {
  /** The signing-key id pre-registered on the server. */
  kid: string;
  /** P-256 private key (32-byte Uint8Array or PEM string). */
  privateKey: Uint8Array | string;
  /** The caller's bound ~handle. */
  handle: string;
  /**
   * The verifier this invocation is addressed to, emitted as `aud`. A
   * verifier built with {@link verifyInvocation} requires it and refuses an
   * invocation addressed anywhere else. Left out when not given, because a
   * verifier that does not expect an audience refuses a token that names one.
   */
  audience?: string;
  /**
   * Lifetime in seconds, emitted as `exp = iat + ttlSeconds`. Defaults to
   * {@link INVOCATION_DEFAULT_TTL_SECONDS}; must be a whole number from 1 to
   * {@link INVOCATION_MAX_TTL_SECONDS}.
   */
  ttlSeconds?: number;
  /** Override nonce (tests). Defaults to 24 random bytes base64url. */
  nonce?: string;
  /** Override jti (tests). Defaults to 16 random bytes base64url. */
  jti?: string;
  /** Override iat (tests). Defaults to now. */
  iatSeconds?: number;
}

/**
 * Produce the `Mcp-Invocation-Signature` header value for a single
 * `tools/call`. The returned string is a compact JWS:
 *   `base64url(header) . base64url(payload) . base64url(signature)`
 *
 * The payload carries `tool`, `args_sha256`, `nonce`, `iat`, `exp`, `jti`
 * and `iss`, plus `aud` when `audience` is given.
 *
 * Usage:
 *
 * ```ts
 * const header = signInvocation("get_profile", { member_id: "abc" }, {
 *   kid, privateKey, handle: "~yourhandle",
 * });
 * fetch(url, { headers: { "Mcp-Invocation-Signature": header } });
 * ```
 */
export function signInvocation(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: SignInvocationOptions,
): string {
  const { kid, privateKey, handle, audience } = options;
  const ttl = options.ttlSeconds ?? INVOCATION_DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > INVOCATION_MAX_TTL_SECONDS) {
    throw new RangeError(
      `signInvocation: ttlSeconds must be a whole number from 1 to ${INVOCATION_MAX_TTL_SECONDS}, got ${ttl}`,
    );
  }
  if (audience !== undefined && (typeof audience !== 'string' || audience === '')) {
    throw new TypeError('signInvocation: audience must be a non-empty string when given');
  }
  const nonce = options.nonce ?? base64urlEncode(randomBytes(24));
  const jti = options.jti ?? base64urlEncode(randomBytes(16));
  const iat = options.iatSeconds ?? Math.floor(Date.now() / 1000);

  const claims: InvocationClaims = {
    tool: toolName,
    args_sha256: canonicalArgsSha256(toolArgs ?? {}),
    nonce,
    iat,
    exp: iat + ttl,
    jti,
    iss: handle,
  };
  if (audience !== undefined) claims.aud = audience;

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

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Why {@link verifyInvocation} refused an invocation. Each reason is stable.
 *
 *   - `signature_malformed`: not three base64url segments, a header or
 *     payload that is not strict JSON (a repeated claim name included), or a
 *     signature that is not 64 bytes
 *   - `unsupported_alg`: the header's `alg` is not `ES256`
 *   - `kid_mismatch`: the header's `kid` is not `expectedKid`
 *   - `invalid_signature`: the ES256 signature does not verify
 *   - `missing_claim`: `tool`, `args_sha256`, `nonce`, `iat` or `iss` is absent
 *   - `invalid_claim`: a claim has the wrong type or shape
 *   - `nonce_too_short`: `nonce` is shorter than 22 characters
 *   - `audience_missing`: no `aud`
 *   - `audience_mismatch`: `aud` is not the expected audience
 *   - `exp_missing`: no `exp`
 *   - `expired`: `exp` has passed, allowing for clock skew
 *   - `lifetime_too_long`: `exp` is more than the allowed lifetime past `iat`
 *   - `clock_skew`: `iat` is further in the future than the clock skew allows
 *   - `jti_missing`: no `jti`
 *   - `handle_mismatch`: `iss` is not `expectedIssuer`
 *   - `args_tampered`: `tool` or `args_sha256` does not match what was called
 *   - `jti_replayed`: the replay check reported the `jti` as already seen
 *   - `replay_check_failed`: the replay check threw; the invocation is refused
 */
export type InvocationRefusal =
  | 'signature_malformed'
  | 'unsupported_alg'
  | 'kid_mismatch'
  | 'invalid_signature'
  | 'missing_claim'
  | 'invalid_claim'
  | 'nonce_too_short'
  | 'audience_missing'
  | 'audience_mismatch'
  | 'exp_missing'
  | 'expired'
  | 'lifetime_too_long'
  | 'clock_skew'
  | 'jti_missing'
  | 'handle_mismatch'
  | 'args_tampered'
  | 'jti_replayed'
  | 'replay_check_failed';

/** A P-256 public key as a JWK. */
export interface P256PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface VerifyInvocationOptions {
  /**
   * The signer's P-256 public key: SEC1 bytes (33 compressed or 65
   * uncompressed), an SPKI PEM string, or a JWK.
   */
  publicKey: Uint8Array | string | P256PublicJwk;
  /** Required. The invocation's `aud` must equal this exactly. */
  expectedAudience: string;
  /** When given, the header's `kid` must equal it. */
  expectedKid?: string;
  /** When given, the `iss` claim must equal it. */
  expectedIssuer?: string;
  /** When given, the `tool` claim must equal it. */
  expectedTool?: string;
  /** When given, `args_sha256` must be the digest of these arguments. */
  toolArgs?: Record<string, unknown>;
  /** Current time, epoch seconds. Defaults to now. */
  nowSeconds?: number;
  /**
   * Clock difference tolerated on `exp` and `iat`, in seconds. Defaults to
   * {@link INVOCATION_CLOCK_SKEW_SECONDS}; clamped to 0..300.
   */
  clockSkewSeconds?: number;
  /**
   * Longest `exp - iat` accepted, in seconds. Defaults to and may not exceed
   * {@link INVOCATION_MAX_TTL_SECONDS}.
   */
  maxLifetimeSeconds?: number;
  /**
   * Replay check. Called with the `jti` only once every other check has
   * passed, so a refused invocation never spends a `jti`. Return `true` when
   * the `jti` has been seen before, and record it otherwise; `claims.exp`
   * says how long it needs keeping. The verifier holds no state of its own,
   * so without this hook a replayed invocation verifies, and the result says
   * so in `replayChecked`. A hook that throws refuses the invocation.
   */
  isReplay?: (jti: string, claims: InvocationClaims) => boolean | Promise<boolean>;
}

export interface InvocationVerification {
  valid: boolean;
  /** Present when `valid` is false. */
  reason?: InvocationRefusal;
  /** Human-readable detail for `reason`. */
  detail?: string;
  /** The payload, once the signature has verified. */
  claims?: InvocationClaims;
  /** The header's `kid`, when it could be read. */
  kid?: string;
  /** True when an `isReplay` hook was consulted and passed the `jti`. */
  replayChecked: boolean;
}

const B64URL = /^[A-Za-z0-9_-]*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Verify an `Mcp-Invocation-Signature` value produced by {@link signInvocation}.
 *
 * Requires, in addition to a valid ES256 signature: `aud` equal to
 * `expectedAudience`, an `exp` that has not passed and is no more than the
 * allowed lifetime after `iat`, and a `jti`. The header and payload are read
 * with the strict parser, so a repeated claim name is refused rather than
 * resolved to its last value. Replay protection is the caller's, through
 * `isReplay`; this function stores nothing.
 *
 * Returns a result rather than throwing for a refused invocation. Throws a
 * `TypeError` only when called without an `expectedAudience`.
 */
export async function verifyInvocation(
  jws: string,
  options: VerifyInvocationOptions,
): Promise<InvocationVerification> {
  const { expectedAudience } = options;
  if (typeof expectedAudience !== 'string' || expectedAudience === '') {
    throw new TypeError('verifyInvocation: expectedAudience is required and must be a non-empty string');
  }
  const skew = Math.min(
    Math.max(options.clockSkewSeconds ?? INVOCATION_CLOCK_SKEW_SECONDS, 0),
    MAX_CLOCK_SKEW_SECONDS,
  );
  const maxLifetime = Math.min(
    options.maxLifetimeSeconds ?? INVOCATION_MAX_TTL_SECONDS,
    INVOCATION_MAX_TTL_SECONDS,
  );
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const refused = (
    reason: InvocationRefusal,
    detail: string,
    extra: { claims?: InvocationClaims; kid?: string } = {},
  ): InvocationVerification => ({ valid: false, reason, detail, replayChecked: false, ...extra });

  // --- structure -----------------------------------------------------------
  if (typeof jws !== 'string') return refused('signature_malformed', 'value is not a string');
  const parts = jws.split('.');
  if (parts.length !== 3 || !parts.every((p) => p.length > 0 && B64URL.test(p))) {
    return refused('signature_malformed', 'expected three base64url segments');
  }
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = asObject(parseStrictWire(base64urlDecodeToBytes(parts[0])), 'header');
    payload = asObject(parseStrictWire(base64urlDecodeToBytes(parts[1])), 'payload');
  } catch (err) {
    return refused('signature_malformed', (err as Error).message);
  }
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  if (header.alg !== 'ES256') {
    return refused('unsupported_alg', `alg is ${JSON.stringify(header.alg)}, expected "ES256"`, { kid });
  }
  if (options.expectedKid !== undefined && kid !== options.expectedKid) {
    return refused('kid_mismatch', `kid is ${JSON.stringify(kid)}`, { kid });
  }

  // --- signature -----------------------------------------------------------
  const signature = base64urlDecodeToBytes(parts[2]);
  if (signature.length !== 64) {
    return refused('signature_malformed', `signature is ${signature.length} bytes, expected 64`, { kid });
  }
  let publicKey: Uint8Array;
  try {
    publicKey = loadPublicKey(options.publicKey);
  } catch (err) {
    throw new TypeError(`verifyInvocation: ${(err as Error).message}`);
  }
  let signatureValid = false;
  try {
    const digest = sha256(new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    // lowS is off: an ES256 signer is free to emit either half of s, and
    // many do.
    signatureValid = p256.verify(signature, digest, publicKey, {
      prehash: false,
      lowS: false,
      format: 'compact',
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return refused('invalid_signature', 'ES256 signature does not verify', { kid });

  // --- claims --------------------------------------------------------------
  for (const name of ['tool', 'args_sha256', 'nonce', 'iat', 'iss'] as const) {
    if (!(name in payload)) return refused('missing_claim', `${name} is absent`, { kid });
  }
  const { tool, args_sha256: argsSha256, nonce, iat, iss } = payload;
  if (typeof tool !== 'string' || typeof nonce !== 'string' || typeof iss !== 'string') {
    return refused('invalid_claim', 'tool, nonce and iss must be strings', { kid });
  }
  if (typeof argsSha256 !== 'string' || !HEX64.test(argsSha256)) {
    return refused('invalid_claim', 'args_sha256 must be 64 lowercase hex characters', { kid });
  }
  if (!Number.isSafeInteger(iat)) return refused('invalid_claim', 'iat must be an integer', { kid });
  if (nonce.length < MIN_NONCE_LENGTH) {
    return refused('nonce_too_short', `nonce is ${nonce.length} characters, expected at least ${MIN_NONCE_LENGTH}`, {
      kid,
    });
  }

  if (!('aud' in payload)) return refused('audience_missing', 'aud is absent', { kid });
  if (payload.aud !== expectedAudience) {
    return refused('audience_mismatch', `aud is ${JSON.stringify(payload.aud)}`, { kid });
  }

  if (!('exp' in payload)) return refused('exp_missing', 'exp is absent', { kid });
  const exp = payload.exp;
  if (!Number.isSafeInteger(exp)) return refused('invalid_claim', 'exp must be an integer', { kid });
  if ((exp as number) <= (iat as number)) {
    return refused('invalid_claim', 'exp must be later than iat', { kid });
  }
  if ((exp as number) - (iat as number) > maxLifetime) {
    return refused('lifetime_too_long', `exp is ${(exp as number) - (iat as number)}s after iat, limit ${maxLifetime}s`, {
      kid,
    });
  }
  if (now > (exp as number) + skew) return refused('expired', `expired at ${exp}, now ${now}`, { kid });
  if ((iat as number) > now + skew) return refused('clock_skew', `iat ${iat} is ahead of now ${now}`, { kid });

  if (!('jti' in payload)) return refused('jti_missing', 'jti is absent', { kid });
  if (typeof payload.jti !== 'string' || payload.jti === '') {
    return refused('invalid_claim', 'jti must be a non-empty string', { kid });
  }

  const claims = payload as unknown as InvocationClaims;
  if (options.expectedIssuer !== undefined && iss !== options.expectedIssuer) {
    return refused('handle_mismatch', `iss is ${JSON.stringify(iss)}`, { kid, claims });
  }
  if (options.expectedTool !== undefined && tool !== options.expectedTool) {
    return refused('args_tampered', `tool is ${JSON.stringify(tool)}`, { kid, claims });
  }
  if (options.toolArgs !== undefined) {
    let expected: string;
    try {
      expected = canonicalArgsSha256(options.toolArgs);
    } catch (err) {
      return refused('args_tampered', `arguments have no canonical form: ${(err as Error).message}`, {
        kid,
        claims,
      });
    }
    if (expected !== argsSha256) {
      return refused('args_tampered', 'args_sha256 does not match the arguments', { kid, claims });
    }
  }

  // --- replay, last, so a refused invocation never spends its jti ----------
  if (options.isReplay) {
    let seen: boolean;
    try {
      seen = await options.isReplay(claims.jti, claims);
    } catch (err) {
      return refused('replay_check_failed', (err as Error).message, { kid, claims });
    }
    if (seen) return refused('jti_replayed', `jti ${claims.jti} has been seen before`, { kid, claims });
    return { valid: true, claims, kid, replayChecked: true };
  }
  return { valid: true, claims, kid, replayChecked: false };
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${what} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function loadPublicKey(key: Uint8Array | string | P256PublicJwk): Uint8Array {
  if (key instanceof Uint8Array) {
    if (key.length !== 33 && key.length !== 65) {
      throw new TypeError('P-256 public key bytes must be 33 (compressed) or 65 (uncompressed) long');
    }
    return key;
  }
  let jwk: { kty?: string; crv?: string; x?: string; y?: string };
  if (typeof key === 'string') {
    if (!key.includes('-----BEGIN')) throw new TypeError('public key string must be a PEM');
    jwk = createPublicKey({ key, format: 'pem' }).export({ format: 'jwk' }) as typeof jwk;
  } else {
    jwk = key;
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new TypeError('public key is not a P-256 key');
  }
  const x = base64urlDecodeToBytes(jwk.x);
  const y = base64urlDecodeToBytes(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new TypeError('P-256 coordinates must be 32 bytes');
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}
