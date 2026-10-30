import EmbeddedPostgres from 'embedded-postgres';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
export async function startLocalPostgres() {
  const databaseDir = resolve('.tools/postgres');
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'spiich',
    password: 'spiich',
    port: 55432,
    persistent: true,
    onLog: () => {},
    onError: (message: unknown) => console.error(message),
  });
  if (!existsSync(`${databaseDir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='spiich'")).rowCount)
    await client.query('CREATE DATABASE spiich');
  await client.end();
  console.log('PostgreSQL is ready on 127.0.0.1:55432. Development data lives in .tools/postgres.');
  return pg;
}
if (process.argv[1]?.endsWith('local-postgres.ts')) {
  const pg = await startLocalPostgres();
  const timer = setInterval(() => {}, 60000);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      await pg.stop();
      process.exit(0);
    });
}
