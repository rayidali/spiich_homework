import { build } from 'esbuild';

// Inline the existing extensionless TypeScript imports into native Node ESM.
// Keep npm dependencies external for Vercel's dependency tracing.
await build({
  entryPoints: ['server/hosting/index.ts', 'server/hosting/cron.ts'],
  outdir: '.vercel-build',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node22',
});
