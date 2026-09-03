/**
 * Package metadata: kept in a standalone module so deep imports from
 * `src/wire/` can reference version constants without creating a
 * circular dependency through `src/index.ts`.
 */

export const SDK_NAME = '@truealter/sdk';

// `__SDK_VERSION__` is injected at build time from package.json via the tsup
// `define` (see tsup.config.ts), so the published bundle reports the real
// package version. The literal fallback covers non-bundled consumption
// (ts-node, vitest against source) and is kept in lockstep with package.json.
declare const __SDK_VERSION__: string;
export const SDK_VERSION =
  typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.5.7';
