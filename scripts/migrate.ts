import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../server/config';
export async function migrate(url = config.migrationUrl) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('spiich:migrations'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = await readFile(`${dir}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = (await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]))
        .rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration ${name} has changed`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith('migrate.ts'))
  migrate().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
