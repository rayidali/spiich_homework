import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startLocalPostgres } from './local-postgres';
import { migrate } from './migrate';
import { config } from '../server/config';

if (process.argv.includes('--test') || process.argv.includes('--test-browser')) process.env.NODE_ENV = 'test';

// The portable development command starts an isolated real PostgreSQL server when
// no external database is supplied. Docker Compose uses its own PostgreSQL service.
const local = !process.env.DATABASE_URL && !process.argv.includes('--reuse-db');
const postgres = local ? await startLocalPostgres() : null;
await migrate();
const browser = process.argv.includes('--test-browser');
if (browser) {
  config.organizationId = randomUUID();
  config.port = 3002;
  config.webOrigin = 'http://127.0.0.1:5174';
  // Browser workflows use their own organization and never spend a configured model key.
  // Live provider checks belong to the explicitly invoked evaluation harness.
  config.aiKey = '';
}
const { seed } = await import('./seed');
await seed();
const { pool } = await import('../server/db');
if (process.argv.includes('--test') || process.argv.includes('--test-browser')) {
  let api: import('node:http').Server | undefined, web: import('vite').ViteDevServer | undefined;
  if (browser) {
    const { startServer } = await import('../server/index');
    api = await startServer();
    if (!process.argv.includes('--production')) {
      const { createServer } = await import('vite');
      web = await createServer({
        server: { port: 5174, host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3002' } },
      });
      await web.listen();
    }
  }
  const child = spawn(
    process.execPath,
    browser ? ['node_modules/@playwright/test/cli.js', 'test'] : ['node_modules/vitest/vitest.mjs', 'run'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ...(browser
          ? {
              PLAYWRIGHT_BASE_URL: process.argv.includes('--production')
                ? 'http://127.0.0.1:3002'
                : 'http://127.0.0.1:5174',
            }
          : {}),
      },
    },
  );
  child.on('exit', async (code) => {
    api?.close();
    await web?.close();
    await pool.end();
    await postgres?.stop();
    process.exit(code ?? 1);
  });
} else {
  const { startServer } = await import('../server/index');
  const api = await startServer();
  const { createServer } = await import('vite');
  const web = await createServer();
  await web.listen();
  web.printUrls();
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await web.close();
      await pool.end();
      await postgres?.stop();
      process.exit(0);
    });
}
