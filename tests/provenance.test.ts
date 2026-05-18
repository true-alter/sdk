import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERIFY_AT_ALLOWLIST,
  resolveVerifyAt,
  verifyProvenance,
  verifyToolSignatures,
  type ProvenancePayload,
} from '../src/provenance.js';
import { base64urlEncode } from '../src/auth.js';

// Build a self-signed ES256 token using WebCrypto so the test stays
// dependency-free. We generate a fresh ECDSA P-256 keypair, sign a
// payload, then publish the JWK as a fake JWKS.

async function buildSignedToken(payload: ProvenancePayload): Promise<{
  token: string;
  jwks: { keys: Array<JsonWebKey & { kid: string; alg: string }> };
}> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
  const kid = 'test-kid-1';

  const headerJson = JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' });
  const payloadJson = JSON.stringify(payload);
  const headerB64 = base64urlEncode(new TextEncoder().encode(headerJson));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));
  const signedInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signedInput,
  );
  const sigB64 = base64urlEncode(new Uint8Array(signature));
  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  const jwks = {
    keys: [
      {
        ...jwk,
        kid,
        alg: 'ES256',
        use: 'sig',
      } as JsonWebKey & { kid: string; alg: string },
    ],
  };
  return { token, jwks };
}

describe('verifyProvenance', () => {
  it('accepts a freshly signed valid token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: ProvenancePayload = {
      iss: 'did:alter:platform',
      iat: now,
      exp: now + 3600,
      purpose: 'trait_profile',
      tool: 'assess_traits',
      blast_radius: 'medium',
      data_hash: 'abc',
      requester: '0xreq',
      jti: 'prov_test',
    };
    const { token, jwks } = await buildSignedToken(payload);
    const fetchImpl: typeof fetch = (async () => new Response(JSON.stringify(jwks), { status: 200 })) as typeof fetch;

    const result = await verifyProvenance(token, {
      jwksUrl: `https://test.example/.well-known/keys-${Math.random().toString(36).slice(2)}.json`,
      fetch: fetchImpl,
    });
    expect(result.valid).toBe(true);
    expect(result.payload?.tool).toBe('assess_traits');
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: ProvenancePayload = {
      iss: 'did:alter:platform',
      iat: now - 7200,
      exp: now - 3600,
      purpose: 'trait_profile',
      tool: 'assess_traits',
      blast_radius: 'medium',
      data_hash: 'abc',
      requester: '0xreq',
      jti: 'prov_test',
    };
    const { token, jwks } = await buildSignedToken(payload);
    const fetchImpl: typeof fetch = (async () => new Response(JSON.stringify(jwks), { status: 200 })) as typeof fetch;
    const result = await verifyProvenance(token, {
      jwksUrl: `https://test.example/.well-known/keys-${Math.random().toString(36).slice(2)}.json`,
      fetch: fetchImpl,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a tampered signature', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { token, jwks } = await buildSignedToken({
      iss: 'did:alter:platform',
      iat: now,
      exp: now + 3600,
      purpose: 'trait_profile',
      tool: 'assess_traits',
      blast_radius: 'medium',
      data_hash: 'abc',
      requester: '0xreq',
      jti: 'prov_test',
    });
    // flip a byte in the signature segment
    const parts = token.split('.');
    const sig = parts[2];
    const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, -2)}aa`;
    const fetchImpl: typeof fetch = (async () => new Response(JSON.stringify(jwks), { status: 200 })) as typeof fetch;
    const result = await verifyProvenance(tampered, {
      jwksUrl: `https://test.example/.well-known/keys-${Math.random().toString(36).slice(2)}.json`,
      fetch: fetchImpl,
    });
    expect(result.valid).toBe(false);
  });
});

describe('verifyToolSignatures', () => {
  it('matches when schema hash agrees', async () => {
    const tools = [{ name: 'list_archetypes', inputSchema: { type: 'object', properties: {} } }];
    // Compute the canonical hash the same way the SDK does
    const json = '{"properties":{},"type":"object"}';
    const expectedHash = await sha256Hex(json);
    const sigs = { list_archetypes: { schema_hash: expectedHash, signature: null } };
    const result = await verifyToolSignatures(tools, sigs);
    expect(result[0].valid).toBe(true);
  });

  it('flags when schema hash disagrees', async () => {
    const tools = [{ name: 'list_archetypes', inputSchema: { type: 'object', properties: {} } }];
    const sigs = { list_archetypes: { schema_hash: 'wrong', signature: null } };
    const result = await verifyToolSignatures(tools, sigs);
    expect(result[0].valid).toBe(false);
    expect(result[0].reason).toBe('schema hash mismatch');
  });
});

describe('resolveVerifyAt — hostname allowlist (C-4 defence)', () => {
  it('rejects attacker hostnames not on the allowlist', () => {
    expect(() => resolveVerifyAt('https://evil.example.com/.well-known/keys.json')).toThrow(
      /not on the verify_at allowlist/,
    );
  });

  it('rejects http: scheme unconditionally', () => {
    expect(() => resolveVerifyAt('http://api.truealter.com/.well-known/alter-keys.json')).toThrow(
      /http: scheme is not permitted/,
    );
  });

  it('accepts api.truealter.com from the default allowlist', () => {
    expect(
      resolveVerifyAt('https://api.truealter.com/.well-known/alter-keys.json'),
    ).toBe('https://api.truealter.com/.well-known/alter-keys.json');
  });

  it('accepts mcp.truealter.com from the default allowlist', () => {
    expect(
      resolveVerifyAt('https://mcp.truealter.com/.well-known/alter-keys.json'),
    ).toBe('https://mcp.truealter.com/.well-known/alter-keys.json');
  });

  it('accepts a hostname when added via custom verifyAtAllowlist', () => {
    expect(
      resolveVerifyAt('https://enterprise.example.com/.well-known/keys.json', [
        ...DEFAULT_VERIFY_AT_ALLOWLIST,
        'enterprise.example.com',
      ]),
    ).toBe('https://enterprise.example.com/.well-known/keys.json');
  });

  it('case-insensitive hostname match (URL host is lowercased)', () => {
    // URL parser normalises to lowercase, so API.TRUEALTER.COM == api.truealter.com
    expect(
      resolveVerifyAt('https://API.TRUEALTER.COM/.well-known/alter-keys.json'),
    ).toBe('https://api.truealter.com/.well-known/alter-keys.json');
  });

  it('resolves relative paths against api.truealter.com over https', () => {
    expect(resolveVerifyAt('/.well-known/alter-keys.json')).toBe(
      'https://api.truealter.com/.well-known/alter-keys.json',
    );
  });

  it('rejects non-http(s) schemes (e.g. file:, ftp:)', () => {
    expect(() => resolveVerifyAt('file:///etc/passwd')).toThrow(/unsupported scheme/);
    expect(() => resolveVerifyAt('ftp://evil.example.com/keys.json')).toThrow(
      /unsupported scheme/,
    );
  });

  it('rejects URLs with userinfo even when hostname is allowlisted (sdk/M-1)', () => {
    expect(() =>
      // pragma: allowlist nextline secret
      resolveVerifyAt('https://user:secret@api.truealter.com/.well-known/alter-keys.json'),
    ).toThrow(/userinfo/);
    expect(() =>
      // pragma: allowlist nextline secret
      resolveVerifyAt('https://leak@mcp.truealter.com/.well-known/alter-keys.json'),
    ).toThrow(/userinfo/);
  });
});

describe('fetchJwks — body-size cap and cache bounds (sdk/H-2 + M-2)', () => {
  async function buildValidEnvelope(): Promise<{
    token: string;
    jwks: { keys: unknown[] };
    envelope: Record<string, unknown>;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const payload: ProvenancePayload = {
      iss: 'did:alter:platform',
      iat: now,
      exp: now + 3600,
      purpose: 'trait_profile',
      tool: 'assess_traits',
      blast_radius: 'medium',
      data_hash: 'abc',
      requester: '0xreq',
      jti: 'prov_cap',
    };
    const { token, jwks } = await buildSignedToken(payload);
    return {
      token,
      jwks,
      envelope: {
        version: '1',
        token,
        verify_at: 'https://api.truealter.com/.well-known/alter-keys.json',
      },
    };
  }

  it('rejects oversize JWKS body advertised via Content-Length', async () => {
    const { envelope } = await buildValidEnvelope();
    const fetchImpl: typeof fetch = (async () =>
      new Response('{"keys":[]}', {
        status: 200,
        headers: { 'content-length': String(128 * 1024) },
      })) as typeof fetch;

    const result = await verifyProvenance(envelope as never, { fetch: fetchImpl });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/JWKS too large/);
  });

  it('rejects oversize JWKS body when Content-Length is absent', async () => {
    const { envelope } = await buildValidEnvelope();
    // Pad to ~96KB of padding bytes around a plausible keys array — no
    // Content-Length header set so the text-length fallback must catch it.
    const huge = JSON.stringify({ keys: [], pad: 'x'.repeat(96 * 1024) });
    const fetchImpl: typeof fetch = (async () =>
      new Response(huge, { status: 200 })) as typeof fetch;

    const result = await verifyProvenance(envelope as never, { fetch: fetchImpl });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/JWKS too large/);
  });
});

describe('verifyProvenance — allowlist integration', () => {
  async function buildEnvelope(
    verifyAt: string | undefined,
  ): Promise<{ token: string; jwks: { keys: unknown[] }; envelope: Record<string, unknown> }> {
    const now = Math.floor(Date.now() / 1000);
    const payload: ProvenancePayload = {
      iss: 'did:alter:platform',
      iat: now,
      exp: now + 3600,
      purpose: 'trait_profile',
      tool: 'assess_traits',
      blast_radius: 'medium',
      data_hash: 'abc',
      requester: '0xreq',
      jti: 'prov_allowlist',
    };
    const { token, jwks } = await buildSignedToken(payload);
    const envelope: Record<string, unknown> = { version: '1', token };
    if (verifyAt !== undefined) envelope.verify_at = verifyAt;
    return { token, jwks, envelope };
  }

  it('(a) attacker hostname in verify_at is rejected before any fetch', async () => {
    const { envelope } = await buildEnvelope('https://evil.example.com/.well-known/keys.json');
    let fetchCalled = false;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const result = await verifyProvenance(envelope as never, { fetch: fetchImpl });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/verify_at rejected/);
    expect(result.reason).toMatch(/allowlist/);
    expect(fetchCalled).toBe(false);
  });

  it('(b) http:// verify_at is rejected (scheme gate)', async () => {
    const { envelope } = await buildEnvelope('http://api.truealter.com/.well-known/keys.json');
    let fetchCalled = false;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const result = await verifyProvenance(envelope as never, { fetch: fetchImpl });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/http: scheme is not permitted/);
    expect(fetchCalled).toBe(false);
  });

  it('(c) default allowlist passes for api.truealter.com verify_at', async () => {
    const { envelope, jwks } = await buildEnvelope(
      'https://api.truealter.com/.well-known/alter-keys.json',
    );
    let fetchedUrl = '';
    const fetchImpl: typeof fetch = (async (url: string) => {
      fetchedUrl = url;
      return new Response(JSON.stringify(jwks), { status: 200 });
    }) as typeof fetch;

    const result = await verifyProvenance(envelope as never, { fetch: fetchImpl });
    expect(result.valid).toBe(true);
    expect(fetchedUrl).toBe('https://api.truealter.com/.well-known/alter-keys.json');
  });

  it('(d) custom verifyAtAllowlist extends the default', async () => {
    const { envelope, jwks } = await buildEnvelope(
      'https://trust.enterprise.test/.well-known/keys.json',
    );
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify(jwks), { status: 200 })) as typeof fetch;

    const result = await verifyProvenance(envelope as never, {
      fetch: fetchImpl,
      verifyAtAllowlist: [...DEFAULT_VERIFY_AT_ALLOWLIST, 'trust.enterprise.test'],
    });
    expect(result.valid).toBe(true);
  });

  it('(e) caller-passed jwksUrl overrides a hostile verify_at', async () => {
    // Envelope points at the attacker, but the caller has pinned their
    // own JWKS URL — the pinned URL wins and the attacker hostname is
    // never consulted.
    const { envelope, jwks } = await buildEnvelope(
      'https://evil.example.com/.well-known/keys.json',
    );
    const pinnedUrl = 'https://api.truealter.com/.well-known/pinned-keys.json';
    let fetchedUrl = '';
    const fetchImpl: typeof fetch = (async (url: string) => {
      fetchedUrl = url;
      return new Response(JSON.stringify(jwks), { status: 200 });
    }) as typeof fetch;

    const result = await verifyProvenance(envelope as never, {
      fetch: fetchImpl,
      jwksUrl: pinnedUrl,
    });
    expect(result.valid).toBe(true);
    expect(fetchedUrl).toBe(pinnedUrl);
  });

  it('(e-ii) caller-passed http: jwksUrl is still rejected (https-only)', async () => {
    const { envelope } = await buildEnvelope(undefined);
    const fetchImpl: typeof fetch = (async () =>
      new Response('{}', { status: 200 })) as typeof fetch;
    const result = await verifyProvenance(envelope as never, {
      fetch: fetchImpl,
      jwksUrl: 'http://api.truealter.com/.well-known/alter-keys.json',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/jwksUrl must be https/);
  });
});

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
