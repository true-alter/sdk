/**
 * Typed error hierarchy for the ALTER Identity SDK.
 *
 * Every error thrown by the SDK is an instance of {@link AlterError}, with
 * a discriminated `code` field for programmatic handling. Network failures,
 * authentication problems, payment-required responses, rate limits, tool
 * execution failures, and provenance verification mismatches each get
 * their own subclass so consumers can `instanceof`-narrow.
 */

export type AlterErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTH'
  | 'PAYMENT_REQUIRED'
  | 'RATE_LIMITED'
  | 'TOOL_ERROR'
  | 'PROVENANCE'
  | 'DISCOVERY'
  | 'INVALID_RESPONSE'
  | 'UNSUPPORTED';

export class AlterError extends Error {
  public readonly code: AlterErrorCode;
  public readonly cause?: unknown;

  constructor(code: AlterErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AlterError';
    this.code = code;
    this.cause = cause;
    // Preserve the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterNetworkError extends AlterError {
  constructor(message: string, cause?: unknown) {
    super('NETWORK', message, cause);
    this.name = 'AlterNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterTimeoutError extends AlterError {
  constructor(message: string, cause?: unknown) {
    super('TIMEOUT', message, cause);
    this.name = 'AlterTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterAuthError extends AlterError {
  public readonly status: number;

  constructor(message: string, status: number = 401) {
    super('AUTH', message);
    this.name = 'AlterAuthError';
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown on HTTP 402. Carries the payment envelope returned by the server
 * so an x402 client can settle the transaction and retry.
 */
export class AlterPaymentRequired extends AlterError {
  public readonly envelope: PaymentEnvelope;
  public readonly tool: string;

  constructor(tool: string, envelope: PaymentEnvelope) {
    super('PAYMENT_REQUIRED', `x402 payment required for tool "${tool}"`);
    this.name = 'AlterPaymentRequired';
    this.tool = tool;
    this.envelope = envelope;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterRateLimited extends AlterError {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number = 60) {
    super('RATE_LIMITED', message);
    this.name = 'AlterRateLimited';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterToolError extends AlterError {
  public readonly tool: string;
  public readonly rpcCode?: number;

  constructor(tool: string, message: string, rpcCode?: number) {
    super('TOOL_ERROR', message);
    this.name = 'AlterToolError';
    this.tool = tool;
    this.rpcCode = rpcCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterProvenanceError extends AlterError {
  constructor(message: string, cause?: unknown) {
    super('PROVENANCE', message, cause);
    this.name = 'AlterProvenanceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterDiscoveryError extends AlterError {
  constructor(message: string, cause?: unknown) {
    super('DISCOVERY', message, cause);
    this.name = 'AlterDiscoveryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AlterInvalidResponse extends AlterError {
  constructor(message: string, cause?: unknown) {
    super('INVALID_RESPONSE', message, cause);
    this.name = 'AlterInvalidResponse';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * x402 payment envelope returned in HTTP 402 responses or in the
 * `X-402-Payment` response header. The shape mirrors the x402 spec.
 */
export interface PaymentEnvelope {
  scheme: 'x402';
  network: 'base' | 'base-sepolia' | 'solana' | string;
  asset: 'USDC' | string;
  amount: string;
  recipient: string;
  resource: string;
  expires_at?: string;
  nonce?: string;
  /** Anything else the server included verbatim. */
  [extra: string]: unknown;
}
