import { describe, expect, it } from 'vitest';
import { MCPClient, MCP_PROTOCOL_VERSION } from '../src/mcp.js';
import { AlterAuthError, AlterPaymentRequired, AlterRateLimited, AlterToolError } from '../src/errors.js';
import { X402Client, type X402Signer } from '../src/x402.js';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function makeFetch(
  responder: (call: RecordedCall) => Response | Promise<Response>,
  recorded: RecordedCall[] = [],
): typeof fetch {
  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call: RecordedCall = { url: url.toString(), init };
    recorded.push(call);
    return responder(call);
  }) as typeof fetch;
}

describe('MCPClient', () => {
  it('sends a JSON-RPC initialize handshake', async () => {
    const calls: RecordedCall[] = [];
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      fetch: makeFetch(
        () =>
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: MCP_PROTOCOL_VERSION } }), {
            status: 200,
            headers: { 'Mcp-Session-Id': 'session-xyz', 'Content-Type': 'application/json' },
          }),
        calls,
      ),
    });

    await client.initialize();
    expect(client.sessionId).toBe('session-xyz');
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.method).toBe('initialize');
    expect(body.params.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it('attaches Mcp-Session-Id on subsequent calls', async () => {
    const calls: RecordedCall[] = [];
    let serial = 0;
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      fetch: makeFetch((call) => {
        serial += 1;
        const body = JSON.parse((call.init.body as string) ?? '{}');
        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
            status: 200,
            headers: { 'Mcp-Session-Id': 'session-xyz' },
          });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: '{"ok":true}' }] },
          }),
          { status: 200 },
        );
      }, calls),
    });

    await client.callTool('list_archetypes', {});
    expect(serial).toBe(2);
    const second = calls[1];
    const headers = second.init.headers as Record<string, string>;
    expect(headers['Mcp-Session-Id']).toBe('session-xyz');
  });

  it('forwards extraHeaders on every request', async () => {
    const calls: RecordedCall[] = [];
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      extraHeaders: {
        'X-Custom-Gate-Id': 'cid-abc',
        'X-Custom-Gate-Secret': 'csec-xyz', // pragma: allowlist secret
      },
      fetch: makeFetch(
        (call) => {
          const body = JSON.parse((call.init.body as string) ?? '{}');
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{}' }] } }),
            { status: 200, headers: { 'Mcp-Session-Id': 'session-xyz' } },
          );
        },
        calls,
      ),
    });

    await client.callTool('list_archetypes', {});
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers['X-Custom-Gate-Id']).toBe('cid-abc');
      expect(headers['X-Custom-Gate-Secret']).toBe('csec-xyz');
    }
  });

  it('extraHeaders cannot override protocol or auth headers', async () => {
    const calls: RecordedCall[] = [];
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      apiKey: 'real-key', // pragma: allowlist secret
      extraHeaders: {
        'Content-Type': 'text/plain',
        'X-ALTER-API-Key': 'spoofed-key', // pragma: allowlist secret
        'X-Custom': 'allowed',
      },
      fetch: makeFetch(
        () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 }),
        calls,
      ),
    });

    await client.initialize();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-ALTER-API-Key']).toBe('real-key');
    expect(headers['X-Custom']).toBe('allowed');
  });

  it('raises AlterToolError on JSON-RPC error', async () => {
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      fetch: makeFetch((call) => {
        const body = JSON.parse((call.init.body as string) ?? '{}');
        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'invalid params' } }),
          { status: 200 },
        );
      }),
    });
    await expect(client.callTool('verify_identity', { member_id: 'x' })).rejects.toBeInstanceOf(AlterToolError);
  });

  it('raises AlterAuthError on HTTP 401', async () => {
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      maxRetries: 0,
      fetch: makeFetch(() => new Response('', { status: 401 })),
    });
    await expect(client.initialize()).rejects.toBeInstanceOf(AlterAuthError);
  });

  it('raises AlterRateLimited after retries on HTTP 429', async () => {
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      maxRetries: 0,
      fetch: makeFetch(() => new Response('', { status: 429, headers: { 'Retry-After': '1' } })),
    });
    await expect(client.initialize()).rejects.toBeInstanceOf(AlterRateLimited);
  });

  it('raises AlterPaymentRequired on HTTP 402 when no x402 client', async () => {
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      fetch: makeFetch((call) => {
        const body = JSON.parse((call.init.body as string) ?? '{}');
        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            scheme: 'x402',
            network: 'base',
            asset: 'USDC',
            amount: '0.005',
            recipient: '0xabc',
            resource: 'assess_traits',
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    });
    await expect(client.callTool('assess_traits', { text: 'hi' })).rejects.toBeInstanceOf(AlterPaymentRequired);
  });

  it('settles 402 + retries when x402 signer is provided', async () => {
    let phase: 'init' | 'first' | 'retry' = 'init';
    const calls: RecordedCall[] = [];
    const signer: X402Signer = {
      async settle(env) {
        return { reference: '0xdeadbeef', network: env.network, amount: env.amount, asset: env.asset };
      },
    };
    const client = new MCPClient({
      endpoint: 'https://mcp.example.test',
      x402: new X402Client({ signer }),
      fetch: makeFetch((call) => {
        const body = JSON.parse((call.init.body as string) ?? '{}');
        if (body.method === 'initialize') {
          phase = 'first';
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { status: 200 });
        }
        if (phase === 'first') {
          phase = 'retry';
          return new Response(
            JSON.stringify({
              scheme: 'x402',
              network: 'base',
              asset: 'USDC',
              amount: '0.005',
              recipient: '0xabc',
              resource: 'assess_traits',
            }),
            { status: 402, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // retry call
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: '{"ok":true}' }] },
          }),
          { status: 200 },
        );
      }, calls),
    });

    const result = await client.callTool('assess_traits', { text: 'hi' });
    expect((result.data as { ok: boolean }).ok).toBe(true);
    // initialize + first attempt + retry = 3 calls
    expect(calls.length).toBe(3);
    const retryBody = JSON.parse(calls[2].init.body as string);
    expect(retryBody.params.arguments._payment.reference).toBe('0xdeadbeef');
  });
});
