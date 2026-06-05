/**
 * @truealter/sdk — alter_homepage MCP tool types
 *
 * Wire-format types for the user-authored, externally-queryable identity
 * homepage surface.
 *
 * Tool name note: shipping as `alter_homepage` because `alter_portfolio`
 * is already taken by the verified-attestations tool (different concept).
 * The wire-format and tool-name-on-server are `homepage`.
 *
 * Wire-format rule: every field name matches the JSON Schema property
 * name exactly (snake_case). These are passed straight into JSON-RPC
 * `arguments` and rendered straight from JSON-RPC `result`.
 */

/**
 * Provenance class for a HomepageManifest field. Determines how a
 * conforming MCP consumer renders the value:
 *
 * - `declared`: user wrote the literal value. Render verbatim.
 * - `derived`: computed from active + consented signals. Render with
 *   provenance class surfaced to the viewer (e.g. an italic gloss).
 * - `attested`: verified by a recognised entity (Org Alter, ceremony,
 *   external attester). Render with provenance + attester surfaced.
 */
export type HomepageFieldProvenance = "declared" | "derived" | "attested";

/**
 * One field of a HomepageManifest. Every field carries its provenance
 * class so MCP consumers can render appropriately. The `value` shape is
 * field-specific — this is a discriminated parent; consumers should
 * narrow on the manifest's field name, not on `value`'s runtime shape.
 */
export interface HomepageField<T = unknown> {
  /** The user-facing value. Type depends on which field this is. */
  value: T;
  /** Where this value comes from. */
  provenance: HomepageFieldProvenance;
  /**
   * For `attested` fields, the entity that attested. Optional on the
   * other provenance classes (where it would be redundant).
   */
  attester?: string;
}

/**
 * The wire-format manifest returned by `alter_homepage(handle)`.
 *
 * Fields are individually optional — a HomepageManifest with only a
 * handle and an opener is valid. MCP consumers MUST NOT assume any
 * field other than `handle` is present.
 */
export interface HomepageManifest {
  /** The ~handle being queried. Always present. */
  handle: string;

  /**
   * Single-line user-authored self-description. Maximum 240 chars
   * after NFC normalisation, after the install-time ANSI sanitiser
   * pass. Always declared-provenance.
   */
  whoami?: HomepageField<string>;

  /**
   * Rotating or static user-authored line. Maximum 280 chars after
   * NFC normalisation, after the install-time ANSI sanitiser pass.
   * The literal `~` substitutes the active handle at render time.
   * Always declared-provenance.
   */
  opener?: HomepageField<string>;

  /**
   * Composed-glyph string from typed primitives. The sigil is a string
   * of renderer-recognised primitive references — not raw glyph codes —
   * so different consumers can render the same sigil distinctly.
   * Provenance is `declared` for user-composed, `derived` for
   * sigil-from-thread-graph crystallisation.
   */
  sigil?: HomepageField<string>;

  /** User's pronouns (already-shipped surface). Always declared. */
  pronouns?: HomepageField<string>;

  /**
   * List of recognised Seat glyphs the holder is bound to. Provenance
   * is always `attested` (ceremony-attested, server-side resolved);
   * `attester` will be `~alter` for protocol-observed Seats.
   */
  seats?: HomepageField<readonly string[]>;

  /**
   * Glyph from the user's attunement-grade library. Provenance is
   * `derived` (from the user's identity vector); the underlying
   * computation is L3-local and the chosen glyph is declared-from-
   * derived-measure (user picks within a library gated by their
   * attunement grade).
   */
  attunement_glyph?: HomepageField<string>;

  /**
   * Optional, opt-in per query context. Coarse Golden-Thread summary;
   * provenance is `derived`. MCP consumers MUST NOT request this field
   * by default — only on explicit per-call consent. Consumers in the
   * workplace/education vertical MUST NOT request this field at all
   * (clause-4 caller-context gate).
   */
  thread_strand?: HomepageField<string>;

  /**
   * TOML block of MCP-consumer rendering hints (order, density, etc).
   * Consumers are free to ignore. Provenance is always `declared`.
   */
  render_hints?: HomepageField<Record<string, unknown>>;
}

/**
 * Input arguments for the `alter_homepage` MCP tool.
 *
 * The `fields` argument lets a consumer request a subset; omitting it
 * returns all fields the caller is permitted to read under the consent
 * + caller-context gates.
 */
export interface HomepageInput {
  /** The ~handle to query. */
  handle: string;
  /**
   * Optional whitelist of field names. If omitted, the server returns
   * all fields the caller is permitted to read. Unknown field names
   * are silently ignored (forward-compatible — adding a new field does
   * not break old consumers).
   */
  fields?: readonly (keyof HomepageManifest)[];
}

/**
 * Output of the `alter_homepage` MCP tool. The `manifest` field is
 * always present on `ok: true`; on error, the `error` field carries a
 * structured reason the user can act on.
 */
export interface HomepageOutput {
  ok: boolean;
  manifest?: HomepageManifest;
  error?: {
    code: string;
    message: string;
    data?: Record<string, unknown>;
  };
}

/**
 * Caller-context gate: which categories of caller may read which
 * provenance classes. Enforced server-side; documented here for SDK
 * consumers building higher-level wrappers.
 *
 * - `workplace` / `education` callers MUST NOT receive `derived` or
 *   `attested` provenance fields without explicit per-field consent
 *   (EU AI Act Art 5(1)(d) categorical).
 * - All other callers may read `declared` and `attested` fields by
 *   default; `derived` fields require stream-specific consent per
 *   IaI clause 5.
 */
export type HomepageCallerVertical =
  | "workplace"
  | "education"
  | "personal"
  | "civic"
  | "agent"
  | "unknown";

/** Maximum sizes from the spec. SDK consumers can use these to validate
 *  input before sending. */
export const HOMEPAGE_LIMITS = {
  whoami_max_chars: 240,
  opener_max_chars: 280,
  pronouns_max_chars: 32,
  attunement_glyph_max_chars: 16,
} as const;
