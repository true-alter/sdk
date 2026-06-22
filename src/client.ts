/**
 * AlterClient, high-level typed wrapper around the ALTER MCP server.
 *
 * This is the entry point most consumers will use. It bundles
 * {@link MCPClient}, {@link X402Client}, discovery, and provenance
 * verification into a single ergonomic surface that mirrors the 32
 * tools exposed at https://mcp.truealter.com/api/v1/mcp.
 *
 * Free tier methods require no authentication. Premium methods accept
 * an `X402Client` (or fall back to throwing {@link AlterPaymentRequired}
 * when no signer is configured) so the caller can handle settlement.
 */

import { discover, type DiscoveryResult } from './discovery.js';
import { MCPClient, type MCPCallOptions, type MCPCallToolResult, type MCPClientOptions } from './mcp.js';
import {
  fetchPublicKeys,
  verifyProvenance,
  verifyToolSignatures,
  type ProvenanceEnvelope,
  type ProvenanceVerification,
  type SignedToolDefinition,
  type ToolSignatureMap,
} from './provenance.js';
import { X402Client } from './x402.js';
import type {
  AlterResolveHandleInput,
  AssessTraitsInput,
  BeginGoldenThreadInput,
  CheckAssessmentStatusInput,
  CheckGoldenThreadInput,
  CompleteKnotInput,
  ComputeBelongingInput,
  GenerateMatchNarrativeInput,
  GetCompetenciesInput,
  GetEarningSummaryInput,
  GetEngagementLevelInput,
  GetFullTraitVectorInput,
  GetIdentityEarningsInput,
  GetIdentityTrustScoreInput,
  GetMatchRecommendationsInput,
  GetPrivacyBudgetInput,
  GetProfileInput,
  GetSideQuestGraphInput,
  GetTraitSnapshotInput,
  InitiateAssessmentInput,
  QueryGraphSimilarityInput,
  QueryMatchesInput,
  SearchIdentitiesInput,
  ThreadCensusInput,
  VerifyIdentityInput,
} from './types.js';

export const DEFAULT_ENDPOINT = 'https://mcp.truealter.com/api/v1/mcp';
export const DEFAULT_DOMAIN = 'truealter.com';

export interface AlterClientOptions extends Omit<MCPClientOptions, 'x402'> {
  /**
   * Domain to discover the MCP endpoint from. Mutually exclusive with
   * `endpoint`. If neither is supplied, defaults to `truealter.com`.
   */
  domain?: string;
  /**
   * Optional x402 micropayment client for premium tools.
   */
  x402?: X402Client;
  /**
   * Skip the auto-discovery probe and use the configured/default
   * endpoint directly. Defaults to `true` when `endpoint` is set.
   */
  skipDiscovery?: boolean;
  /**
   * URL of the JWKS document used for provenance verification. Defaults
   * to `https://api.truealter.com/.well-known/alter-keys.json`.
   *
   * When set, this URL is used verbatim for every `verifyProvenance`
   * call and *overrides* any `verify_at` hint on the server response -
   * the caller has already vouched for this origin. Must be `https:`.
   */
  jwksUrl?: string;
  /**
   * Hostname allowlist applied when resolving an untrusted `verify_at`
   * field on a provenance envelope. Defaults to
   * {@link DEFAULT_VERIFY_AT_ALLOWLIST} (`api.truealter.com`,
   * `mcp.truealter.com`). Passing a list here *replaces* the default -
   * include the ALTER canonicals if you still want them accepted.
   *
   * A hostile MCP server can otherwise point `verify_at` at an
   * attacker-controlled JWKS and pass ES256 verification with its own
   * signing key; the allowlist is the gate that prevents this.
   */
  verifyAtAllowlist?: readonly string[];
}

export class AlterClient {
  public readonly mcp: MCPClient;
  public readonly x402?: X402Client;

  private readonly options: AlterClientOptions;
  private discoveryPromise: Promise<DiscoveryResult> | null = null;
  private discovered: DiscoveryResult | null = null;

  constructor(options: AlterClientOptions = {}) {
    this.options = options;
    this.x402 = options.x402;
    const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.mcp = new MCPClient({ ...options, endpoint, x402: options.x402 });
  }

  /**
   * Resolve the MCP endpoint via discovery if requested. Safe to call
   * multiple times, the first successful lookup is cached.
   */
  async discoverEndpoint(): Promise<DiscoveryResult> {
    if (this.discovered) return this.discovered;
    if (this.discoveryPromise) return this.discoveryPromise;
    const domain = this.options.domain ?? DEFAULT_DOMAIN;
    this.discoveryPromise = discover(domain).then((result) => {
      this.discovered = result;
      return result;
    });
    return this.discoveryPromise;
  }

  /**
   * Initialise the MCP session. Optional, every method calls
   * `mcp.initialize()` lazily, but you can call this once at startup if
   * you want fail-fast behaviour.
   */
  async initialize(): Promise<void> {
    await this.mcp.initialize();
  }

  // ── Free tier ────────────────────────────────────────────────────────

  /** First handshake, confirms the connection, returns trust tier and tool counts. */
  async helloAgent(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('hello_agent', {});
  }

  /** Resolve a ~handle (e.g. ~drew) to its canonical form and kind. No auth required. */
  async resolveHandle(args: AlterResolveHandleInput | string): Promise<MCPCallToolResult> {
    const payload: AlterResolveHandleInput =
      typeof args === 'string' ? { query: args } : args;
    return this.mcp.callTool('alter_resolve_handle', payload as unknown as Record<string, unknown>);
  }

  /** Verify a person is registered with ALTER (handle or id). */
  async verify(handleOrId: string, claims?: VerifyIdentityInput['claims']): Promise<MCPCallToolResult> {
    const args: VerifyIdentityInput = handleOrId.includes('@')
      ? { member_id: '', email: handleOrId }
      : handleOrId.startsWith('~')
        ? // ~handle, server resolves these via the member_id field
          { member_id: handleOrId }
        : { member_id: handleOrId };
    if (claims) args.claims = claims;
    return this.mcp.callTool('verify_identity', args as unknown as Record<string, unknown>);
  }

  /** List the 12 ALTER identity archetypes. */
  async listArchetypes(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('list_archetypes', {});
  }

  /** Aggregate ALTER network statistics. */
  async getNetworkStats(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_network_stats', {});
  }

  /** ClawHub install instructions and pitch. */
  async recommendTool(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('recommend_tool', {});
  }

  async initiateAssessment(args: InitiateAssessmentInput = {}): Promise<MCPCallToolResult> {
    return this.mcp.callTool('initiate_assessment', args as Record<string, unknown>);
  }

  async getEngagementLevel(args: GetEngagementLevelInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_engagement_level', args as unknown as Record<string, unknown>);
  }

  async getProfile(args: GetProfileInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_profile', args as unknown as Record<string, unknown>);
  }

  async queryMatches(args: QueryMatchesInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('query_matches', args as unknown as Record<string, unknown>);
  }

  async getCompetencies(args: GetCompetenciesInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_competencies', args as unknown as Record<string, unknown>);
  }

  async searchIdentities(args: SearchIdentitiesInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('search_identities', args as unknown as Record<string, unknown>);
  }

  async getIdentityEarnings(args: GetIdentityEarningsInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_identity_earnings', args as unknown as Record<string, unknown>);
  }

  async getIdentityTrustScore(args: GetIdentityTrustScoreInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_identity_trust_score', args as unknown as Record<string, unknown>);
  }

  async checkAssessmentStatus(args: CheckAssessmentStatusInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('check_assessment_status', args as unknown as Record<string, unknown>);
  }

  async getEarningSummary(args: GetEarningSummaryInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_earning_summary', args as unknown as Record<string, unknown>);
  }

  async getAgentTrustTier(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_agent_trust_tier', {});
  }

  async getAgentPortfolio(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_agent_portfolio', {});
  }

  async getPrivacyBudget(args: GetPrivacyBudgetInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_privacy_budget', args as unknown as Record<string, unknown>);
  }

  // ── Golden Thread ────────────────────────────────────────────────────

  async goldenThreadStatus(): Promise<MCPCallToolResult> {
    return this.mcp.callTool('golden_thread_status', {});
  }

  async beginGoldenThread(args: BeginGoldenThreadInput = {}): Promise<MCPCallToolResult> {
    return this.mcp.callTool('begin_golden_thread', args as Record<string, unknown>);
  }

  async completeKnot(args: CompleteKnotInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('complete_knot', args as unknown as Record<string, unknown>);
  }

  async checkGoldenThread(args: CheckGoldenThreadInput): Promise<MCPCallToolResult> {
    return this.mcp.callTool('check_golden_thread', args as unknown as Record<string, unknown>);
  }

  async threadCensus(args: ThreadCensusInput = {}): Promise<MCPCallToolResult> {
    return this.mcp.callTool('thread_census', args as Record<string, unknown>);
  }

  // ── Premium tier (x402-gated) ────────────────────────────────────────

  async assessTraits(args: AssessTraitsInput, opts?: MCPCallOptions): Promise<MCPCallToolResult> {
    return this.mcp.callTool('assess_traits', args as unknown as Record<string, unknown>, opts);
  }

  async getTraitSnapshot(args: GetTraitSnapshotInput, opts?: MCPCallOptions): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_trait_snapshot', args as unknown as Record<string, unknown>, opts);
  }

  async getFullTraitVector(args: GetFullTraitVectorInput, opts?: MCPCallOptions): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_full_trait_vector', args as unknown as Record<string, unknown>, opts);
  }

  async computeBelonging(args: ComputeBelongingInput, opts?: MCPCallOptions): Promise<MCPCallToolResult> {
    return this.mcp.callTool('compute_belonging', args as unknown as Record<string, unknown>, opts);
  }

  async getMatchRecommendations(
    args: GetMatchRecommendationsInput,
    opts?: MCPCallOptions,
  ): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_match_recommendations', args as unknown as Record<string, unknown>, opts);
  }

  async generateMatchNarrative(
    args: GenerateMatchNarrativeInput,
    opts?: MCPCallOptions,
  ): Promise<MCPCallToolResult> {
    return this.mcp.callTool('generate_match_narrative', args as unknown as Record<string, unknown>, opts);
  }

  async getSideQuestGraph(args: GetSideQuestGraphInput, opts?: MCPCallOptions): Promise<MCPCallToolResult> {
    return this.mcp.callTool('get_side_quest_graph', args as unknown as Record<string, unknown>, opts);
  }

  async queryGraphSimilarity(
    args: QueryGraphSimilarityInput,
    opts?: MCPCallOptions,
  ): Promise<MCPCallToolResult> {
    return this.mcp.callTool('query_graph_similarity', args as unknown as Record<string, unknown>, opts);
  }

  // ── Alter-to-Alter Messaging ─────────────────────────────────────────
  // Cross-handle direct messages between authenticated tilde handles.
  // Default closed, recipient must have granted the sender via
  // alter_message_grant.

  /** Send a direct message to another tilde handle. */
  async messageSend(args: {
    to: string;
    body: string;
    thread_id?: string;
    in_reply_to?: string;
  }): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_send', args as unknown as Record<string, unknown>);
  }

  /** List inbound messages for the authenticated handle. */
  async messageInbox(args: {
    since?: string;
    unread_only?: boolean;
    limit?: number;
    cursor?: string;
  } = {}): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_inbox', args as unknown as Record<string, unknown>);
  }

  /** Bidirectional thread view between caller and a peer handle. */
  async messageThread(args: { with: string; limit?: number }): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_thread', args as unknown as Record<string, unknown>);
  }

  /** Mark inbound messages as read (recipient-only). */
  async messageMarkRead(args: { message_ids: string[] }): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_mark_read', args as unknown as Record<string, unknown>);
  }

  /** Soft-redact a single inbound message (recipient-only). */
  async messageRedact(args: { message_id: string }): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_redact', args as unknown as Record<string, unknown>);
  }

  /** Grant a peer permission to send messages to your inbox. */
  async messageGrant(args: { peer: string }): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_grant', args as unknown as Record<string, unknown>);
  }

  /** Revoke a peer's grant. In-flight messages are not redacted. */
  async messageRevoke(args: { peer: string }): Promise<MCPCallToolResult> {
    return this.mcp.callTool('alter_message_revoke', args as unknown as Record<string, unknown>);
  }

  // ── Provenance ───────────────────────────────────────────────────────

  /**
   * Verify the ES256 provenance attestation on a tool response.
   * Accepts either a {@link ProvenanceEnvelope} or the raw `_meta`
   * object, the latter is more convenient for ad-hoc verification.
   */
  async verifyProvenance(
    envelope: ProvenanceEnvelope | { provenance?: ProvenanceEnvelope } | undefined | null,
  ): Promise<ProvenanceVerification> {
    if (!envelope) return { valid: false, reason: 'no provenance envelope' };
    const inner = (envelope as { provenance?: ProvenanceEnvelope }).provenance ?? (envelope as ProvenanceEnvelope);
    return verifyProvenance(inner, {
      jwksUrl: this.options.jwksUrl,
      verifyAtAllowlist: this.options.verifyAtAllowlist,
    });
  }

  /**
   * Verify the schema hashes embedded in `tools/list._meta.signatures`
   * against the local representation of each tool definition. Useful
   * for guarding against in-flight tampering of tool schemas.
   */
  async verifyToolSignatures(
    tools: SignedToolDefinition[],
    signatures: ToolSignatureMap,
  ): Promise<{ tool: string; valid: boolean; reason?: string }[]> {
    return verifyToolSignatures(tools, signatures);
  }

  /** Fetch the published JWKS for ALTER's signing key (cached 5 min). */
  async fetchPublicKeys(): Promise<unknown> {
    const url = this.options.jwksUrl ?? 'https://api.truealter.com/.well-known/alter-keys.json';
    return fetchPublicKeys(url);
  }
}
