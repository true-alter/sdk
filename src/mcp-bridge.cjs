// ALTER-ARCHIVED: superseded-by=bin/mcp-bridge.ts | date=2026-06-11 | status=retained-not-deleted | note=dead-at-runtime; CLI findBridge resolves dist/bin/mcp-bridge.js; runtime env-signing lives in bin/mcp-bridge.ts

#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');

const DEFAULT_ENDPOINT = 'https://api.truealter.com/api/v1/mcp';
const BRIDGE_VERSION = '0.4.0';

const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const SESSION_FILE = process.env.ALTER_SESSION_FILE || path.join(xdgConfig, 'alter', 'session.json');
// CF_ENV_FILE is a legacy opt-in for operators who override ALTER_PUBLIC_MCP_ENDPOINT
// to a Cloudflare Access-gated custom endpoint. The default endpoint (api.truealter.com)
// is bearer-first and requires no CF service token.
const CF_ENV_FILE = process.env.ALTER_CF_ACCESS_ENV || path.join(xdgConfig, 'alter', 'cf-access.env');
const ENDPOINT = process.env.ALTER_PUBLIC_MCP_ENDPOINT || DEFAULT_ENDPOINT;

function readSession() {
  try {
    let raw = fs.readFileSync(SESSION_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch { return {}; }
}

function readCfAccess() {
  try {
    const raw = fs.readFileSync(CF_ENV_FILE, 'utf8');
    // Match the CF Access service-token vars with an optional policy-scoped
    // prefix (`CF_ACCESS_<PREFIX>_CLIENT_ID`). The prefix is matched
    // generically rather than naming any internal CF Access policy.
    const idMatch = raw.match(/CF_ACCESS_(?:[A-Z0-9_]+_)?CLIENT_ID=['"](.*?)['"]/);
    const secretMatch = raw.match(/CF_ACCESS_(?:[A-Z0-9_]+_)?CLIENT_SECRET=['"](.*?)['"]/);
    return { id: idMatch?.[1] || '', secret: secretMatch?.[1] || '' };
  } catch { return { id: '', secret: '' }; }
}

function versionHash() {
  return 'sha256:' + crypto.createHash('sha256').update(`@truealter/sdk-bridge@${BRIDGE_VERSION}`).digest('hex').slice(0, 32);
}

// --- ES256 per-invocation signing -------------------------------------------
// The server requires every authenticated `tools/call` to carry an
// `Mcp-Invocation-Signature` header: a compact ES256 JWS over the invocation
// envelope, signed by a key whose public half is registered server-side. This
// is keyed off the member API key + signing key: NOT the access JWT: so a
// returning member keeps working until the API key itself expires, even after
// the short-lived access/refresh tokens lapse. Envelope contract mirrors
// ~Alter's server-side per-invocation signature verifier and src/signing.ts
// exactly.

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Canonical JSON matching Python json.dumps(sort_keys=True,
// separators=(',',':'), ensure_ascii=False). Stable key order + minimal
// whitespace; JS JSON.stringify already preserves non-ASCII verbatim.
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
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
function loadSigningKey(session) {
  // Priority 1: inline env PEM (CLI launcher injects this).
  const envPem = process.env.ALTER_SIGNING_KEY;
  if (envPem) {
    // Kid resolves from ALTER_SIGNING_KID first so the env path works even
    // when session.json is unreadable (stripped-env spawn by a launcher).
    const envKid = process.env.ALTER_SIGNING_KID || session.signing_kid;
    if (envKid) {
      try {
        const key = crypto.createPrivateKey(envPem);
        return { kid: envKid, key };
      } catch (e) {
        process.stderr.write(`bridge: ALTER_SIGNING_KEY parse error: ${e.message}\n`);
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
  const candidates = [];
  if (process.env.ALTER_SIGNING_KEY_FILE) candidates.push(process.env.ALTER_SIGNING_KEY_FILE);
  candidates.push(path.join(xdgConfig, 'alter', 'signing-keys', `${kid}.pem`));
  candidates.push(path.join(xdgConfig, 'alter', 'signing-key.pem'));
  for (const p of candidates) {
    try {
      const pem = fs.readFileSync(p, 'utf8');
      return { kid, key: crypto.createPrivateKey(pem) };
    } catch { /* try next */ }
  }
  return null;
}

function signInvocation(signer, toolName, toolArgs, handle) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: signer.kid })));
  const claims = {
    tool: toolName,
    args_sha256: crypto.createHash('sha256').update(canonicalJson(toolArgs || {}), 'utf8').digest('hex'),
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

function proxyRequest(body, msg) {
  return new Promise((resolve, reject) => {
    const session = readSession();
    const cfAccess = readCfAccess();
    const apiKey = process.env.ALTER_API_KEY || session.member_api_key || '';
    const url = new URL(ENDPOINT);
    const transport = url.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'X-Agent-Version-Hash': versionHash(),
    };
    if (apiKey) headers['X-ALTER-API-Key'] = apiKey;
    if (cfAccess.id) headers['CF-Access-Client-Id'] = cfAccess.id;
    if (cfAccess.secret) headers['CF-Access-Client-Secret'] = cfAccess.secret;

    // Sign authenticated tool invocations. Public/anonymous reads and the
    // non-tool methods (initialize, tools/list, notifications) need no
    // signature, so we only sign `tools/call`.
    if (apiKey && msg && msg.method === 'tools/call' && msg.params && msg.params.name) {
      const signer = loadSigningKey(session);
      if (signer) {
        try {
          headers['Mcp-Invocation-Signature'] = signInvocation(
            signer, msg.params.name, msg.params.arguments || {}, session.handle || '',
          );
        } catch (e) {
          process.stderr.write(`bridge sign error: ${e.message}\n`);
        }
      } else {
        process.stderr.write(`bridge: no signing key for kid ${session.signing_kid || '(unset)'}: run 'alter login' to provision one\n`);
      }
    }

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { continue; }
    try {
      const response = await proxyRequest(trimmed, msg);
      process.stdout.write(response + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message: err.message } }) + '\n');
    }
  }
}

main().catch((err) => { process.stderr.write(`bridge fatal: ${err.message}\n`); process.exit(1); });
