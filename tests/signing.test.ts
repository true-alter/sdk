/**
 * Tests for the Q5c per-invocation signing helper.
 *
 * Round-trips a signed invocation through the same verification path
 * a Python server would take (parse JWS, decode header, verify ES256
 * signature, check claims). The P-256 public key is derived from the
 * private scalar via @noble/curves.
 */
import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

import {
  canonicalArgsSha256,
  canonicalStringify,
  signInvocation,
} from '../src/signing.js';

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return new Uint8Array(Buffer.from((s + pad).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

describe('canonicalStringify', () => {
  it('sorts object keys', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('emits no whitespace', () => {
    expect(canonicalStringify({ x: [1, 2, 3] })).toBe('{"x":[1,2,3]}');
  });
  it('encodes empty dict compactly', () => {
    expect(canonicalStringify({})).toBe('{}');
  });
  it('preserves non-ASCII verbatim (ensure_ascii=false parity)', () => {
    expect(canonicalStringify({ g: 'héllo' })).toBe('{"g":"héllo"}');
  });
});

describe('canonicalArgsSha256', () => {
  it('is key-order-invariant', () => {
    const a = canonicalArgsSha256({ a: 1, b: 2 });
    const b = canonicalArgsSha256({ b: 2, a: 1 });
    expect(a).toBe(b);
  });
  it('matches the locked empty-object hash', () => {
    // Python: hashlib.sha256(b"{}").hexdigest() = '44136fa355b3...'
    expect(canonicalArgsSha256({})).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', // pragma: allowlist secret
    );
  });
});

describe('signInvocation', () => {
  it('produces a three-segment JWS', () => {
    const d = randomBytes(32);
    const jws = signInvocation(
      'get_profile',
      { member_id: 'abc' },
      { kid: 'ask_x', privateKey: d, handle: '~tester' },
    );
    expect(jws.split('.').length).toBe(3);
  });

  it('round-trips: header kid + alg, claims correct, signature verifies', () => {
    const d = randomBytes(32);
    const pub = p256.getPublicKey(d, false); // uncompressed: 0x04 || X || Y
    const kid = 'ask_roundtrip';
    const handle = '~tester';
    const args = { member_id: 'abc', limit: 10 };
    const jws = signInvocation('get_profile', args, {
      kid,
      privateKey: d,
      handle,
    });
    const [h64, p64, s64] = jws.split('.');
    const header = JSON.parse(Buffer.from(b64urlDecode(h64)).toString('utf-8'));
    expect(header).toEqual({ alg: 'ES256', kid });
    const claims = JSON.parse(Buffer.from(b64urlDecode(p64)).toString('utf-8'));
    expect(claims.tool).toBe('get_profile');
    expect(claims.iss).toBe(handle);
    expect(claims.args_sha256).toBe(canonicalArgsSha256(args));
    expect(typeof claims.nonce).toBe('string');
    expect(claims.nonce.length).toBeGreaterThan(0);
    expect(typeof claims.iat).toBe('number');
    // Verify the signature itself against the public key.
    const signingInput = new TextEncoder().encode(`${h64}.${p64}`);
    const digest = sha256(signingInput);
    const sig = b64urlDecode(s64);
    // signInvocation uses format: 'compact' (r||s, 64 bytes).
    expect(sig.length).toBe(64);
    const ok = p256.verify(sig, digest, pub, { prehash: false, format: 'compact' });
    expect(ok).toBe(true);
  });

  it('rejects iat well outside the ±60s window when compared server-side', () => {
    // The signer itself doesn't reject stale iat — server enforces
    // that. But we can assert the signer respects the override so
    // stale-iat tests in the server suite are reproducible.
    const d = randomBytes(32);
    const jws = signInvocation(
      'get_profile',
      {},
      {
        kid: 'ask_stale',
        privateKey: d,
        handle: '~tester',
        iatSeconds: 10_000,
      },
    );
    const [, p64] = jws.split('.');
    const claims = JSON.parse(Buffer.from(b64urlDecode(p64)).toString('utf-8'));
    expect(claims.iat).toBe(10_000);
  });
});
