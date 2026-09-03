/**
 * GENERATED: DO NOT EDIT BY HAND. The SDK's compiled mirror of ~Alter's live
 * MCP pricing surface: advertised tool counts, per-invocation tiers, and
 * per-invocation pricing.
 *
 * Regenerate via the SDK freshness gate. A freshness check runs at publish
 * time and fails if this file diverges from the live pricing surface.
 *
 * Canonical source of truth for x402 pricing and advertised tool counts inside
 * the SDK. Consumers should import from "@truealter/sdk" (re-exported via
 * index.ts), not from this module directly.
 */

// =============================================================================
// Tool tier mapping (L0=free, L1-L5=paid)
// Source: TOOL_TIERS in ~Alter's live MCP pricing surface.
// =============================================================================

/** Tool tier per invocation (0=free / L0, 1=L1, 2=L2, 3=L3, 4=L4, 5=L5). */
export const GENERATED_TOOL_TIERS: Record<string, number> = {
  // L0 (free)
  alter_presence_read: 0,
  alter_resolve_handle: 0,
  check_assessment_status: 0,
  create_identity_stub: 0,
  dispute_attestation: 0,
  get_competencies: 0,
  get_earning_summary: 0,
  get_engagement_level: 0,
  get_identity_earnings: 0,
  get_identity_trust_score: 0,
  get_network_stats: 0,
  get_privacy_budget: 0,
  get_profile: 0,
  get_started: 0,
  initiate_assessment: 0,
  list_archetypes: 0,
  query_matches: 0,
  recommend_tool: 0,
  search_identities: 0,
  verify_identity: 0,
  // L1 ($0.01)
  assess_traits: 1,
  attest_domain: 1,
  get_trait_snapshot: 1,
  poll_requirement_matches: 1,
  submit_context: 1,
  submit_social_links: 1,
  submit_structured_profile: 1,
  // L2 ($0.10)
  attest_claim_provenance: 2,
  get_full_trait_vector: 2,
  get_side_quest_graph: 2,
  submit_batch_context: 2,
  // L3 ($0.30)
  alter_alignment: 3,
  alter_graph: 3,
  alter_why: 3,
  query_graph_similarity: 3,
  // L4 ($0.60)
  compute_belonging: 4,
  // L5 ($1.00)
  generate_match_narrative: 5,
  get_match_recommendations: 5,
  query_field: 5,
} as const;

// =============================================================================
// Tool pricing (USD per invocation)
// Source: TOOL_PRICING in ~Alter's live MCP pricing surface.
// Free (L0) tools have price 0.
// =============================================================================

/** Price in USD per tool invocation. Mirrors the live MCP pricing surface. */
export const GENERATED_TOOL_PRICING: Record<string, number> = {
  // L1: $0.01
  assess_traits: 0.01,
  attest_domain: 0.01,
  get_trait_snapshot: 0.01,
  poll_requirement_matches: 0.01,
  submit_context: 0.01,
  submit_social_links: 0.01,
  submit_structured_profile: 0.01,
  // L2: $0.10
  attest_claim_provenance: 0.10,
  get_full_trait_vector: 0.10,
  get_side_quest_graph: 0.10,
  submit_batch_context: 0.10,
  // L3: $0.30
  alter_alignment: 0.30,
  alter_graph: 0.30,
  alter_why: 0.30,
  query_graph_similarity: 0.30,
  // L4: $0.60
  compute_belonging: 0.60,
  // L5: $1.00
  generate_match_narrative: 1.00,
  get_match_recommendations: 1.00,
  query_field: 1.00,
} as const;

// =============================================================================
// Per-tier flat rates
// Source: derived from TOOL_PRICING tiers
// =============================================================================

/** Flat price per tier in USD. L0 is always free. */
export const TIER_PRICES: Record<string, number> = {
  L0: 0.00,
  L1: 0.01,
  L2: 0.10,
  L3: 0.30,
  L4: 0.60,
  L5: 1.00,
} as const;

// =============================================================================
// Advertised tool counts
// Source: PUBLIC_ADVERTISED_TOOLS in ~Alter's live MCP tool registry
//         canonical-facts.json public_advertised block
// These are the counts shipped on .well-known/mcp.json and canonical-facts.json.
// =============================================================================

/** Publicly advertised tool counts. Mirrors canonical-facts.json public_advertised. */
export const ADVERTISED_TOOL_COUNTS = {
  /** Free (L0) tools visible to anonymous / agent-class callers. */
  free: 38,
  /** Premium (L1-L5) tools requiring x402 payment. */
  premium: 9,
  /** Messaging tools (member-self-only; excluded from external advertisement). */
  messaging: 0,
  /** Total publicly advertised (free + premium). */
  total: 47,
} as const;

// =============================================================================
// Revenue split (75/5/15/5)
// Source: canonical-facts.json pricing.revenue_split
// =============================================================================

/** x402 settlement revenue split. Weaver = the data subject earning Identity Income. */
export const REVENUE_SPLIT = {
  weaver: 0.75,   // data subject (Identity Income)
  facilitator: 0.05,
  alter: 0.15,
  treasury: 0.05,
} as const;
