import { describe, expect, it } from 'vitest';
import {
  AlterAuthError,
  AlterError,
  AlterNetworkError,
  AlterPaymentRequired,
  AlterRateLimited,
  AlterToolError,
} from '../src/errors.js';

describe('error hierarchy', () => {
  it('every subclass extends AlterError', () => {
    const cases = [
      new AlterNetworkError('boom'),
      new AlterAuthError('nope', 401),
      new AlterRateLimited('slow down', 30),
      new AlterToolError('verify_identity', 'oops', -32602),
      new AlterPaymentRequired('assess_traits', {
        scheme: 'x402',
        network: 'base',
        asset: 'USDC',
        amount: '0.005',
        recipient: '0x0',
        resource: 'assess_traits',
      }),
    ];
    for (const e of cases) {
      expect(e).toBeInstanceOf(AlterError);
      expect(e).toBeInstanceOf(Error);
      expect(typeof e.code).toBe('string');
    }
  });

  it('AlterPaymentRequired carries the envelope', () => {
    const err = new AlterPaymentRequired('compute_belonging', {
      scheme: 'x402',
      network: 'base',
      asset: 'USDC',
      amount: '0.05',
      recipient: '0xabc',
      resource: 'compute_belonging',
    });
    expect(err.code).toBe('PAYMENT_REQUIRED');
    expect(err.envelope.amount).toBe('0.05');
    expect(err.tool).toBe('compute_belonging');
  });

  it('AlterRateLimited surfaces retryAfter', () => {
    const err = new AlterRateLimited('429', 42);
    expect(err.retryAfter).toBe(42);
  });

  it('AlterAuthError surfaces status', () => {
    expect(new AlterAuthError('x', 403).status).toBe(403);
  });
});
