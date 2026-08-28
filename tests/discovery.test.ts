import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDiscoveryCache, discover } from '../src/discovery.js';
import { AlterDiscoveryError } from '../src/errors.js';

afterEach(() => {
  clearDiscoveryCache();
  vi.restoreAllMocks();
});

function mockFetch(handlers: Record<string, Response | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) return new Response('not configured', { status: 404 });
    if (handler instanceof Error) throw handler;
    return handler;
  }) as typeof fetch;
}

describe('discovery', () => {
  it('returns mcp.json result when present', async () => {
    const fetchImpl = mockFetch({
      'https://example.test/.well-known/mcp.json': new Response(
        JSON.stringify({
          name: 'example',
          remotes: [{ transportType: 'streamable-http', url: 'https://mcp.example.test' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const result = await discover('example.test', { fetch: fetchImpl, skipDns: true, cache: false });
    expect(result.url).toBe('https://mcp.example.test');
    expect(result.source).toBe('mcp.json');
  });

  it('falls back to alter.json when mcp.json is missing', async () => {
    const fetchImpl = mockFetch({
      'https://example.test/.well-known/mcp.json': new Response('', { status: 404 }),
      'https://example.test/.well-known/alter.json': new Response(
        JSON.stringify({
          v: 'alter1',
          mcp: 'https://mcp.example.test',
          pk: 'ed25519:abc',
          x402: 'base:0xabc',
          cap: 'E4',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const result = await discover('example.test', { fetch: fetchImpl, skipDns: true, cache: false });
    // alter.json carries a bare host; the SDK appends /api/v1/mcp.
    expect(result.url).toBe('https://mcp.example.test/api/v1/mcp');
    expect(result.source).toBe('alter.json');
    expect(result.publicKey).toBe('ed25519:abc');
    expect(result.x402Contract).toBe('base:0xabc');
    expect(result.capability).toBe('E4');
  });

  it('throws AlterDiscoveryError when nothing resolves', async () => {
    const fetchImpl = mockFetch({});
    await expect(
      discover('example.test', { fetch: fetchImpl, skipDns: true, cache: false }),
    ).rejects.toBeInstanceOf(AlterDiscoveryError);
  });

  it('caches successful resolutions', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ remotes: [{ transportType: 'streamable-http', url: 'https://mcp.example.test' }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    await discover('cached.test', { fetch: fetchImpl, skipDns: true });
    await discover('cached.test', { fetch: fetchImpl, skipDns: true });
    expect(calls).toBe(1);
  });

  it('rejects a 302 redirect on .well-known/mcp.json (open-redirector guard)', async () => {
    // Simulates an allowlisted host returning a 3xx to an attacker-controlled
    // origin. With `redirect: "manual"`, Node exposes the actual 302 status;
    // browsers expose type === "opaqueredirect". Both paths must throw.
    const fetchImpl = mockFetch({
      'https://example.test/.well-known/mcp.json': new Response('', {
        status: 302,
        headers: { Location: 'https://evil.attacker.test/evil.json' },
      }),
      'https://example.test/.well-known/alter.json': new Response('', {
        status: 302,
        headers: { Location: 'https://evil.attacker.test/evil.json' },
      }),
    });

    await expect(
      discover('example.test', { fetch: fetchImpl, skipDns: true, cache: false }),
    ).rejects.toBeInstanceOf(AlterDiscoveryError);
  });

  it('rejects an opaque-redirect response (browser open-redirector guard)', async () => {
    // In browser fetch with redirect: "manual", 3xx surfaces as type === "opaqueredirect"
    // with status 0. Node's Response constructor rejects status 0, so we use a
    // plain object that satisfies the Response duck-type used in the guard check.
    const opaqueRedirect = { type: 'opaqueredirect', status: 0, ok: false } as unknown as Response;
    const fetchImpl: typeof fetch = (async () => opaqueRedirect) as typeof fetch;

    await expect(
      discover('example.test', { fetch: fetchImpl, skipDns: true, cache: false }),
    ).rejects.toBeInstanceOf(AlterDiscoveryError);
  });

  it('strips protocol and path from input domain', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = (async (url: string | URL | Request) => {
      seen.push(typeof url === 'string' ? url : url.toString());
      return new Response('', { status: 404 });
    }) as typeof fetch;
    await expect(
      discover('https://example.test/some/path', { fetch: fetchImpl, skipDns: true, cache: false }),
    ).rejects.toBeInstanceOf(AlterDiscoveryError);
    expect(seen).toContain('https://example.test/.well-known/mcp.json');
  });
});
