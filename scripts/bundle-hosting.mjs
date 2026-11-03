import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Inline the existing extensionless TypeScript imports into native Node ESM.
// Keep npm dependencies external for Vercel's dependency tracing.
const built = await build({
  entryPoints: {
    index: 'server/hosting/index.ts',
    cron: 'server/hosting/cron.ts',
    'analysis-program': 'server/analysis-program.ts',
  },
  outdir: '.vercel-build',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node22',
  metafile: true,
});

// This separate entry uses the same compiler/runtime configuration as the API,
// while allowing CI to instantiate its WASM engine without database/provider
// configuration. Explicitly retain the separate WASM file via vercel.json.
const entry = '.vercel-build/analysis-program.js';
const wasm = 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputs = Object.keys(built.metafile.outputs[entry].inputs).sort();
const sourceHashes = Object.fromEntries(
  await Promise.all(inputs.map(async (path) => [path, sha256(await readFile(path))])),
);
await writeFile(
  '.vercel-build/analysis-runtime-manifest.json',
  JSON.stringify(
    {
      entry,
      sourceHashes,
      bundleSha256: sha256(await readFile(entry)),
      wasm,
      wasmSha256: sha256(await readFile(wasm)),
      externalImports: built.metafile.outputs[entry].imports,
    },
    null,
    2,
  ) + '\n',
);
