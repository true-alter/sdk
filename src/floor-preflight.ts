/**
 * floor-preflight: SDK-side client version-floor enforcement.
 *
 * Sister to the CLI client's own floor-preflight. This is
 * the `@truealter/sdk` implementation: it fires lazily on the first
 * authenticated network call from {@link AlterClient}, hits the public
 * floor endpoint, verifies the Ed25519 signature against the published
 * `key_id`, and throws {@link BelowFloorError} when the SDK's own
 * version is below the published floor for `alter-identity`.
 *
 * Canonical envelope (§4) is preserved on the thrown error so consumers
 * can introspect the upgrade path:
 *
 *   - `client_version`
 *   - `min_version`
 *   - `upgrade_cmd`
 *   - `channel`
 *   - `message`
 *
 * The server-side gate is the authoritative reject.
 * This SDK-side preflight is UX polish: third-party integrators see a
 * clean typed error before the network call, not an opaque HTTP 426
 * wall on every subsequent request.
 *
 * Ed25519 signature verification (§A3 + §A18): the server signs the floor
 * document with a floor-only Ed25519 private key. The SDK ships only the
 * corresponding public key (SPKI PEM) in {@link KNOWN_FLOOR_PUBLIC_KEYS},
 * keyed by `key_id`. No signing secret ships in the client: this is
 * asymmetric: the public key cannot forge signatures. MUST stay
 * byte-compatible with the ~Alter backend floor-signing implementation
 * and the canonical TypeScript CLI client:
 *   - Algorithm: Ed25519 (RFC 8032). Deterministic: same key + payload
 *     always yields the same signature.
 *   - `key_id`  = first 8 hex chars of SHA-256(raw 32-byte public key).
 *   - Payload   = `canonicalJson({floors, served_at})`: sorted keys at
 *                 every depth, compact separators, raw UTF-8 (the backend's
 *                 `ensure_ascii=False` parity is REQUIRED).
 *                 `cache_ttl_seconds`, `signature`, `key_id` are excluded
 *                 from the signed bytes.
 *   - `signature` = hex-encoded 64-byte Ed25519 signature (128 hex chars).
 *
 * Connectivity ladder (§8 + §9):
 *   - In-memory cache fresh (≤ server-advised TTL, clamped [60s, 24h]):
 *     trust the cached floor; no refetch.
 *   - Disk cache ≤24h: trust; permit operation.
 *   - Disk cache 24h-7d: permit with warn.
 *   - Disk cache >7d + backend unreachable: permit with warn.
 *   - Below-floor + backend unreachable: BLOCK. The only intentional
 *     offline lockout: the user had time to upgrade and didn't.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { SDK_NAME, SDK_VERSION } from './meta.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_VERSION_ENDPOINT = '/v1/clients/min-version';

/** Client-id surface for the SDK: matches the floor doc's `alter-identity` key. */
export const CLIENT_ID = 'alter-identity';

/** Channel: SDK installs are always via npm. */
export const CLIENT_CHANNEL = 'npm';

const IN_MEMORY_TTL_DEFAULT_MS = 60 * 60 * 1000; // 1h
const IN_MEMORY_TTL_MIN_MS = 60 * 1000; // 60s
const IN_MEMORY_TTL_MAX_MS = 24 * 60 * 60 * 1000; // 24h

const DISK_FRESH_MS = 24 * 60 * 60 * 1000; // 24h
const DISK_WARN_MS = 7 * 24 * 60 * 60 * 1000; // 7d

const FETCH_TIMEOUT_MS = 4000;

/**
 * Compute the 8-char `key_id` for an Ed25519 public key (SPKI PEM).
 *
 * Matches the backend `key_id_for_public_key(pub)` in the ~Alter
 * backend floor-signing implementation:
 *   raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)  # 32 bytes
 *   sha256(raw).hexdigest()[:8]
 *
 * Node equivalent: import PEM -> export JWK -> decode `.x` (base64url) -> 32-byte
 * raw public key -> SHA-256 -> first 8 hex chars.
 *
 * Returns `"00000000"` for empty input (a sentinel, matching the
 * server-side implementation).
 */
export function computeKeyId(publicKeyPem: string): string {
  if (!publicKeyPem) return '00000000';
  const pub = createPublicKey({ key: publicKeyPem, format: 'pem' });
  const jwk = pub.export({ format: 'jwk' }) as { x: string };
  const rawBytes = Buffer.from(jwk.x, 'base64url');
  return createHash('sha256').update(rawBytes).digest('hex').slice(0, 8);
}

/**
 * Canonical JSON encoding matching Python's
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
 * Object keys are sorted lexicographically AT EVERY DEPTH; whitespace is
 * stripped via the `,`/`:` separators; non-ASCII passes through as raw UTF-8
 * (Node's `JSON.stringify` never `\uXXXX`-escapes non-ASCII, matching the
 * backend's `ensure_ascii=False`). The result is the byte-exact input to
 * Ed25519 signing (backend) and verification (this SDK and the CLI client) on
 * both sides.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeysDeep(obj[k]);
    }
    return sorted;
  }
  return value;
}

/**
 * Known Ed25519 public keys (SPKI PEM) keyed by `key_id`.
 *
 * `key_id` = first 8 hex chars of SHA-256(raw 32-byte Ed25519 public key).
 * Use `computeKeyId(spkiPem)` to re-derive and validate the map key.
 *
 * Backend may rotate via a dual-key path: clients keep N keys and
 * select via `key_id`. Add new keys additively; remove old keys only after
 * all deployed clients have received the new key.
 *
 * Current keys (mirrors `KNOWN_FLOOR_PUBLIC_KEYS` in the canonical
 * CLI client):
 *   8aa59e05: dev/non-prod key (local + e2e + staging). Safe to ship publicly;
 *              this is the PUBLIC key only, never the private key.
 *   640f7d9a: prod key. Added 2026-06-05. key_id = first 8 hex of
 *              SHA-256(raw 32-byte Ed25519 pubkey), verified against the live
 *              /api/v1/clients/min-version response on 2026-06-05. The prod
 *              private key is a deliberately-minted Fly-secret keypair; only
 *              the public half is shipped here.
 *
 * Consumers can override via {@link CheckMinVersionOptions.knownFloorPublicKeys}
 * for tests or staging environments with a non-default keypair.
 */
export const KNOWN_FLOOR_PUBLIC_KEYS: Record<string, string> = {
  '8aa59e05': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgqw28dlniOuiTE1f4BxCPSEgMLaPtHsO8wN5RWEwEhE=
-----END PUBLIC KEY-----`,
  '640f7d9a': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARzvAWayDwHvZRfOZizGZe+/a7PF082WGhyMS3tx06H4=
-----END PUBLIC KEY-----`,
};

// ---------------------------------------------------------------------------
// Canonical envelope (§4)
// ---------------------------------------------------------------------------

/**
 * The canonical `client_below_floor` envelope shape. Identical across
 * HTTP 426, MCP `tools/call` error, WebSocket close-4426 reason, and the
 * CLI stdout JSON path. `BelowFloorError` preserves every field as
 * an enumerable property so consumers can introspect without parsing the
 * `cause` chain.
 */
export interface ClientBelowFloorEnvelope {
  error: {
    code: 'client_below_floor';
    message: string;
    client_version: string;
    min_version: string;
    upgrade_cmd: string;
    channel: string;
  };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChannelFloor {
  min_version: string;
  upgrade_cmd: string;
}

export interface FloorDocument {
  floors: Record<string, ChannelFloor | Record<string, ChannelFloor>>;
  served_at: string;
  cache_ttl_seconds: number;
  signature: string;
  key_id: string;
}

export interface CheckMinVersionOptions {
  /** API base. Defaults to `ALTER_API` env var, else `https://api.truealter.com`. */
  apiBase?: string;
  /** Override the SDK's own version (tests). */
  clientVersion?: string;
  /** Override the client-id surface (tests). */
  clientId?: string;
  /** Override the channel (tests). */
  channel?: string;
  /**
   * Override the `key_id -> SPKI-PEM` Ed25519 public-key map consulted
   * when verifying the floor document's signature. Defaults to
   * {@link KNOWN_FLOOR_PUBLIC_KEYS}.
   */
  knownFloorPublicKeys?: Record<string, string>;
  /** Override fetch: defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Disk cache path override (tests). Set `null` to disable disk cache. */
  diskCachePath?: string | null;
  /** Internal: clock injection for tests. */
  now?: () => number;
}

/**
 * Outcome of a preflight check. Use `BelowFloorError` instead of
 * inspecting this manually: `checkMinVersion()` throws on below-floor.
 */
export interface PreflightResult {
  ok: true;
  /** Resolved floor for `(client_id, channel)`, when one exists. */
  floor: ChannelFloor | null;
  /** Warning emitted when cache is stale or fetch failed. */
  warn?: string;
  /** Diagnostic tag: which branch of the ladder fired. */
  diagnostic: string;
}

// ---------------------------------------------------------------------------
// BelowFloorError
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link checkMinVersion} (and consequently by every
 * `AlterClient` method, on first request) when the running SDK version
 * is below the published floor for `alter-identity`.
 *
 * The canonical envelope shape is preserved as enumerable properties so
 * consumers can branch on the upgrade command without re-parsing the
 * server response:
 *
 * ```ts
 * try {
 *   await client.helloAgent();
 * } catch (err) {
 *   if (err instanceof BelowFloorError) {
 *     console.error(`upgrade required: ${err.upgrade_cmd}`);
 *     process.exit(1);
 *   }
 *   throw err;
 * }
 * ```
 *
 * The server-side gate is the authoritative reject: even if a consumer
 * catches and swallows this error, the next backend request will still
 * receive HTTP 426 from the floor middleware.
 */
export class BelowFloorError extends Error {
  public readonly name = 'BelowFloorError';
  public readonly code = 'client_below_floor' as const;
  public readonly client_version: string;
  public readonly min_version: string;
  public readonly upgrade_cmd: string;
  public readonly channel: string;
  public readonly envelope: ClientBelowFloorEnvelope;

  constructor(envelope: ClientBelowFloorEnvelope) {
    super(envelope.error.message);
    this.envelope = envelope;
    this.client_version = envelope.error.client_version;
    this.min_version = envelope.error.min_version;
    this.upgrade_cmd = envelope.error.upgrade_cmd;
    this.channel = envelope.error.channel;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// In-memory cache (process-singleton)
// ---------------------------------------------------------------------------

interface MemEntry {
  doc: FloorDocument;
  fetched_at_ms: number;
  ttl_ms: number;
}

let memCache: MemEntry | null = null;

/** Test hook: reset the singleton between tests. */
export function _resetInMemoryCache(): void {
  memCache = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Preflight the floor endpoint and compare the SDK's version against
 * the published `min_version` for `alter-identity`. Throws
 * {@link BelowFloorError} on below-floor; resolves with a
 * {@link PreflightResult} otherwise.
 *
 * Cache behaviour:
 *   - In-memory cache is consulted first; hits avoid the network.
 *   - On a miss, the disk cache (`~/.config/alter/floor-cache.json`) is
 *     read. If it's <24h old it satisfies the request directly; older
 *     entries trigger a refetch.
 *   - On a successful fetch, both caches are populated.
 *   - On a fetch failure with a stale-but-present disk cache, the
 *     cached verdict bites (including blocking when below-floor: §9).
 *   - On a fetch failure with no cache at all, the call permits with a
 *     warn: the server-side gate catches below-floor regardless.
 */
export async function checkMinVersion(
  opts: CheckMinVersionOptions = {},
): Promise<PreflightResult> {
  const apiBase = opts.apiBase ?? defaultApiBase();
  const clientVersion = opts.clientVersion ?? SDK_VERSION;
  const clientId = opts.clientId ?? CLIENT_ID;
  const channel = opts.channel ?? CLIENT_CHANNEL;
  const knownKeys = opts.knownFloorPublicKeys ?? KNOWN_FLOOR_PUBLIC_KEYS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const cachePath =
    opts.diskCachePath === undefined ? defaultDiskCachePath() : opts.diskCachePath;

  // 1. In-memory cache.
  const mem = readInMemoryCache(now);
  if (mem) {
    return compareAndPermit(mem, {
      clientVersion,
      clientId,
      channel,
      diagnostic: 'mem-cache-hit',
    });
  }

  // 2. Disk cache.
  const disk = cachePath ? readDiskCache(cachePath, knownKeys) : null;
  const diskAgeMs = disk ? now() - disk.fetched_at_ms : Number.POSITIVE_INFINITY;

  // 3. Fetch if no in-memory cache and disk cache is stale (or absent).
  let fetched: FloorDocument | null = null;
  let fetchError: string | null = null;
  if (!disk || diskAgeMs > IN_MEMORY_TTL_DEFAULT_MS) {
    try {
      fetched = await fetchFloorDoc(apiBase, fetchImpl, knownKeys);
    } catch (err) {
      fetchError = (err as Error).message ?? 'fetch-error';
    }
  }

  if (fetched) {
    populateMemCache(fetched, now());
    if (cachePath) writeDiskCache(cachePath, fetched, now());
    return compareAndPermit(fetched, {
      clientVersion,
      clientId,
      channel,
      diagnostic: 'fetched',
    });
  }

  // 4. Fetch failed: fall back to disk cache if available.
  if (disk) {
    populateMemCache(disk.doc, disk.fetched_at_ms);
    if (diskAgeMs > DISK_WARN_MS) {
      // Cache >7d AND backend unreachable.
      // Below-floor -> BLOCK (§9 intentional offline lockout).
      // Above-floor -> permit with warn.
      return compareAndPermit(disk.doc, {
        clientVersion,
        clientId,
        channel,
        diagnostic: 'below-floor-offline-stale-or-permit',
        warn: `floor cache is >7d old and backend unreachable (${
          fetchError ?? 'no refresh attempted'
        }); permitting if above floor`,
      });
    }
    if (diskAgeMs > DISK_FRESH_MS) {
      return compareAndPermit(disk.doc, {
        clientVersion,
        clientId,
        channel,
        diagnostic: 'warn-stale-permit',
        warn: `floor cache is ${Math.round(diskAgeMs / (60 * 60 * 1000))}h old; refresh recommended`,
      });
    }
    return compareAndPermit(disk.doc, {
      clientVersion,
      clientId,
      channel,
      diagnostic: 'disk-cache-hit',
    });
  }

  // 5. No cache + fetch failed. Permit: the server-side gate is the
  // backstop. We don't lock out first-run consumers for transient
  // network blips.
  return {
    ok: true,
    floor: null,
    diagnostic: 'no-cache-no-fetch-permit',
    warn: `floor preflight skipped: backend unreachable (${fetchError ?? 'unknown'})`,
  };
}

interface CompareCtx {
  clientVersion: string;
  clientId: string;
  channel: string;
  diagnostic: string;
  warn?: string;
}

function compareAndPermit(doc: FloorDocument, ctx: CompareCtx): PreflightResult {
  const floor = lookupFloor(doc, ctx.clientId, ctx.channel);
  if (!floor) {
    return { ok: true, floor: null, diagnostic: `${ctx.diagnostic}+no-floor`, warn: ctx.warn };
  }
  if (compareSemver(ctx.clientVersion, floor.min_version) >= 0) {
    return { ok: true, floor, diagnostic: ctx.diagnostic, warn: ctx.warn };
  }
  const envelope: ClientBelowFloorEnvelope = {
    error: {
      code: 'client_below_floor',
      message: `Your ${ctx.clientId} is too old. Upgrade required.`,
      client_version: ctx.clientVersion,
      min_version: floor.min_version,
      upgrade_cmd: floor.upgrade_cmd,
      channel: ctx.channel,
    },
  };
  throw new BelowFloorError(envelope);
}

// ---------------------------------------------------------------------------
// Floor lookup + semver
// ---------------------------------------------------------------------------

function lookupFloor(
  doc: FloorDocument,
  clientId: string,
  channel: string,
): ChannelFloor | null {
  const entry = doc.floors[clientId];
  if (!entry) return null;
  if (isChannelFloor(entry)) return entry;
  const exact = entry[channel];
  if (exact) return exact;
  const fallback = entry['unknown'];
  if (fallback) return fallback;
  return null;
}

function isChannelFloor(
  v: ChannelFloor | Record<string, ChannelFloor>,
): v is ChannelFloor {
  return (
    typeof (v as ChannelFloor).min_version === 'string' &&
    typeof (v as ChannelFloor).upgrade_cmd === 'string'
  );
}

/**
 * Strict semver compare. Returns <0 if a<b, 0 if equal, >0 if a>b.
 * Pre-release tags sort before their release counterpart per semver.
 */
export function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPat, aPre] = parseSemver(a);
  const [bMaj, bMin, bPat, bPre] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  if (aPat !== bPat) return aPat - bPat;
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre.localeCompare(bPre);
  return 0;
}

function parseSemver(v: string): [number, number, number, string | null] {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
  if (!m) return [0, 0, 0, null];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null];
}

// ---------------------------------------------------------------------------
// Ed25519 signature verification (A3 + A18)
// ---------------------------------------------------------------------------

/**
 * Verify the floor document's Ed25519 signature. Returns true on valid sig,
 * false on invalid signature or unknown `key_id`. The signed payload is the
 * canonical JSON of `{ floors, served_at }`: `signature` + `key_id` +
 * `cache_ttl_seconds` are excluded from the signed bytes.
 *
 * MUST stay byte-compatible with the ~Alter backend floor-signing implementation:
 *   - Algorithm: Ed25519 (RFC 8032). Deterministic: same key + payload = same sig.
 *   - Payload: `canonicalJson({floors, served_at})`: sorted-keys + compact.
 *   - `key_id`: first 8 hex chars of SHA-256(raw 32-byte Ed25519 public key).
 *   - `signature`: hex-encoded 64-byte Ed25519 signature.
 *
 * The `keys` parameter maps `key_id -> SPKI PEM string`; defaults to
 * `KNOWN_FLOOR_PUBLIC_KEYS`. Returns false on unknown key_id (triggers refetch
 * per the key-rotation path).
 */
export function verifyFloorSignature(
  doc: FloorDocument,
  keys: Record<string, string> = KNOWN_FLOOR_PUBLIC_KEYS,
): boolean {
  const pem = keys[doc.key_id];
  if (!pem) return false;
  // Re-derive key_id from the PEM: defends against a mis-keyed map entry.
  if (computeKeyId(pem) !== doc.key_id) return false;
  try {
    const pubKeyObject = createPublicKey({ key: pem, format: 'pem' });
    const canonical = canonicalJson({
      floors: doc.floors,
      served_at: doc.served_at,
    });
    return cryptoVerify(
      null,
      Buffer.from(canonical, 'utf-8'),
      pubKeyObject,
      Buffer.from(doc.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchFloorDoc(
  apiBase: string,
  fetchImpl: typeof fetch,
  knownKeys: Record<string, string>,
): Promise<FloorDocument> {
  const url = `${apiBase.replace(/\/+$/, '')}${MIN_VERSION_ENDPOINT}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'X-Alter-Client-Id': CLIENT_ID,
        'X-Alter-Client-Version': SDK_VERSION,
        'X-Alter-Client-Channel': CLIENT_CHANNEL,
        'User-Agent': `${SDK_NAME}/${SDK_VERSION}`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`network: ${(err as Error).message ?? String(err)}`);
  }
  if (!response.ok) throw new Error(`http-${response.status}`);
  const body = (await response.json()) as FloorDocument;
  if (!body || !body.floors || !body.signature || !body.key_id) {
    throw new Error('malformed-floor-doc');
  }
  // Unknown key_id or invalid signature -> verify-fail -> thrown here as a
  // fetch error, which the caller treats as a cache miss (refetch on the
  // next invocation; the key-rotation path delivers new keys via an
  // SDK update). A missing or forged signature is never a pass.
  if (!verifyFloorSignature(body, knownKeys)) {
    throw new Error('signature-invalid');
  }
  return body;
}

// ---------------------------------------------------------------------------
// In-memory cache helpers
// ---------------------------------------------------------------------------

function readInMemoryCache(now: () => number): FloorDocument | null {
  if (!memCache) return null;
  if (now() - memCache.fetched_at_ms > memCache.ttl_ms) {
    memCache = null;
    return null;
  }
  return memCache.doc;
}

function populateMemCache(doc: FloorDocument, fetched_at_ms: number): void {
  const ttlSec = doc.cache_ttl_seconds ?? 3600;
  const ttlMs = Math.min(
    Math.max(ttlSec * 1000, IN_MEMORY_TTL_MIN_MS),
    IN_MEMORY_TTL_MAX_MS,
  );
  memCache = { doc, fetched_at_ms, ttl_ms: ttlMs };
}

// ---------------------------------------------------------------------------
// Disk cache (§8 + §A4 + §A22)
// ---------------------------------------------------------------------------

interface DiskCacheEntry {
  doc: FloorDocument;
  fetched_at_ms: number;
}

function defaultDiskCachePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdg, 'alter', 'floor-cache.json');
}

function readDiskCache(
  path: string,
  knownKeys: Record<string, string>,
): DiskCacheEntry | null {
  // POSIX ownership + mode-0600 check (A4).
  if (process.platform !== 'win32') {
    let st: { uid: number; mode: number };
    try {
      st = statSync(path);
    } catch {
      return null;
    }
    const euid =
      typeof process.geteuid === 'function' ? process.geteuid() : st.uid;
    if (st.uid !== euid) return null;
    if ((st.mode & 0o777) !== 0o600) return null;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  let parsed: DiskCacheEntry;
  try {
    parsed = JSON.parse(raw) as DiskCacheEntry;
  } catch {
    return null;
  }
  if (!parsed.doc || typeof parsed.fetched_at_ms !== 'number') return null;
  // Re-verify signature on read: an attacker who swaps the file (without
  // changing ownership) still has to forge an Ed25519 signature they hold
  // no private key for. A failed verify is a cache miss, never a pass.
  if (!verifyFloorSignature(parsed.doc, knownKeys)) {
    return null;
  }
  return parsed;
}

function writeDiskCache(path: string, doc: FloorDocument, now_ms: number): void {
  const entry: DiskCacheEntry = { doc, fetched_at_ms: now_ms };
  const payload = JSON.stringify(entry);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, payload, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Windows ignores mode bits: chmod may no-op.
    }
    renameSync(tmp, path);
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultApiBase(): string {
  return process.env.ALTER_API ?? 'https://api.truealter.com';
}
