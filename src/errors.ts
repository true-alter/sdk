/**
 * Typed error hierarchy for the ~Alter Identity SDK.
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
  | 'UNSUPPORTED'
  | 'CANONICALIZATION';

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
 * Why a value or a JSON text was refused by the canonical profile. Each
 * refusal has its own stable code, so a caller can branch on the kind of
 * failure without parsing the message.
 *
 *   - `duplicate_member`: an object names the same member twice, compared
 *     after escape decoding, so `"a"` and `"\u0061"` collide.
 *   - `unpaired_surrogate`: a string or member name carries a UTF-16
 *     surrogate with no partner, which has no UTF-8 encoding.
 *   - `unsafe_integer`: an integer outside -(2^53-1)..2^53-1, which a peer
 *     reading the number as a double would round.
 *   - `non_finite_number`: NaN, an infinity, or a literal that overflows to
 *     one.
 *   - `depth_bound`: containers nested deeper than the profile allows.
 *   - `malformed_json`: the text is not JSON.
 *   - `trailing_content`: a complete JSON value followed by anything other
 *     than whitespace.
 *   - `unsupported_value`: a value JSON cannot represent, such as
 *     `undefined`, a function, a bigint, or a `Date` or `Map` instance.
 */
export type CanonicalRefusal =
  | 'duplicate_member'
  | 'unpaired_surrogate'
  | 'unsafe_integer'
  | 'non_finite_number'
  | 'depth_bound'
  | 'malformed_json'
  | 'trailing_content'
  | 'unsupported_value';

/**
 * Thrown when a value or a JSON text falls outside the canonical profile.
 * `refusal` names the bound that was breached. `path` locates the value
 * (`$` is the root, `$.a[0]` the first item of member `a`); `offset` is
 * the character offset into the text, set only when a text was parsed.
 */
export class AlterCanonicalizationError extends AlterError {
  public readonly refusal: CanonicalRefusal;
  public readonly path?: string;
  public readonly offset?: number;

  constructor(refusal: CanonicalRefusal, message: string, where: { path?: string; offset?: number } = {}) {
    super('CANONICALIZATION', message);
    this.name = 'AlterCanonicalizationError';
    this.refusal = refusal;
    this.path = where.path;
    this.offset = where.offset;
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
