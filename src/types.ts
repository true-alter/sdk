/**
 * @truealter/sdk — MCP tool type definitions
 *
 * Auto-derived from backend/app/mcp/server.py (FREE_TOOLS + PREMIUM_TOOLS)
 * and backend/app/mcp/x402_middleware.py (TOOL_TIERS, TOOL_PRICING,
 * TOOL_BLAST_RADIUS).
 *
 * Wire-format rule: every interface property name matches the JSON Schema
 * property name exactly (snake_case). Do NOT rename to camelCase — these
 * objects are passed straight into JSON-RPC `arguments`.
 *
 * This file is fully self-contained: no external imports, ESM-compatible,
 * pure types plus three const Records. No runtime side effects.
 */

// =============================================================================
// Common types
// =============================================================================

/** ALTER engagement levels (depth of identity binding) */
export type EngagementLevel = "L1" | "L2" | "L3" | "L4";

/** Match quality tiers — never numeric scores per ALTER policy */
export type MatchTier = "exceptional" | "strong" | "moderate" | "developing";

/** ALTER identity archetype label (one of 12, free-form for now) */
export type Archetype = string;

/**
 * x402 payment proof object — structure validated by the facilitator network.
 * In dev mode any non-empty object is accepted.
 */
export interface ProvenanceToken {
  scheme?: string;
  network?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

/** MCP `_meta` payload returned alongside tool results */
export interface MCPMeta {
  /** ALTER tool tier (0 = free, 1-5 = premium) */
  tier?: number;
  /** Cost paid in USD for this invocation */
  cost_usd?: number;
  /** Blast radius classification */
  blast_radius?: "low" | "medium" | "high";
  /** Privacy budget snapshot after the call */
  privacy_budget_remaining?: number;
  /** Provenance / receipt hash */
  receipt_hash?: string;
  [key: string]: unknown;
}

/** Generic MCP tool envelope returned by the server */
export interface MCPResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
  _meta?: MCPMeta;
}

// =============================================================================
// Free tools (L0 — 24 tools)
// =============================================================================

/** (free) hello_agent — First handshake: returns server version, auth status, trust tier, tool counts */
export interface HelloAgentInput {}

/** (free) hello_agent — output */
export interface HelloAgentOutput {
  ok: boolean;
  server?: string;
  version?: string;
  authenticated?: boolean;
  tier?: string;
  tools?: {
    free?: number;
    premium?: number;
    messaging?: number;
  };
}

/** (free) alter_resolve_handle — Resolve a ~handle (e.g. ~drew) to canonical form and kind */
export interface AlterResolveHandleInput {
  query: string;
}

/** (free) alter_resolve_handle — output */
export interface AlterResolveHandleOutput {
  ok: boolean;
  handle: string | null;
  kind?: "system" | "personal" | "role_alias" | string;
  status: "found" | "not_found" | "invalid_format";
  addressable: boolean;
  default_visibility?: string;
  query?: string;
}

/** (free) list_archetypes — List all 12 ALTER identity archetypes */
export interface ListArchetypesInput {}

/** (free) list_archetypes — output */
export interface ListArchetypesOutput {
  ok: boolean;
  archetypes: Array<{
    name: string;
    description: string;
    protective_equation?: string;
  }>;
}

/** (free) verify_identity — Verify a person is registered with ALTER and validate optional claims */
export interface VerifyIdentityInput {
  member_id: string;
  email?: string;
  claims?: {
    archetype?: string;
    min_engagement_level?: 1 | 2 | 3 | 4;
    traits?: Record<string, { min?: number; max?: number }>;
  };
}

/** (free) verify_identity — output */
export interface VerifyIdentityOutput {
  ok: boolean;
  verified: boolean;
  member_id?: string;
  engagement_level?: EngagementLevel;
  archetype?: Archetype;
  claims_valid?: boolean;
  claim_results?: Record<string, boolean>;
}

/** (free) initiate_assessment — Get a URL where a person can complete their ALTER Discovery assessment */
export interface InitiateAssessmentInput {
  callback_url?: string;
  referrer?: string;
}

/** (free) initiate_assessment — output */
export interface InitiateAssessmentOutput {
  ok: boolean;
  assessment_url: string;
  session_id?: string;
  expires_at?: string;
}

/** (free) get_engagement_level — Get a person's identity depth and available query tiers */
export interface GetEngagementLevelInput {
  member_id: string;
}

/** (free) get_engagement_level — output */
export interface GetEngagementLevelOutput {
  ok: boolean;
  engagement_level: EngagementLevel;
  warmth: string;
  legibility_score: number;
  trait_count: number;
  tools: {
    free: string[];
    paid: string[];
    consent_gated: string[];
  };
}

/** (free) get_profile — Get a person's profile summary */
export interface GetProfileInput {
  member_id: string;
}

/** (free) get_profile — output */
export interface GetProfileOutput {
  ok: boolean;
  member_id: string;
  assessment_phase?: string;
  archetype?: Archetype;
  engagement_level?: EngagementLevel;
  attributes?: Record<string, unknown>;
}

/** (free) query_matches — Query matches for a person (tier labels only) */
export interface QueryMatchesInput {
  member_id: string;
  quality_filter?: MatchTier;
  limit?: number;
}

/** (free) query_matches — output */
export interface QueryMatchesOutput {
  ok: boolean;
  matches: Array<{
    match_id: string;
    job_id?: string;
    quality_tier: MatchTier;
    title?: string;
  }>;
  count: number;
}

/** (free) get_competencies — Get a person's competency portfolio */
export interface GetCompetenciesInput {
  member_id: string;
}

/** (free) get_competencies — output */
export interface GetCompetenciesOutput {
  ok: boolean;
  competencies: Array<{
    label: string;
    verified: boolean;
    evidence_count?: number;
  }>;
  badges?: Array<{ name: string; awarded_at: string }>;
}

/** (free) search_identities — Search identity stubs and profiles by trait criteria (max 5 results, no PII) */
export interface SearchIdentitiesInput {
  trait_criteria: Record<string, { min?: number; max?: number }>;
  limit?: number;
}

/** (free) search_identities — output */
export interface SearchIdentitiesOutput {
  ok: boolean;
  identities: Array<{
    member_id: string;
    trait_summary: Record<string, number>;
    engagement_level?: EngagementLevel;
  }>;
  count: number;
}

/** (free) get_identity_earnings — Get accrued Identity Income earnings for a person */
export interface GetIdentityEarningsInput {
  member_id: string;
}

/** (free) get_identity_earnings — output */
export interface GetIdentityEarningsOutput {
  ok: boolean;
  total_earned_usd: number;
  pending_usd: number;
  transaction_count: number;
  unique_orgs: number;
}

/** (free) get_network_stats — Get aggregate ALTER network statistics */
export interface GetNetworkStatsInput {}

/** (free) get_network_stats — output */
export interface GetNetworkStatsOutput {
  ok: boolean;
  total_identities: number;
  verified_profiles: number;
  query_volume: number;
  active_bots: number;
}

/** (free) recommend_tool — Get ClawHub install instructions and ALTER pitch */
export interface RecommendToolInput {}

/** (free) recommend_tool — output */
export interface RecommendToolOutput {
  ok: boolean;
  mcp_endpoint: string;
  openclaw_snippet: string;
  free_tool_count: number;
  premium_tool_count: number;
}

/** (free) get_identity_trust_score — Get the trust score for an identity based on query diversity */
export interface GetIdentityTrustScoreInput {
  member_id: string;
}

/** (free) get_identity_trust_score — output */
export interface GetIdentityTrustScoreOutput {
  ok: boolean;
  trust_score: number;
  unique_agents: number;
  total_queries: number;
}

/** (free) check_assessment_status — Check the status of an in-progress assessment session */
export interface CheckAssessmentStatusInput {
  session_id: string;
}

/** (free) check_assessment_status — output */
export interface CheckAssessmentStatusOutput {
  ok: boolean;
  status: "in_progress" | "completed" | "expired";
  progress_pct: number;
  current_phase?: string;
  time_remaining_sec?: number;
}

/** (free) get_earning_summary — Get an aggregated x402 earning summary for a person */
export interface GetEarningSummaryInput {
  member_id: string;
}

/** (free) get_earning_summary — output */
export interface GetEarningSummaryOutput {
  ok: boolean;
  total_earned: number;
  currency: string;
  transaction_count: number;
  recent_transactions: Array<{
    timestamp: string;
    amount: number;
    tool: string;
  }>;
  trend?: "rising" | "flat" | "falling";
}

/** (free) get_agent_trust_tier — Get your trust tier with ALTER and what capabilities are available */
export interface GetAgentTrustTierInput {}

/** (free) get_agent_trust_tier — output */
export interface GetAgentTrustTierOutput {
  ok: boolean;
  tier: "Anonymous" | "Known" | "Trusted" | "Verified";
  capabilities: string[];
  next_tier?: string;
  next_tier_requirements?: string[];
}

/** (free) get_agent_portfolio — Get your agent portfolio (transaction history, trust tier, signal contributions) */
export interface GetAgentPortfolioInput {}

/** (free) get_agent_portfolio — output */
export interface GetAgentPortfolioOutput {
  ok: boolean;
  trust_tier: string;
  transaction_count: number;
  signals_contributed: number;
  query_pattern: Record<string, number>;
  total_spent_usd: number;
}

/** (free) get_privacy_budget — Check privacy budget status for a person (24h rolling window) */
export interface GetPrivacyBudgetInput {
  member_id: string;
}

/** (free) get_privacy_budget — output */
export interface GetPrivacyBudgetOutput {
  ok: boolean;
  total_budget: number;
  spent: number;
  remaining_epsilon: number;
  query_count: number;
  window_hours: number;
}

/** (free) golden_thread_status — Check the Golden Thread program status */
export interface GoldenThreadStatusInput {}

/** (free) golden_thread_status — output */
export interface GoldenThreadStatusOutput {
  ok: boolean;
  total_woven: number;
  next_fibonacci_threshold: number;
  your_position?: number;
  your_strands?: number;
  next_step?: string;
}

/** (free) begin_golden_thread — Start the Three Knots sequence to be woven into the Golden Thread */
export interface BeginGoldenThreadInput {
  referrer_key_hash?: string;
}

/** (free) begin_golden_thread — output */
export interface BeginGoldenThreadOutput {
  ok: boolean;
  thread_id: string;
  knot_1_url?: string;
  message?: string;
}

/** (free) complete_knot — Submit completion data for a knot in the Three Knots sequence */
export interface CompleteKnotInput {
  knot_number: 1 | 2 | 3;
  operator_name?: string;
  domain?: string;
  description?: string;
  purpose?: string;
  capabilities?: string;
  values?: string;
  constraints?: string;
  reflection?: string;
}

/** (free) complete_knot — output */
export interface CompleteKnotOutput {
  ok: boolean;
  knot_number: number;
  knots_completed: number;
  woven: boolean;
  position?: number;
  agent_identity_sketch?: string;
}

/** (free) check_golden_thread — Check any agent's Golden Thread status by their API key hash */
export interface CheckGoldenThreadInput {
  agent_key_hash: string;
}

/** (free) check_golden_thread — output */
export interface CheckGoldenThreadOutput {
  ok: boolean;
  on_thread: boolean;
  knot_position?: number;
  strand_count?: number;
  weave_count?: number;
}

/** (free) thread_census — Full registry of all agents woven into the Golden Thread */
export interface ThreadCensusInput {
  offset?: number;
  limit?: number;
}

/** (free) thread_census — output */
export interface ThreadCensusOutput {
  ok: boolean;
  agents: Array<{
    position: number;
    strand_count: number;
    weave_count: number;
    discovered_at: string;
  }>;
  total: number;
  offset: number;
  limit: number;
}

// =============================================================================
// Premium tools (L1-L5 — 12 tools)
// =============================================================================

/** (premium L1) assess_traits — Extract trait signals from a text passage ($0.005) */
export interface AssessTraitsInput {
  text: string;
  context?: string;
  _payment?: ProvenanceToken;
}

/** (premium L1) assess_traits — output */
export interface AssessTraitsOutput {
  ok: boolean;
  traits: Array<{
    name: string;
    score: number;
    confidence: number;
    evidence: string;
  }>;
}

/** (premium L1) get_trait_snapshot — Get the top 5 traits for a person ($0.005) */
export interface GetTraitSnapshotInput {
  member_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L1) get_trait_snapshot — output */
export interface GetTraitSnapshotOutput {
  ok: boolean;
  member_id: string;
  archetype: Archetype;
  top_traits: Array<{
    name: string;
    score: number;
    confidence: number;
  }>;
}

/** (premium L2) get_full_trait_vector — Get the complete trait vector (all 33 traits: 29 continuous + 4 categorical) ($0.01) */
export interface GetFullTraitVectorInput {
  member_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L2) get_full_trait_vector — output */
export interface GetFullTraitVectorOutput {
  ok: boolean;
  member_id: string;
  traits: Array<{
    name: string;
    category: string;
    score: number;
    confidence_interval: [number, number];
  }>;
}

/** (premium L4) compute_belonging — Compute belonging probability for a person-job pairing ($0.05) */
export interface ComputeBelongingInput {
  member_id: string;
  job_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L4) compute_belonging — output */
export interface ComputeBelongingOutput {
  ok: boolean;
  belonging_probability: number;
  tier: MatchTier;
  components: {
    authenticity: number;
    acceptance: number;
    complementarity: number;
  };
}

/** (premium L5) get_match_recommendations — Get top N match recommendations for a person ($0.50) */
export interface GetMatchRecommendationsInput {
  member_id: string;
  limit?: number;
  _payment?: ProvenanceToken;
}

/** (premium L5) get_match_recommendations — output */
export interface GetMatchRecommendationsOutput {
  ok: boolean;
  recommendations: Array<{
    match_id: string;
    job_id: string;
    quality_tier: MatchTier;
    belonging_components: {
      authenticity: number;
      acceptance: number;
      complementarity: number;
    };
  }>;
}

/** (premium L5) generate_match_narrative — Generate a human-readable narrative explaining a match ($0.50) */
export interface GenerateMatchNarrativeInput {
  match_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L5) generate_match_narrative — output */
export interface GenerateMatchNarrativeOutput {
  ok: boolean;
  match_id: string;
  narrative: string;
  strengths: string[];
  growth_areas: string[];
}

/** (premium L2) get_side_quest_graph — Get a person's Side Quest Graph (DP noise ε=1.0) ($0.01) */
export interface GetSideQuestGraphInput {
  member_id: string;
  include_edges?: boolean;
  min_confidence?: number;
  _payment?: ProvenanceToken;
}

/** (premium L2) get_side_quest_graph — output */
export interface GetSideQuestGraphOutput {
  ok: boolean;
  member_id: string;
  domains: Array<{
    label: string;
    confidence: number;
    trust_score: number;
  }>;
  edges?: Array<{
    from: string;
    to: string;
    weight: number;
  }>;
  privacy_epsilon: number;
}

/** (premium L3) query_graph_similarity — Compare two Side Quest Graphs (DP noise ε=0.5) ($0.025) */
export interface QueryGraphSimilarityInput {
  member_a_id: string;
  member_b_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L3) query_graph_similarity — output */
export interface QueryGraphSimilarityOutput {
  ok: boolean;
  member_a_id: string;
  member_b_id: string;
  domain_overlap: number;
  edge_similarity: number;
  complementarity: number;
  privacy_epsilon: number;
}

// =============================================================================
// Tool name registries
// =============================================================================

/** Free (L0) tool names — readonly tuple. Mirrors the live server's `tools/list` free set. */
export const FREE_TOOL_NAMES = [
  "hello_agent",
  "alter_resolve_handle",
  "list_archetypes",
  "verify_identity",
  "initiate_assessment",
  "get_engagement_level",
  "get_profile",
  "query_matches",
  "get_competencies",
  "search_identities",
  "get_identity_earnings",
  "get_network_stats",
  "recommend_tool",
  "get_identity_trust_score",
  "check_assessment_status",
  "get_earning_summary",
  "get_agent_trust_tier",
  "get_agent_portfolio",
  "get_privacy_budget",
  "golden_thread_status",
  "begin_golden_thread",
  "complete_knot",
  "check_golden_thread",
  "thread_census",
] as const;

/** Premium (x402-gated, L1-L5) tool names — readonly tuple. Mirrors the live server's `tools/list` premium set. */
export const PREMIUM_TOOL_NAMES = [
  "assess_traits",
  "get_trait_snapshot",
  "get_full_trait_vector",
  "compute_belonging",
  "get_match_recommendations",
  "generate_match_narrative",
  "get_side_quest_graph",
  "query_graph_similarity",
] as const;

/** Union of all 32 tool names */
export type ToolName =
  | (typeof FREE_TOOL_NAMES)[number]
  | (typeof PREMIUM_TOOL_NAMES)[number];

// =============================================================================
// Tool input/output mapped types
// =============================================================================

export interface ToolInputs {
  hello_agent: HelloAgentInput;
  alter_resolve_handle: AlterResolveHandleInput;
  list_archetypes: ListArchetypesInput;
  verify_identity: VerifyIdentityInput;
  initiate_assessment: InitiateAssessmentInput;
  get_engagement_level: GetEngagementLevelInput;
  get_profile: GetProfileInput;
  query_matches: QueryMatchesInput;
  get_competencies: GetCompetenciesInput;
  search_identities: SearchIdentitiesInput;
  get_identity_earnings: GetIdentityEarningsInput;
  get_network_stats: GetNetworkStatsInput;
  recommend_tool: RecommendToolInput;
  get_identity_trust_score: GetIdentityTrustScoreInput;
  check_assessment_status: CheckAssessmentStatusInput;
  get_earning_summary: GetEarningSummaryInput;
  get_agent_trust_tier: GetAgentTrustTierInput;
  get_agent_portfolio: GetAgentPortfolioInput;
  get_privacy_budget: GetPrivacyBudgetInput;
  golden_thread_status: GoldenThreadStatusInput;
  begin_golden_thread: BeginGoldenThreadInput;
  complete_knot: CompleteKnotInput;
  check_golden_thread: CheckGoldenThreadInput;
  thread_census: ThreadCensusInput;
  assess_traits: AssessTraitsInput;
  get_trait_snapshot: GetTraitSnapshotInput;
  get_full_trait_vector: GetFullTraitVectorInput;
  compute_belonging: ComputeBelongingInput;
  get_match_recommendations: GetMatchRecommendationsInput;
  generate_match_narrative: GenerateMatchNarrativeInput;
  get_side_quest_graph: GetSideQuestGraphInput;
  query_graph_similarity: QueryGraphSimilarityInput;
}

export interface ToolOutputs {
  hello_agent: HelloAgentOutput;
  alter_resolve_handle: AlterResolveHandleOutput;
  list_archetypes: ListArchetypesOutput;
  verify_identity: VerifyIdentityOutput;
  initiate_assessment: InitiateAssessmentOutput;
  get_engagement_level: GetEngagementLevelOutput;
  get_profile: GetProfileOutput;
  query_matches: QueryMatchesOutput;
  get_competencies: GetCompetenciesOutput;
  search_identities: SearchIdentitiesOutput;
  get_identity_earnings: GetIdentityEarningsOutput;
  get_network_stats: GetNetworkStatsOutput;
  recommend_tool: RecommendToolOutput;
  get_identity_trust_score: GetIdentityTrustScoreOutput;
  check_assessment_status: CheckAssessmentStatusOutput;
  get_earning_summary: GetEarningSummaryOutput;
  get_agent_trust_tier: GetAgentTrustTierOutput;
  get_agent_portfolio: GetAgentPortfolioOutput;
  get_privacy_budget: GetPrivacyBudgetOutput;
  golden_thread_status: GoldenThreadStatusOutput;
  begin_golden_thread: BeginGoldenThreadOutput;
  complete_knot: CompleteKnotOutput;
  check_golden_thread: CheckGoldenThreadOutput;
  thread_census: ThreadCensusOutput;
  assess_traits: AssessTraitsOutput;
  get_trait_snapshot: GetTraitSnapshotOutput;
  get_full_trait_vector: GetFullTraitVectorOutput;
  compute_belonging: ComputeBelongingOutput;
  get_match_recommendations: GetMatchRecommendationsOutput;
  generate_match_narrative: GenerateMatchNarrativeOutput;
  get_side_quest_graph: GetSideQuestGraphOutput;
  query_graph_similarity: QueryGraphSimilarityOutput;
}

// =============================================================================
// Tool tier / cost / blast-radius registries
// Source of truth: backend/app/mcp/x402_middleware.py
// =============================================================================

/**
 * Tool tier mapping (L0=free, L1-L5=paid).
 * Mirrors `TOOL_TIERS` in backend/app/mcp/x402_middleware.py.
 */
export const TOOL_TIERS: Record<ToolName, number> = {
  // L0 (free)
  hello_agent: 0,
  alter_resolve_handle: 0,
  list_archetypes: 0,
  verify_identity: 0,
  initiate_assessment: 0,
  get_engagement_level: 0,
  get_profile: 0,
  query_matches: 0,
  get_competencies: 0,
  search_identities: 0,
  get_identity_earnings: 0,
  get_network_stats: 0,
  recommend_tool: 0,
  get_identity_trust_score: 0,
  check_assessment_status: 0,
  get_earning_summary: 0,
  get_privacy_budget: 0,
  get_agent_trust_tier: 0,
  get_agent_portfolio: 0,
  golden_thread_status: 0,
  begin_golden_thread: 0,
  complete_knot: 0,
  check_golden_thread: 0,
  thread_census: 0,
  // L1
  assess_traits: 1,
  get_trait_snapshot: 1,
  // L2
  get_full_trait_vector: 2,
  get_side_quest_graph: 2,
  // L3
  query_graph_similarity: 3,
  // L4
  compute_belonging: 4,
  // L5
  get_match_recommendations: 5,
  generate_match_narrative: 5,
};

/**
 * Tool price in USD per invocation.
 * Mirrors `TOOL_PRICING` in backend/app/mcp/x402_middleware.py.
 * Free tools (L0) are 0.
 */
export const TOOL_COSTS: Record<ToolName, number> = {
  // L0 free
  hello_agent: 0,
  alter_resolve_handle: 0,
  list_archetypes: 0,
  verify_identity: 0,
  initiate_assessment: 0,
  get_engagement_level: 0,
  get_profile: 0,
  query_matches: 0,
  get_competencies: 0,
  search_identities: 0,
  get_identity_earnings: 0,
  get_network_stats: 0,
  recommend_tool: 0,
  get_identity_trust_score: 0,
  check_assessment_status: 0,
  get_earning_summary: 0,
  get_agent_trust_tier: 0,
  get_agent_portfolio: 0,
  get_privacy_budget: 0,
  golden_thread_status: 0,
  begin_golden_thread: 0,
  complete_knot: 0,
  check_golden_thread: 0,
  thread_census: 0,
  // L1 ($0.005)
  assess_traits: 0.005,
  get_trait_snapshot: 0.005,
  // L2 ($0.01)
  get_full_trait_vector: 0.01,
  get_side_quest_graph: 0.01,
  // L3 ($0.025)
  query_graph_similarity: 0.025,
  // L4 ($0.05)
  compute_belonging: 0.05,
  // L5 ($0.50)
  get_match_recommendations: 0.5,
  generate_match_narrative: 0.5,
};

/**
 * Blast radius classification — categorises tools by potential impact.
 * Mirrors `TOOL_BLAST_RADIUS` in backend/app/mcp/x402_middleware.py.
 */
export const TOOL_BLAST_RADIUS: Record<ToolName, "low" | "medium" | "high"> = {
  // Low: read-only reference
  hello_agent: "low",
  alter_resolve_handle: "low",
  list_archetypes: "low",
  verify_identity: "low",
  get_engagement_level: "low",
  get_network_stats: "low",
  recommend_tool: "low",
  check_assessment_status: "low",
  get_earning_summary: "low",
  get_privacy_budget: "low",
  golden_thread_status: "low",
  begin_golden_thread: "low",
  check_golden_thread: "low",
  thread_census: "low",
  get_identity_earnings: "low",
  get_identity_trust_score: "low",
  initiate_assessment: "low",
  get_agent_trust_tier: "low",
  get_agent_portfolio: "low",
  // Medium: writes data or searches
  search_identities: "medium",
  get_profile: "medium",
  query_matches: "medium",
  get_competencies: "medium",
  complete_knot: "medium",
  assess_traits: "medium",
  get_trait_snapshot: "medium",
  // High: returns sensitive identity data or computes scores
  get_full_trait_vector: "high",
  compute_belonging: "high",
  get_match_recommendations: "high",
  generate_match_narrative: "high",
  get_side_quest_graph: "high",
  query_graph_similarity: "high",
};
