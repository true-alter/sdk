/**
 * Ed25519 keypair management for ALTER Identity.
 *
 * Uses @noble/ed25519, pure JavaScript, no native addons, runs in
 * Node 18+, Deno, Bun, Cloudflare Workers and the browser.
 *
 * Keys are stored as hex strings for portability. The CLI persists them
 * to `~/.config/alter/keys.json` (Node-only); other environments must
 * supply their own storage.
 */

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

// @noble/ed25519 v2 requires SHA-512 to be wired in at module load time.
// This is the canonical setup used by every consumer of the library.
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

export interface Ed25519Keypair {
  /** 32-byte private key as hex. */
  privateKey: string;
  /** 32-byte public key as hex. */
  publicKey: string;
  /** `ed25519:<base64url-public-key>` form used in `.well-known/alter.json`. */
  did: string;
}

export interface ApiKeyConfig {
  /** Opaque API key issued by ALTER. Begins with `ak_`. */
  key: string;
  /** Optional `~handle` the key is bound to. */
  handle?: string;
}

/**
 * Generate a fresh Ed25519 keypair.
 *
 * The private key never leaves the SDK process unless the caller chooses
 * to persist it. Callers are responsible for safe storage.
 */
export function generateKeypair(): Ed25519Keypair {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
    did: encodeDid(publicKey),
  };
}

/**
 * Reconstruct the keypair from a stored private key (hex).
 */
export function keypairFromPrivateKey(privateKeyHex: string): Ed25519Keypair {
  const privateKey = hexToBytes(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(`Ed25519 private key must be 32 bytes, got ${privateKey.length}`);
  }
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey: privateKeyHex,
    publicKey: bytesToHex(publicKey),
    did: encodeDid(publicKey),
  };
}

/**
 * Sign an arbitrary message with an Ed25519 private key.
 * Returns the signature as hex.
 */
export async function sign(privateKeyHex: string, message: Uint8Array | string): Promise<string> {
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const privateKey = hexToBytes(privateKeyHex);
  const sig = await ed25519.signAsync(msgBytes, privateKey);
  return bytesToHex(sig);
}

/**
 * Verify an Ed25519 signature.
 */
export async function verify(
  publicKeyHex: string,
  signatureHex: string,
  message: Uint8Array | string,
): Promise<boolean> {
  try {
    const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
    return await ed25519.verifyAsync(hexToBytes(signatureHex), msgBytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/**
 * Encode a 32-byte public key as the `ed25519:<base64url>` form used by
 * ALTER's `.well-known/alter.json` discovery anchor.
 */
export function encodeDid(publicKey: Uint8Array | string): string {
  const bytes = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey;
  return `ed25519:${base64urlEncode(bytes)}`;
}

/**
 * Decode a `did:key` style identifier or the ALTER `ed25519:` form back
 * into raw bytes. Throws if the encoding is unrecognised.
 */
export function decodeDid(did: string): Uint8Array {
  const ed25519Match = did.match(/^ed25519:(.+)$/);
  if (ed25519Match) return base64urlDecode(ed25519Match[1]);
  throw new Error(`Unrecognised DID encoding: ${did}`);
}

// ── Base64URL helpers (no padding, RFC 4648 §5) ──────────────────────────

export function base64urlEncode(bytes: Uint8Array): string {
  // Use Buffer where available for speed, fall back to btoa for browsers
  // and Cloudflare Workers.
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64');
  } else {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
