#!/usr/bin/env node
// ALTER-ARCHIVED: superseded-by=bin/mcp-bridge.ts | date=2026-06-11 | status=retained-not-deleted | note=dead-at-runtime; CLI findBridge resolves dist/bin/mcp-bridge.js; runtime env-signing lives in bin/mcp-bridge.ts
/**
 * ~Alter MCP stdio bridge: translates stdio JSON-RPC to the ~Alter HTTP
 * MCP endpoint with full auth header injection.
 *
 * Reads credentials from the canonical ~Alter config paths:
 *   - ~/.config/alter/session.json  -> member_api_key, jwt
 *   - ~/.config/alter/cf-access.env -> CF Access service token (pre-public)
 *
 * Designed to be spawned by Claude Code (or any stdio-expecting MCP
 * host) as: `node dist/mcp-bridge.js`
 *
 * Environment overrides:
 *   ALTER_PUBLIC_MCP_ENDPOINT : override the upstream endpoint
 *   ALTER_SESSION_FILE        : override session.json path
 *   ALTER_CF_ACCESS_ENV       : override cf-access.env path
 *   ALTER_API_KEY             : override the API key (skips session read)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as readline from 'node:readline';

// Member runtime path: the bridge is spawned only for authenticated members.
// Bearer-first: no CF Access service token required. Never defaults to the
// CF-Access-gated host (mcp.truealter.com).
const DEFAULT_ENDPOINT = 'https://api.truealter.com/api/v1/mcp';
const BRIDGE_VERSION = '0.4.0';

const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
const SESSION_FILE = process.env.ALTER_SESSION_FILE ?? path.join(xdgConfig, 'alter', 'session.json');
const CF_ENV_FILE = process.env.ALTER_CF_ACCESS_ENV ?? path.join(xdgConfig, 'alter', 'cf-access.env');
const ENDPOINT = process.env.ALTER_PUBLIC_MCP_ENDPOINT ?? DEFAULT_ENDPOINT;

interface Session {
  jwt?: string;
  member_api_key?: string;
  signing_kid?: string;
  handle?: string;
}

function readSession(): Session {
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(clean);
  } catch {
    return {};
  }
}

function readCfAccess(): { id: string; secret: string } {
  try {
    const raw = fs.readFileSync(CF_ENV_FILE, 'utf8');
    // Match the CF Access service-token vars with an optional policy-scoped
    // prefix (`CF_ACCESS_<PREFIX>_CLIENT_ID`). The prefix is matched
    // generically rather than naming any internal CF Access policy.
    const idMatch = raw.match(/CF_ACCESS_(?:[A-Z0-9_]+_)?CLIENT_ID=['"](.*?)['"]/);
    const secretMatch = raw.match(/CF_ACCESS_(?:[A-Z0-9_]+_)?CLIENT_SECRET=['"](.*?)['"]/);
    return {
      id: idMatch?.[1] ?? '',
      secret: secretMatch?.[1] ?? '',
    };
  } catch {
    return { id: '', secret: '' };
  }
}

function versionHash(): string {
  const digest = crypto
    .createHash('sha256')
    .update(`@truealter/sdk-bridge@${BRIDGE_VERSION}`)
    .digest('hex')
    .slice(0, 32);
  return `sha256:${digest}`;
}

// --- ES256 per-invocation signing -------------------------------------------
// The server requires every authenticated `tools/call` to carry an
// `Mcp-Invocation-Signature` header: a compact ES256 JWS over the invocation
// envelope, signed by a key whose public half is registered server-side. It
// is keyed off the member API key + signing key: NOT the access JWT: so a
// returning member keeps working until the API key itself expires, even after
// the short-lived access/refresh tokens lapse. The envelope contract mirrors
// ~Alter's server-side per-invocation signature verifier and src/signing.ts
// exactly.

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Canonical JSON matching Python json.dumps(sort_keys=True,
// separators=(',',':'), ensure_ascii=False): stable key order, minimal
// whitespace, non-ASCII preserved verbatim (JSON.stringify already does).
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

interface Signer {
  kid: string;
  key: crypto.KeyObject;
}

// Resolve the signing private key.
//
// Priority (highest first):
//   1. ALTER_SIGNING_KEY env var: inline PEM injected by the CLI launcher
//      via the child process environment; kid from ALTER_SIGNING_KID (falls
//      back to session.signing_kid). This path works even when session.json
//      is absent (stripped-env spawns). The PEM is never written to disk.
//   2. ALTER_SIGNING_KEY_FILE: explicit PEM file path override.
//   3. Per-kid PEM file:  ~/.config/alter/signing-keys/<kid>.pem
//   4. Legacy default:    ~/.config/alter/signing-key.pem
//
// Returns null only when no source resolves a usable key.
function loadSigningKey(session: Session): Signer | null {
  // Priority 1: inline env PEM (CLI launcher injects this).
  const envPem = process.env.ALTER_SIGNING_KEY;
  if (envPem) {
    // Kid resolves from ALTER_SIGNING_KID first so the env path works even
    // when session.json is unreadable (stripped-env spawn by a launcher).
    const envKid = process.env.ALTER_SIGNING_KID ?? session.signing_kid;
    if (envKid) {
      try {
        const key = crypto.createPrivateKey(envPem);
        return { kid: envKid, key };
      } catch (e) {
        process.stderr.write(`bridge: ALTER_SIGNING_KEY parse error: ${(e as Error).message}\n`);
        // Fall through to file-based sources.
      }
    }
    // ALTER_SIGNING_KEY is set but no kid is resolvable from either source.
    // Fall through; file-based fallbacks below may still succeed if
    // session.json is readable.
  }

  // Priority 2-4: file-based fallbacks.
  const kid = session.signing_kid;
  if (!kid) return null;
  const candidates: string[] = [];
  if (process.env.ALTER_SIGNING_KEY_FILE) candidates.push(process.env.ALTER_SIGNING_KEY_FILE);
  candidates.push(path.join(xdgConfig, 'alter', 'signing-keys', `${kid}.pem`));
  candidates.push(path.join(xdgConfig, 'alter', 'signing-key.pem'));
  for (const p of candidates) {
    try {
      const pem = fs.readFileSync(p, 'utf8');
      return { kid, key: crypto.createPrivateKey(pem) };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function signInvocation(
  signer: Signer,
  toolName: string,
  toolArgs: Record<string, unknown>,
  handle: string,
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: signer.kid })));
  const claims = {
    tool: toolName,
    args_sha256: crypto.createHash('sha256').update(canonicalJson(toolArgs ?? {}), 'utf8').digest('hex'),
    nonce: b64url(crypto.randomBytes(24)),
    iat: Math.floor(Date.now() / 1000),
    iss: handle,
  };
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  // ES256 over P-256: emit the raw 64-byte (r||s) JWS form, not DER.
  const sig = crypto.createSign('SHA256').update(signingInput).sign({ key: signer.key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

interface RpcMessage {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function proxyRequest(body: string, msg: RpcMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const session = readSession();
    const cfAccess = readCfAccess();
    const apiKey = process.env.ALTER_API_KEY ?? session.member_api_key ?? '';

    const url = new URL(ENDPOINT);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'X-Agent-Version-Hash': versionHash(),
    };

    if (apiKey) headers['X-ALTER-API-Key'] = apiKey;
    if (cfAccess.id) headers['CF-Access-Client-Id'] = cfAccess.id;
    if (cfAccess.secret) headers['CF-Access-Client-Secret'] = cfAccess.secret;

    // Sign authenticated tool invocations only. The non-tool methods
    // (initialize, tools/list, notifications) and anonymous L0 reads need
    // no signature.
    if (apiKey && msg.method === 'tools/call' && msg.params?.name) {
      const signer = loadSigningKey(session);
      if (signer) {
        try {
          headers['Mcp-Invocation-Signature'] = signInvocation(
            signer,
            msg.params.name,
            msg.params.arguments ?? {},
            session.handle ?? '',
          );
        } catch (e) {
          process.stderr.write(`bridge sign error: ${(e as Error).message}\n`);
        }
      } else {
        process.stderr.write(
          `bridge: no signing key for kid ${session.signing_kid ?? '(unset)'}: run 'alter login' to provision one\n`,
        );
      }
    }

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve(data));
      },
    );

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: RpcMessage;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }

    try {
      const response = await proxyRequest(trimmed, msg);
      process.stdout.write(response + '\n');
    } catch (err) {
      const errResponse = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        error: { code: -32000, message: (err as Error).message },
      });
      process.stdout.write(errResponse + '\n');
    }
  }
}

main().catch((err) => {
  process.stderr.write(`bridge fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
