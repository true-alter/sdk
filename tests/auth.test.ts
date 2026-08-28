import { describe, expect, it } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  decodeDid,
  encodeDid,
  generateKeypair,
  keypairFromPrivateKey,
  sign,
  verify,
} from '../src/auth.js';

describe('auth / Ed25519', () => {
  it('generates a 32-byte keypair with valid did encoding', () => {
    const kp = generateKeypair();
    expect(kp.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.did.startsWith('ed25519:')).toBe(true);
  });

  it('round-trips a private key through keypairFromPrivateKey', () => {
    const kp = generateKeypair();
    const restored = keypairFromPrivateKey(kp.privateKey);
    expect(restored.publicKey).toBe(kp.publicKey);
    expect(restored.did).toBe(kp.did);
  });

  it('signs and verifies a message', async () => {
    const kp = generateKeypair();
    const sig = await sign(kp.privateKey, 'hello alter');
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(await verify(kp.publicKey, sig, 'hello alter')).toBe(true);
    expect(await verify(kp.publicKey, sig, 'tampered')).toBe(false);
  });

  it('decodeDid round-trips encodeDid', () => {
    const kp = generateKeypair();
    const decoded = decodeDid(kp.did);
    expect(encodeDid(decoded)).toBe(kp.did);
  });

  it('base64url helpers are reversible', () => {
    const data = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = base64urlEncode(data);
    expect(enc).not.toMatch(/[+/=]/);
    expect(Array.from(base64urlDecode(enc))).toEqual(Array.from(data));
  });
});
