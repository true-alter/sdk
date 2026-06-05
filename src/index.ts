/**
 * @truealter/sdk — ALTER Identity SDK
 *
 * Query the continuous identity field from any JavaScript/TypeScript
 * environment. Wraps the 32 tools exposed at
 * `https://mcp.truealter.com/api/v1/mcp` (24 free L0 + 8 premium L1–L5).
 * Write tools (`submit_*`, `attest_domain`, `dispute_attestation`,
 * `create_identity_stub`) and alter-to-alter messaging tools are not
 * advertised to public callers — they re-enable as the consent
 * architecture and per-peer grant model land. First-class TypeScript
 * types, x402 micropayment support, and ES256 provenance verification.
 *
 * The ALTER endpoint discovery anchor is `truealter.com` — see
 * `discover()` for the cascade. The default MCP wire endpoint is
 * `https://mcp.truealter.com/api/v1/mcp`; the bare host
 * `https://mcp.truealter.com` is the branded discovery surface and
 * returns `405 Method Not Allowed` for JSON-RPC POSTs.
 */

// High-level client (most consumers start here)
export { AlterClient, DEFAULT_DOMAIN, DEFAULT_ENDPOINT } from './client.js';
export type { AlterClientOptions } from './client.js';

// Low-level transport
export {
  MCPClient,
  MCP_PROTOCOL_VERSION,
  type MCPCallOptions,
  type MCPCallToolResult,
  type MCPClientInfo,
  type MCPClientOptions,
  type MCPContentBlock,
  type MCPListToolsResult,
  type MCPSigningOptions,
  type MCPToolDefinition,
} from './mcp.js';

// Q5c per-invocation signing
export {
  canonicalArgsSha256,
  canonicalStringify,
  loadPrivateKey,
  signInvocation,
  type InvocationClaims,
  type SignInvocationOptions,
} from './signing.js';

// Discovery
export { clearDiscoveryCache, discover, type DiscoveryOptions, type DiscoveryResult } from './discovery.js';

// Auth & Ed25519
export {
  base64urlDecode,
  base64urlEncode,
  decodeDid,
  encodeDid,
  generateKeypair,
  keypairFromPrivateKey,
  sign,
  verify,
  type ApiKeyConfig,
  type Ed25519Keypair,
} from './auth.js';

// Provenance
export {
  DEFAULT_VERIFY_AT_ALLOWLIST,
  fetchPublicKeys,
  resolveVerifyAt,
  verifyProvenance,
  verifyToolSignatures,
  type JsonWebKey,
  type JwksDocument,
  type ProvenanceEnvelope,
  type ProvenancePayload,
  type ProvenanceVerification,
  type SignedToolDefinition,
  type ToolSignatureMap,
  type VerifyProvenanceOptions,
} from './provenance.js';

// x402
export { parsePaymentHeader, X402Client, type X402ClientOptions, type X402Settlement, type X402Signer } from './x402.js';

// Errors
export {
  AlterAuthError,
  AlterDiscoveryError,
  AlterError,
  AlterInvalidResponse,
  AlterNetworkError,
  AlterPaymentRequired,
  AlterProvenanceError,
  AlterRateLimited,
  AlterTimeoutError,
  AlterToolError,
  type AlterErrorCode,
  type PaymentEnvelope,
} from './errors.js';

// Adapters (optional helpers for editor integrations)
export { generateClaudeConfig } from './adapters/claude-code.js';
export { generateCursorConfig } from './adapters/cursor.js';
export { generateClaudeDesktopConfig } from './adapters/claude-desktop.js';
export { generateGenericMcpConfig } from './adapters/generic-mcp.js';
export type { McpServerConfig } from './adapters/generic-mcp.js';
export type { ClaudeDesktopConfig, ClaudeDesktopServerConfig, GenerateClaudeDesktopOptions } from './adapters/claude-desktop.js';

// Wire — auto-install ALTER into detected MCP clients
export {
  wire,
  unwire,
  probeAll,
  probeClaudeCode,
  probeByDir,
  detectSyncedVolume,
  readWireState,
  writeWireState,
  sha256,
  ALL_CLIENTS,
  CLAUDE_CODE,
  CURSOR,
  CLAUDE_DESKTOP,
  VSCODE,
  type ClientId,
  type ClientPaths,
  type ProbeResult,
  type WireOptions,
  type WireReport,
  type UnwireReport,
  type WireState,
  type WireTarget,
  type WireTargetFile,
  type WireTargetCli,
} from './wire/index.js';

// Types — re-export everything from the generated types module
export * from './types.js';

// alter_homepage — wire format (shipped as `homepage`
// because `alter_portfolio` is taken by the attestations tool)
export type {
  HomepageCallerVertical,
  HomepageField,
  HomepageFieldProvenance,
  HomepageInput,
  HomepageManifest,
  HomepageOutput,
} from './homepage.js';
export { HOMEPAGE_LIMITS } from './homepage.js';

// Theme packs — Wave 2 implementation
export type {
  GreetingRegister,
  Osc8AllowedScheme,
  PaletteFloorV1,
  PaletteText,
  PanelDensity,
  StatusLineDensity,
  StatusLineSlot,
  ThemeAssets,
  ThemeLockEntry,
  ThemeManifestV1,
  ThemeMeta,
  ThemeOpener,
  ThemePalette,
  ThemeRenderHints,
  ThemeShareInput,
  ThemeShareOutput,
  ThemeSigil,
  ThemeSignatureManifest,
  ThemeStatusLine,
  ThemesLockV1,
} from './themes.js';
export { OSC8_ALLOWED_SCHEMES, THEME_LIMITS } from './themes.js';

// Package metadata
export { SDK_NAME, SDK_VERSION } from './meta.js';
