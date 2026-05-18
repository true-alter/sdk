import { defineConfig } from 'tsup';

// Two builds: the library (ESM + CJS, no shebang) and the CLI (ESM, with
// shebang). Splitting them keeps the library tree-shakeable and avoids
// double-banner issues — the CLI source already declares its own shebang.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    // Library sourcemaps ship the full TypeScript source to any npm consumer
    // via the package allowlist — keep library drop off-map.
    sourcemap: false,
    clean: true,
    target: 'node18',
    platform: 'neutral',
    // `signing.ts` lazy-requires `node:crypto` only for the PEM-input
    // branch of `loadPrivateKey`; mark it external so the neutral
    // bundle leaves the call intact for Node consumers, and enable
    // shims so the ESM build ships a `require` shim that can resolve
    // it at runtime. Non-Node consumers simply never hit the branch.
    external: ['node:crypto'],
    shims: true,
    treeshake: true,
    outDir: 'dist',
  },
  {
    entry: {
      'bin/alter-identity': 'bin/alter-identity.ts',
      'bin/mcp-bridge': 'bin/mcp-bridge.ts',
    },
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
