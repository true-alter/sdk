/**
 * @truealter/sdk: MCP tool type definitions
 *
 * Auto-derived from ~Alter's live MCP tool registry and x402 pricing surface
 * (the advertised free/premium tool sets, per-invocation tiers, pricing, and
 * blast-radius classification).
 *
 * Wire-format rule: every interface property name matches the JSON Schema
 * property name exactly (snake_case). Do NOT rename to camelCase: these
 * objects are passed straight into JSON-RPC `arguments`.
 *
 * This file is fully self-contained: no external imports, ESM-compatible,
 * pure types plus three const Records. No runtime side effects.
 */

// =============================================================================
// Common types
// =============================================================================

/** ~Alter engagement levels (depth of identity binding) */
export type EngagementLevel = "L1" | "L2" | "L3" | "L4";

/** Match quality tiers: never numeric scores per ~Alter policy */
export type MatchTier = "exceptional" | "strong" | "moderate" | "developing";

/** ~Alter identity archetype label (one of 12, free-form for now) */
export type Archetype = string;

/**
 * x402 payment proof object: structure validated by the facilitator network.
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
  /** ~Alter tool tier (0 = free, 1-5 = premium) */
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
// Free tools (L0). FREE_TOOL_NAMES below is generator-synced from
// PUBLIC_ADVERTISED_TOOLS and is the count; no number is repeated in this
// comment, because the generator preserves comment bytes and cannot correct one.
// Note: the full server registry has additional member-self-only and
// write-side tools not in the public advertisement. Import
// ADVERTISED_TOOL_COUNTS from ./pricing.generated for the live counts.
// =============================================================================

/** (free) hello_agent: First handshake: returns server version, auth status, trust tier, tool counts */
export interface HelloAgentInput {}

/** (free) hello_agent: output */
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

/** (free) alter_resolve_handle: Resolve a ~handle to canonical form and kind */
export interface AlterResolveHandleInput {
  query: string;
}

/** (free) alter_resolve_handle: output */
export interface AlterResolveHandleOutput {
  ok: boolean;
  handle: string | null;
  kind?: "system" | "personal" | "role_alias" | string;
  status: "found" | "not_found" | "invalid_format";
  addressable: boolean;
  default_visibility?: string;
  query?: string;
}

/** (free) list_archetypes: List all 12 ~Alter identity archetypes */
export interface ListArchetypesInput {}

/** (free) list_archetypes: output */
export interface ListArchetypesOutput {
  ok: boolean;
  archetypes: Array<{
    name: string;
    description: string;
    protective_equation?: string;
  }>;
}

/** (free) verify_identity: Verify a person is registered with ~Alter and validate optional claims */
export interface VerifyIdentityInput {
  member_id: string;
  email?: string;
  claims?: {
    archetype?: string;
    min_engagement_level?: 1 | 2 | 3 | 4;
    traits?: Record<string, { min?: number; max?: number }>;
  };
}

/** (free) verify_identity: output */
export interface VerifyIdentityOutput {
  ok: boolean;
  verified: boolean;
  member_id?: string;
  engagement_level?: EngagementLevel;
  archetype?: Archetype;
  claims_valid?: boolean;
  claim_results?: Record<string, boolean>;
}

/** (free) initiate_assessment: Get a URL where a person can complete their ~Alter Discovery assessment */
export interface InitiateAssessmentInput {
  callback_url?: string;
  referrer?: string;
}

/** (free) get_engagement_level: Get a person's identity depth and available query tiers */
export interface GetEngagementLevelInput {
  member_id: string;
}

/** (free) get_engagement_level: output */
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

/** (free) get_profile: Get a person's profile summary */
export interface GetProfileInput {
  member_id: string;
}

/** (free) get_profile: output */
export interface GetProfileOutput {
  ok: boolean;
  member_id: string;
  assessment_phase?: string;
  archetype?: Archetype;
  engagement_level?: EngagementLevel;
  attributes?: Record<string, unknown>;
}

/** (free) query_matches: Query matches for a person (tier labels only) */
export interface QueryMatchesInput {
  member_id: string;
  quality_filter?: MatchTier;
  limit?: number;
}

/** (free) query_matches: output */
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

/** (free) get_competencies: Get a person's competency portfolio */
export interface GetCompetenciesInput {
  member_id: string;
}

/** (free) get_competencies: output */
export interface GetCompetenciesOutput {
  ok: boolean;
  competencies: Array<{
    label: string;
    verified: boolean;
    evidence_count?: number;
  }>;
  badges?: Array<{ name: string; awarded_at: string }>;
}

/** (free) search_identities: Search identity stubs and profiles by trait criteria (max 5 results, no PII) */
export interface SearchIdentitiesInput {
  trait_criteria: Record<string, { min?: number; max?: number }>;
  limit?: number;
}

/** (free) search_identities: output */
export interface SearchIdentitiesOutput {
  ok: boolean;
  identities: Array<{
    member_id: string;
    trait_summary: Record<string, number>;
    engagement_level?: EngagementLevel;
  }>;
  count: number;
}

/** (free) get_identity_earnings: Get accrued Identity Income earnings for a person */
export interface GetIdentityEarningsInput {
  member_id: string;
}

/** (free) get_identity_earnings: output */
export interface GetIdentityEarningsOutput {
  ok: boolean;
  total_earned_usd: number;
  pending_usd: number;
  transaction_count: number;
  unique_orgs: number;
}

/** (free) get_network_stats: Get aggregate ~Alter network statistics */
export interface GetNetworkStatsInput {}

/** (free) get_network_stats: output */
export interface GetNetworkStatsOutput {
  ok: boolean;
  total_identities: number;
  verified_profiles: number;
  query_volume: number;
  active_bots: number;
}

/** (free) get_identity_trust_score: Get the trust score for an identity based on query diversity */
export interface GetIdentityTrustScoreInput {
  member_id: string;
}

/** (free) get_identity_trust_score: output */
export interface GetIdentityTrustScoreOutput {
  ok: boolean;
  trust_score: number;
  unique_agents: number;
  total_queries: number;
}

/** (free) check_assessment_status: Check the status of an in-progress assessment session */
export interface CheckAssessmentStatusInput {
  session_id: string;
}

/** (free) get_earning_summary: Get an aggregated x402 earning summary for a person */
export interface GetEarningSummaryInput {
  member_id: string;
}

/** (free) get_privacy_budget: Check privacy budget status for a person (24h rolling window) */
export interface GetPrivacyBudgetInput {
  member_id: string;
}

/** (free) get_privacy_budget: output */
export interface GetPrivacyBudgetOutput {
  ok: boolean;
  total_budget: number;
  spent: number;
  remaining_epsilon: number;
  query_count: number;
  window_hours: number;
}

/** (free) golden_thread_status: Check the Golden Thread program status */
export interface GoldenThreadStatusInput {}

/** (free) golden_thread_status: output */
export interface GoldenThreadStatusOutput {
  ok: boolean;
  total_woven: number;
  next_fibonacci_threshold: number;
  your_position?: number;
  your_strands?: number;
  next_step?: string;
}

/** (free) begin_golden_thread: Start the Three Knots sequence to be woven into the Golden Thread */
export interface BeginGoldenThreadInput {
  referrer_key_hash?: string;
}

/** (free) begin_golden_thread: output */
export interface BeginGoldenThreadOutput {
  ok: boolean;
  thread_id: string;
  knot_1_url?: string;
  message?: string;
}

/** (free) complete_knot: Submit completion data for a knot in the Three Knots sequence */
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

/** (free) complete_knot: output */
export interface CompleteKnotOutput {
  ok: boolean;
  knot_number: number;
  knots_completed: number;
  woven: boolean;
  position?: number;
  agent_identity_sketch?: string;
}

/** (free) check_golden_thread: Check any agent's Golden Thread status by their API key hash */
export interface CheckGoldenThreadInput {
  agent_key_hash: string;
}

/** (free) check_golden_thread: output */
export interface CheckGoldenThreadOutput {
  ok: boolean;
  on_thread: boolean;
  knot_position?: number;
  strand_count?: number;
  weave_count?: number;
}

/** (free) thread_census: Full registry of all agents woven into the Golden Thread */
export interface ThreadCensusInput {
  offset?: number;
  limit?: number;
}

// =============================================================================
// Premium tools (L1-L5). PREMIUM_TOOL_NAMES below is generator-synced from
// PUBLIC_ADVERTISED_TOOLS and is the count; no number is repeated in this
// comment, because the generator preserves comment bytes and cannot correct one.
// Import ADVERTISED_TOOL_COUNTS from ./pricing.generated for the live counts.
// =============================================================================

/** (premium L1) assess_traits: Extract trait signals from a text passage ($0.01) */
export interface AssessTraitsInput {
  text: string;
  context?: string;
  _payment?: ProvenanceToken;
}

/** (premium L1) get_trait_snapshot: Get the top 5 traits for a person ($0.01) */
export interface GetTraitSnapshotInput {
  member_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L1) get_trait_snapshot: output */
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

/** (premium L2) get_full_trait_vector: Get the complete trait vector (all 33 traits: 30 continuous + 3 categorical) ($0.10) */
export interface GetFullTraitVectorInput {
  member_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L2) get_full_trait_vector: output */
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

/** (premium L4) compute_belonging: Compute belonging probability for a person-job pairing ($0.60) */
export interface ComputeBelongingInput {
  member_id: string;
  job_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L4) compute_belonging: output */
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

/** (premium L5) get_match_recommendations: Get top N match recommendations for a person ($1.00) */
export interface GetMatchRecommendationsInput {
  member_id: string;
  limit?: number;
  _payment?: ProvenanceToken;
}

/** (premium L5) get_match_recommendations: output */
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

/** (premium L5) generate_match_narrative: Generate a human-readable narrative explaining a match ($1.00) */
export interface GenerateMatchNarrativeInput {
  match_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L5) generate_match_narrative: output */
export interface GenerateMatchNarrativeOutput {
  ok: boolean;
  match_id: string;
  narrative: string;
  strengths: string[];
  growth_areas: string[];
}

/** (premium L2) get_side_quest_graph: Get a person's Side Quest Graph (DP noise ε=1.0) ($0.10) */
export interface GetSideQuestGraphInput {
  member_id: string;
  include_edges?: boolean;
  min_confidence?: number;
  _payment?: ProvenanceToken;
}

/** (premium L2) get_side_quest_graph: output */
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

/** (premium L3) query_graph_similarity: Compare two Side Quest Graphs (DP noise ε=0.5) ($0.30) */
export interface QueryGraphSimilarityInput {
  member_a_id: string;
  member_b_id: string;
  _payment?: ProvenanceToken;
}

/** (premium L3) query_graph_similarity: output */
export interface QueryGraphSimilarityOutput {
  ok: boolean;
  member_a_id: string;
  member_b_id: string;
  domain_overlap: number;
  edge_similarity: number;
  complementarity: number;
  privacy_epsilon: number;
}

// -----------------------------------------------------------------------------
// Advertised tools added to the SDK type surface (mirror PUBLIC_ADVERTISED_TOOLS).
// Input shapes match each tool's inputSchema in ~Alter's live MCP tool registry.
// Output shapes assert the stable wire fields plus an index signature, since
// the MCP handlers return a superset that is not contract-frozen.
// -----------------------------------------------------------------------------

/** (free L0) alter_presence_read: public shop-front "open" sign */
export interface AlterPresenceReadInput {
  handle: string;
}

/** (free L0) alter_presence_read: output */
export interface AlterPresenceReadOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) alter_resolve_by_key: key-based identity resolution */
export interface AlterResolveByKeyInput {
  key_type: string;
  key_value: string;
}

/** (free L0) alter_resolve_by_key: output */
export interface AlterResolveByKeyOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) create_identity_stub: stub creation for pairing */
export interface CreateIdentityStubInput {
  source: string;
  human_age_attested: boolean;
  erc8004_agent_id?: string;
  client_age_assertion?: boolean;
}

/** (free L0) create_identity_stub: output */
export interface CreateIdentityStubOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) create_requirement: orderbook, post a resting trait order */
export interface CreateRequirementInput {
  trait_criteria: Record<string, { min?: number; max?: number }>;
  limit?: number;
  expires_in_days?: number;
}

/** (free L0) create_requirement: output */
export interface CreateRequirementOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) list_requirements: orderbook, list own resting orders */
export interface ListRequirementsInput {
  status?: string;
}

/** (free L0) list_requirements: output */
export interface ListRequirementsOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) get_requirement: orderbook, read one own order */
export interface GetRequirementInput {
  requirement_id: string;
}

/** (free L0) get_requirement: output */
export interface GetRequirementOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) cancel_requirement: orderbook, cancel an order */
export interface CancelRequirementInput {
  requirement_id: string;
}

/** (free L0) cancel_requirement: output */
export interface CancelRequirementOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L1) poll_requirement_matches: orderbook deferred-delivery match reveal */
export interface PollRequirementMatchesInput {
  requirement_id: string;
  max?: number;
  _payment?: ProvenanceToken;
}

/** (free L1) poll_requirement_matches: output */
export interface PollRequirementMatchesOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) dispute_attestation: attestation dispute */
export interface DisputeAttestationInput {
  attestation_id: string;
  reason: string;
}

/** (free L0) dispute_attestation: output */
export interface DisputeAttestationOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) describe_traits: canonical trait vocabulary reference (query_field companion) */
export type DescribeTraitsInput = Record<string, never>;

/** (free L0) describe_traits: output */
export interface DescribeTraitsOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (free L0) describe_competencies: published competency vocabulary (query_field companion) */
export type DescribeCompetenciesInput = Record<string, never>;

/** (free L0) describe_competencies: output */
export interface DescribeCompetenciesOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (premium L1) attest_domain: domain attestation ($0.01) */
export interface AttestDomainInput {
  member_id: string;
  domain_label: string;
  confidence: number;
  evidence_type: "OBSERVED" | "INFERRED" | "REPORTED";
  evidence_summary?: string;
  _payment?: ProvenanceToken;
}

/** (premium L1) attest_domain: output */
export interface AttestDomainOutput {
  ok: boolean;
  [key: string]: unknown;
}

/** (premium L5) query_field: situation-driven open field query ($1.00) */
export interface QueryFieldInput {
  trait_priorities: Record<string, number>;
  context?: string;
  exclude_member_ids?: string[];
  _payment?: ProvenanceToken;
}

/** (premium L5) query_field: output */
export interface QueryFieldOutput {
  ok: boolean;
  [key: string]: unknown;
}

// =============================================================================
// Tool name registries
// =============================================================================

/** Free (L0) tool names: readonly tuple. Mirrors the live server's `tools/list` free set. */
export const FREE_TOOL_NAMES = [
  "hello_agent",
  "get_started",
  "list_archetypes",
  "alter_resolve_handle",
  "verify_identity",
  "register_autonomous_challenge",
  "register_autonomous",
  "alter_presence_read",
  "alter_resolve_by_key",
  "get_engagement_level",
  "get_profile",
  "query_matches",
  "get_competencies",
  "create_identity_stub",
  "search_identities",
  "create_requirement",
  "demand_board",
  "list_requirements",
  "get_requirement",
  "cancel_requirement",
  "poll_requirement_matches",
  "create_offer",
  "list_offers",
  "get_offer",
  "withdraw_offer",
  "list_plugins",
  "submit_plugin",
  "get_identity_earnings",
  "get_network_stats",
  "get_identity_trust_score",
  "get_privacy_budget",
  "dispute_attestation",
  "golden_thread_status",
  "begin_golden_thread",
  "complete_knot",
  "check_golden_thread",
  "describe_traits",
  "describe_competencies",
] as const;

/** Premium (x402-gated, L1-L5) tool names: readonly tuple. Mirrors the live server's `tools/list` premium set. */
export const PREMIUM_TOOL_NAMES = [
  "get_trait_snapshot",
  "get_full_trait_vector",
  "compute_belonging",
  "get_match_recommendations",
  "generate_match_narrative",
  "attest_domain",
  "get_side_quest_graph",
  "query_graph_similarity",
  "query_field",
] as const;

/** Union of all tool names defined in this file (types.ts covers the core set). */
export type ToolName =
  | (typeof FREE_TOOL_NAMES)[number]
  | (typeof PREMIUM_TOOL_NAMES)[number];

// =============================================================================
// Tool input/output mapped types
// =============================================================================

export interface ToolInputs {
  // --- FREE tier (27): mirrors FREE_TOOL_NAMES ---
  hello_agent: HelloAgentInput;
  list_archetypes: ListArchetypesInput;
  alter_resolve_handle: AlterResolveHandleInput;
  verify_identity: VerifyIdentityInput;
  alter_presence_read: AlterPresenceReadInput;
  alter_resolve_by_key: AlterResolveByKeyInput;
  get_engagement_level: GetEngagementLevelInput;
  get_profile: GetProfileInput;
  query_matches: QueryMatchesInput;
  get_competencies: GetCompetenciesInput;
  create_identity_stub: CreateIdentityStubInput;
  search_identities: SearchIdentitiesInput;
  create_requirement: CreateRequirementInput;
  list_requirements: ListRequirementsInput;
  get_requirement: GetRequirementInput;
  cancel_requirement: CancelRequirementInput;
  poll_requirement_matches: PollRequirementMatchesInput;
  get_identity_earnings: GetIdentityEarningsInput;
  get_network_stats: GetNetworkStatsInput;
  get_identity_trust_score: GetIdentityTrustScoreInput;
  get_privacy_budget: GetPrivacyBudgetInput;
  dispute_attestation: DisputeAttestationInput;
  golden_thread_status: GoldenThreadStatusInput;
  begin_golden_thread: BeginGoldenThreadInput;
  complete_knot: CompleteKnotInput;
  check_golden_thread: CheckGoldenThreadInput;
  describe_traits: DescribeTraitsInput;
  describe_competencies: DescribeCompetenciesInput;
  // --- PREMIUM tier (9): mirrors PREMIUM_TOOL_NAMES ---
  get_trait_snapshot: GetTraitSnapshotInput;
  get_full_trait_vector: GetFullTraitVectorInput;
  compute_belonging: ComputeBelongingInput;
  get_match_recommendations: GetMatchRecommendationsInput;
  generate_match_narrative: GenerateMatchNarrativeInput;
  attest_domain: AttestDomainInput;
  get_side_quest_graph: GetSideQuestGraphInput;
  query_graph_similarity: QueryGraphSimilarityInput;
  query_field: QueryFieldInput;
}

export interface ToolOutputs {
  // --- FREE tier (27): mirrors FREE_TOOL_NAMES ---
  hello_agent: HelloAgentOutput;
  list_archetypes: ListArchetypesOutput;
  alter_resolve_handle: AlterResolveHandleOutput;
  verify_identity: VerifyIdentityOutput;
  alter_presence_read: AlterPresenceReadOutput;
  alter_resolve_by_key: AlterResolveByKeyOutput;
  get_engagement_level: GetEngagementLevelOutput;
  get_profile: GetProfileOutput;
  query_matches: QueryMatchesOutput;
  get_competencies: GetCompetenciesOutput;
  create_identity_stub: CreateIdentityStubOutput;
  search_identities: SearchIdentitiesOutput;
  create_requirement: CreateRequirementOutput;
  list_requirements: ListRequirementsOutput;
  get_requirement: GetRequirementOutput;
  cancel_requirement: CancelRequirementOutput;
  poll_requirement_matches: PollRequirementMatchesOutput;
  get_identity_earnings: GetIdentityEarningsOutput;
  get_network_stats: GetNetworkStatsOutput;
  get_identity_trust_score: GetIdentityTrustScoreOutput;
  get_privacy_budget: GetPrivacyBudgetOutput;
  dispute_attestation: DisputeAttestationOutput;
  golden_thread_status: GoldenThreadStatusOutput;
  begin_golden_thread: BeginGoldenThreadOutput;
  complete_knot: CompleteKnotOutput;
  check_golden_thread: CheckGoldenThreadOutput;
  describe_traits: DescribeTraitsOutput;
  describe_competencies: DescribeCompetenciesOutput;
  // --- PREMIUM tier (9): mirrors PREMIUM_TOOL_NAMES ---
  get_trait_snapshot: GetTraitSnapshotOutput;
  get_full_trait_vector: GetFullTraitVectorOutput;
  compute_belonging: ComputeBelongingOutput;
  get_match_recommendations: GetMatchRecommendationsOutput;
  generate_match_narrative: GenerateMatchNarrativeOutput;
  attest_domain: AttestDomainOutput;
  get_side_quest_graph: GetSideQuestGraphOutput;
  query_graph_similarity: QueryGraphSimilarityOutput;
  query_field: QueryFieldOutput;
}

// =============================================================================
// Tool tier / cost / blast-radius registries
// Source of truth: ~Alter's live MCP pricing surface.
// =============================================================================

/**
 * Tool tier mapping (L0=free, L1-L5=paid).
 * Mirrors the live MCP per-invocation tier mapping.
 */
export const TOOL_TIERS: Record<ToolName, number> = {
  // L0 (free)
  hello_agent: 0,
  get_started: 0,
  list_archetypes: 0,
  alter_resolve_handle: 0,
  verify_identity: 0,
  register_autonomous_challenge: 0,
  register_autonomous: 0,
  alter_presence_read: 0,
  alter_resolve_by_key: 0,
  get_engagement_level: 0,
  get_profile: 0,
  query_matches: 0,
  get_competencies: 0,
  create_identity_stub: 0,
  search_identities: 0,
  create_requirement: 0,
  list_requirements: 0,
  get_requirement: 0,
  cancel_requirement: 0,
  demand_board: 0,
  create_offer: 0,
  list_offers: 0,
  get_offer: 0,
  withdraw_offer: 0,
  get_identity_earnings: 0,
  get_network_stats: 0,
  get_identity_trust_score: 0,
  get_privacy_budget: 0,
  dispute_attestation: 0,
  golden_thread_status: 0,
  begin_golden_thread: 0,
  complete_knot: 0,
  check_golden_thread: 0,
  describe_traits: 0,
  describe_competencies: 0,
  // Community plugin directory. Both carry the free_tools scope server-side.
  // They also sit in TOOLS_REQUIRING_AUTH, which governs who may call them,
  // never what they cost: a keyed caller browses and submits for nothing.
  list_plugins: 0,
  submit_plugin: 0,
  // L1
  poll_requirement_matches: 1,
  get_trait_snapshot: 1,
  attest_domain: 1,
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
  query_field: 5,
};

/**
 * Tool price in USD per invocation.
 * Mirrors the live MCP per-invocation pricing.
 * Free tools (L0) are 0.
 */
export const TOOL_COSTS: Record<ToolName, number> = {
  // L0 free
  hello_agent: 0,
  get_started: 0,
  list_archetypes: 0,
  alter_resolve_handle: 0,
  verify_identity: 0,
  register_autonomous_challenge: 0,
  register_autonomous: 0,
  alter_presence_read: 0,
  alter_resolve_by_key: 0,
  get_engagement_level: 0,
  get_profile: 0,
  query_matches: 0,
  get_competencies: 0,
  create_identity_stub: 0,
  search_identities: 0,
  create_requirement: 0,
  list_requirements: 0,
  get_requirement: 0,
  cancel_requirement: 0,
  demand_board: 0,
  create_offer: 0,
  list_offers: 0,
  get_offer: 0,
  withdraw_offer: 0,
  get_identity_earnings: 0,
  get_network_stats: 0,
  get_identity_trust_score: 0,
  get_privacy_budget: 0,
  dispute_attestation: 0,
  golden_thread_status: 0,
  begin_golden_thread: 0,
  complete_knot: 0,
  check_golden_thread: 0,
  describe_traits: 0,
  describe_competencies: 0,
  // Community plugin directory, free at the tier and free at the till.
  list_plugins: 0,
  submit_plugin: 0,
  // L1 ($0.01)
  poll_requirement_matches: 0.01,
  get_trait_snapshot: 0.01,
  attest_domain: 0.01,
  // L2 ($0.10)
  get_full_trait_vector: 0.1,
  get_side_quest_graph: 0.1,
  // L3 ($0.30)
  query_graph_similarity: 0.3,
  // L4 ($0.60)
  compute_belonging: 0.6,
  // L5 ($1.00)
  get_match_recommendations: 1.0,
  generate_match_narrative: 1.0,
  query_field: 1.0,
};

/**
 * Blast radius classification: categorises tools by potential impact.
 * Mirrors the live MCP blast-radius classification.
 */
export const TOOL_BLAST_RADIUS: Record<ToolName, "low" | "medium" | "high"> = {
  // Low: read-only reference
  hello_agent: "low",
  get_started: "low",
  alter_resolve_handle: "low",
  list_archetypes: "low",
  verify_identity: "low",
  register_autonomous_challenge: "low",
  alter_presence_read: "low",
  alter_resolve_by_key: "low",
  get_engagement_level: "low",
  get_network_stats: "low",
  get_privacy_budget: "low",
  golden_thread_status: "low",
  begin_golden_thread: "low",
  check_golden_thread: "low",
  get_identity_earnings: "low",
  get_identity_trust_score: "low",
  list_requirements: "low",
  get_requirement: "low",
  demand_board: "low",
  list_offers: "low",
  get_offer: "low",
  describe_traits: "low",
  describe_competencies: "low",
  list_plugins: "low",
  // Medium: writes data or searches
  submit_plugin: "medium",
  search_identities: "medium",
  get_profile: "medium",
  query_matches: "medium",
  get_competencies: "medium",
  complete_knot: "medium",
  create_identity_stub: "medium",
  register_autonomous: "medium",
  create_requirement: "medium",
  cancel_requirement: "medium",
  create_offer: "medium",
  withdraw_offer: "medium",
  poll_requirement_matches: "medium",
  dispute_attestation: "medium",
  attest_domain: "medium",
  get_trait_snapshot: "medium",
  // High: returns sensitive identity data or computes scores
  get_full_trait_vector: "high",
  compute_belonging: "high",
  get_match_recommendations: "high",
  generate_match_narrative: "high",
  get_side_quest_graph: "high",
  query_graph_similarity: "high",
  query_field: "high",
};
