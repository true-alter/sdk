import { describe, expect, it } from 'vitest';
import { parsePaymentHeader, X402Client, type X402Signer } from '../src/x402.js';
import { AlterError, AlterPaymentRequired } from '../src/errors.js';

const baseEnvelope = {
  scheme: 'x402' as const,
  network: 'base',
  asset: 'USDC',
  amount: '0.005',
  recipient: '0xabc',
  resource: 'assess_traits',
};

describe('X402Client policy', () => {
  it('rejects networks outside the allow-list', async () => {
    const c = new X402Client({ networks: ['base-sepolia'] });
    await expect(c.authorise(baseEnvelope)).rejects.toBeInstanceOf(AlterError);
  });

  it('rejects assets outside the allow-list', async () => {
    const c = new X402Client({ assets: ['DAI'] });
    await expect(c.authorise(baseEnvelope)).rejects.toBeInstanceOf(AlterError);
  });

  it('enforces maxPerQuery cap', async () => {
    const c = new X402Client({ maxPerQuery: '0.001' });
    await expect(c.authorise(baseEnvelope)).rejects.toThrow(/exceeds maxPerQuery/);
  });

  it('throws AlterPaymentRequired when no signer is configured', async () => {
    const c = new X402Client({});
    await expect(c.authorise(baseEnvelope)).rejects.toBeInstanceOf(AlterPaymentRequired);
  });

  it('settles via signer when allowed', async () => {
    const signer: X402Signer = {
      async settle(env) {
        return { reference: '0xfeed', network: env.network, amount: env.amount, asset: env.asset };
      },
    };
    const c = new X402Client({ signer, maxPerQuery: '0.50' });
    const settlement = await c.authorise(baseEnvelope);
    expect(settlement.reference).toBe('0xfeed');
    const arg = X402Client.buildPaymentArg(settlement);
    expect(arg.scheme).toBe('x402');
    expect(arg.reference).toBe('0xfeed');
  });
});

describe('parsePaymentHeader', () => {
  it('parses JSON header values', () => {
    const env = parsePaymentHeader(JSON.stringify(baseEnvelope));
    expect(env?.amount).toBe('0.005');
  });

  it('parses key=value header values', () => {
    const env = parsePaymentHeader('scheme=x402; network=base; asset=USDC; amount=0.005; recipient=0xabc');
    expect(env?.network).toBe('base');
    expect(env?.amount).toBe('0.005');
  });

  it('returns null when nothing is parseable', () => {
    expect(parsePaymentHeader('garbage')).toBeNull();
  });
});
