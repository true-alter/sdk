/**
 * @truealter/sdk — theme pack types (D-CUST-1 substrate, Wave 2)
 *
 * Wire-format types for ALTER theme packs and `themes.lock` composition
 * manifests. The full specification lives in
 * `docs/technical/alter-theme-pack-spec-v1.md`; the architecture spike
 * (with threat model F1–F10) lives in
 * `.repos/internal/02-Technical-Strategy/alter-theme-packs-architecture-spike.md`.
 *
 * These types describe the on-the-wire shape of theme manifests as they
 * are produced by `alter theme install`, persisted to `themes.lock`,
 * and shared via the `theme_share` MCP tool. They do NOT describe the
 * runtime renderer's internal state.
 *
 * No runtime side effects, no external imports, ESM-compatible.
 */

// =============================================================================
// Pack manifest (theme.toml v1)
// =============================================================================

/** The single allowed `palette.floor` value in v1. New floors require schema bump. */
export type PaletteFloorV1 = "muted-gold";

/** Enumerated text-style values. Free strings are rejected by the loader. */
export type PaletteText = "default" | "high-contrast" | "warm";

/** Enumerated status-line slot names. Packs MAY use a permutation of any subset. */
export type StatusLineSlot =
  | "handle"
  | "attunement"
  | "seat"
  | "thread_strand"
  | "pronouns"
  | "org";

/** Enumerated status-line density. */
export type StatusLineDensity = "compact" | "roomy";

/** Enumerated greeting-register values. Passes to the Mirror voice register selector. */
export type GreetingRegister = "intimate" | "formal" | "playful" | "spare";

/** Enumerated panel-density values for `alter room`. */
export type PanelDensity = "compact" | "roomy";

/** `[meta]` section. */
export interface ThemeMeta {
  name: string;
  /** SemVer-shaped recommended; informational only. Resolution uses pack_id. */
  version: string;
  /** MUST be a ~handle whose D-ID8 public key signs the pack. */
  author: string;
  /** ≤ 240 characters after NFC. */
  description: string;
  /** OPTIONAL — surfaced by curated resolvers; not rendered by ALTER. */
  repo?: string;
  /** OPTIONAL — surfaced by curated resolvers; not rendered by ALTER. */
  docs_url?: string;
}

/** `[palette]` section. Renderer enforces gamut; out-of-gamut packs are rejected. */
export interface ThemePalette {
  floor: PaletteFloorV1;
  /** Hex colour clamped to the published accent-slot gamut. */
  accent: string;
  text: PaletteText;
}

/** `[opener]` section. */
export interface ThemeOpener {
  /** ≤ 32 entries, each ≤ 240 chars after sanitisation. `~` substitutes the active handle. */
  library: readonly string[];
}

/** `[sigil]` section. All values MUST refer to renderer-shipped typed primitives. */
export interface ThemeSigil {
  glyph_set: string;
  trill: string;
  accent_glyph: string;
}

/** `[status_line]` section. */
export interface ThemeStatusLine {
  /** Permutation of any subset of StatusLineSlot. */
  order: readonly StatusLineSlot[];
  density: StatusLineDensity;
}

/** `[render_hints]` section. */
export interface ThemeRenderHints {
  greeting_register: GreetingRegister;
  panel_density: PanelDensity;
}

/** `[assets]` section. Paths MUST be repo-relative without `..` segments. */
export interface ThemeAssets {
  /** Optional — if omitted, no assets are loaded. */
  glyphs?: readonly string[];
}

/**
 * Complete pack manifest (the parsed-TOML shape of `theme.toml` v1).
 *
 * Closed-world: any unknown top-level key MUST cause the loader to
 * reject the pack. Parsers consuming an arbitrary TOML file should
 * narrow against this type rather than infer.
 */
export interface ThemeManifestV1 {
  schema_version: 1;
  meta: ThemeMeta;
  palette: ThemePalette;
  opener?: ThemeOpener;
  sigil?: ThemeSigil;
  status_line?: ThemeStatusLine;
  render_hints?: ThemeRenderHints;
  assets?: ThemeAssets;
}

// =============================================================================
// Signature manifest (theme.sig)
// =============================================================================

/**
 * The `.sig` file accompanying every pack. Verification logic lives in
 * `alter-cli/src/theme/sign.ts`; this is the wire-format type only.
 */
export interface ThemeSignatureManifest {
  /** SHA-256 multihash of the canonical-form pack. */
  pack_id: string;
  /** ~handle of the signer; MUST equal manifest.meta.author. */
  signer: string;
  /** RFC 3339 UTC timestamp at signing time. */
  signed_at: string;
  /** `ed25519:<base64url-encoded-signature>`. */
  sig: string;
}

// =============================================================================
// Lockfile (themes.lock v1)
// =============================================================================

/** One pack entry in the user-side composition lockfile. */
export interface ThemeLockEntry {
  /**
   * Where the pack was resolved from. One of:
   *   - `git+<url>#<ref>`   git-URL pin
   *   - `@<author>/<name>`  curated-resolver tuple
   *   - `path:<rel-path>`   local-path pin (for development)
   */
  source: string;
  pack_id: string;
  signer: string;
  /** Higher wins on slot conflict; equal priority breaks lex by pack_id. */
  priority: number;
}

/**
 * The user-side composition manifest. This is the publishable artefact
 * — what someone shares when they say "here is my ALTER".
 *
 * Re-applying the same lockfile against the same renderer version MUST
 * produce a bit-identical render, modulo the `attunement_glyph` field
 * which is derived per-render from the user's identity vector.
 */
export interface ThemesLockV1 {
  schema_version: 1;
  /** e.g. "alter-cli/0.5.0" — informational, not load-bearing. */
  generated_by: string;
  /** RFC 3339 UTC timestamp at lockfile-write time. */
  generated_at: string;
  pack: readonly ThemeLockEntry[];
  /**
   * User-side per-slot overrides applied AFTER pack composition. Keys
   * are dotted slot names (e.g. `palette.accent`, `sigil.trill`).
   * Values must match the slot's enumerated set or gamut.
   */
  overrides?: Readonly<Record<string, string | number | boolean>>;
}

// =============================================================================
// theme_share MCP tool (D-CUST-1 Wave 2)
// =============================================================================

/**
 * Input arguments for the `theme_share` MCP tool. Sharing emits a 5:1
 * return event to the sharer (recognition credit + pack citation) and
 * to the recipient (discovery signal). Implementation lives in
 * `mcp-alter` per D-RS15.
 */
export interface ThemeShareInput {
  /** Recipient ~handle. */
  to: string;
  /** Pack source the recipient should resolve. Same shape as ThemeLockEntry.source. */
  source: string;
  /** Expected pack_id for verification. Sharer asserts they have verified this. */
  pack_id: string;
  /** Expected signer ~handle. Sharer asserts the signature checks against this signer. */
  signer: string;
  /** Optional one-line note shown to the recipient on receipt. ≤ 280 chars. */
  note?: string;
}

/** Output of the `theme_share` MCP tool. */
export interface ThemeShareOutput {
  ok: boolean;
  share_id?: string;
  error?: {
    code: string;
    message: string;
  };
}

// =============================================================================
// Constants
// =============================================================================

/** v1 schema constants. Mirror the spec at docs/technical/alter-theme-pack-spec-v1.md. */
export const THEME_LIMITS = {
  meta_name_pattern: /^[a-z][a-z0-9-]{0,63}$/,
  meta_description_max_chars: 240,
  opener_library_max_entries: 32,
  opener_entry_max_chars: 240,
  share_note_max_chars: 280,
} as const;

/** Allowed OSC-8 hyperlink schemes. Mirrors §6.2 of the spec. */
export const OSC8_ALLOWED_SCHEMES = ["https:", "mailto:"] as const;
export type Osc8AllowedScheme = (typeof OSC8_ALLOWED_SCHEMES)[number];
