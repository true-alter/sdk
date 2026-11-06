import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

// Single-source the published version: read it from package.json at build
// time and inject it as `__SDK_VERSION__` (consumed by src/meta.ts). This
// stops the version constant from drifting from the package manifest.
const PKG_VERSION = JSON.parse(readFileSync('./package.json', 'utf8')).version as string;
const define = { __SDK_VERSION__: JSON.stringify(PKG_VERSION) };

// Two builds: the library (ESM + CJS, no shebang) and the CLI (ESM, with
// shebang). Splitting them keeps the library tree-shakeable and avoids
// double-banner issues — the CLI source already declares its own shebang.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    define,
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    // Library sourcemaps ship the full TypeScript source to any npm consumer
    // via the package allowlist — keep library drop off-map.
    sourcemap: false,
    clean: true,
    target: 'node18',
    platform: 'neutral',
    // Mark all Node built-ins external so the neutral bundle never emits
    // the __require dynamic-require shim for them. The shim throws
    // "Dynamic require of X is not supported" in ESM contexts (Node 18+,
    // type:module packages), which surfaced as the wire/claude-code path
    // failing with "Dynamic require of fs is not supported".
    // The prior external list only contained 'node:crypto'; extending to all
    // node: builtins is the defensive fix -- no Node consumer needs these
    // bundled, and non-Node consumers never hit the branches that use them.
    external: [
      'node:crypto', 'node:fs', 'node:path', 'node:url',
      'node:os', 'node:child_process', 'node:module',
      'node:stream', 'node:util', 'node:events', 'node:buffer',
      'node:net', 'node:http', 'node:https', 'node:tls',
      'crypto', 'fs', 'path', 'url', 'os', 'child_process',
      'module', 'stream', 'util', 'events', 'buffer',
      'net', 'http', 'https', 'tls', 'process',
    ],
    shims: true,
    treeshake: true,
    outDir: 'dist',
  },
  {
    // The standalone `bin/alter-identity` admin CLI is no longer built: the
    // SDK exposes no `bin` (the `alter` CLI owns the user-facing surface), so
    // a second built binary would be dead weight. Only the bridge entrypoint
    // ships. `alter mcp-bridge` resolves dist/bin/mcp-bridge.js by path via
    // require.resolve("@truealter/sdk"), so it must stay in the tarball.
    entry: {
      'bin/mcp-bridge': 'bin/mcp-bridge.ts',
    },
    define,
    format: ['esm'],
    dts: false,
    splitting: false,
    // CLI sourcemaps also ship via package.json "dist/" allowlist — disable
    // to prevent full TypeScript source leaking to npm consumers (sdk/H-1).
    sourcemap: false,
    clean: false,
    target: 'node18',
    platform: 'node',
    shims: false,
    treeshake: true,
    outDir: 'dist',
  },
]);
