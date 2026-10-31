import { createApp } from './app';
import { config } from './config';
import { processJobs } from './anomalies';
import { generateRecurring } from './recurring';
import { pool } from './db';
import { databaseCode, failureStage } from './errors';
import { diagnostic } from './diagnostics';

export async function startServer() {
  await pool.query('SELECT 1');
  const app = createApp();
  const server = app.listen(config.port, config.listenHost, () =>
    console.log(`Daybook API http://127.0.0.1:${config.port}`),
  );
  let busy = false,
    lastSchedule = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (Date.now() - lastSchedule > 60000) {
        await generateRecurring(config.organizationId);
        lastSchedule = Date.now();
      }
      await processJobs();
    } catch (error) {
      diagnostic('worker_error', {
        code: 'WORKER_ERROR',
        stage: failureStage(error) ?? 'background',
        databaseCode: databaseCode(error),
      });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 2000);
  void tick();
  server.on('close', () => clearInterval(timer));
  return server;
}
if (process.argv[1]?.endsWith('/server/index.ts')) {
  const server = await startServer();
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        void pool.end().then(() => process.exit(0));
      });
    });
}
