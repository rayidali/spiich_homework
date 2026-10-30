import pg from 'pg';

// Supply the owner URL only to the build, never the deployed function environment.
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!ownerUrl || !runtimeUrl) throw new Error('Hosting requires owner and restricted runtime URLs.');
const runtime = new URL(runtimeUrl);
const password = decodeURIComponent(runtime.password);
if (decodeURIComponent(runtime.username) !== 'spiich_app' || password.length < 32)
  throw new Error('Hosting requires spiich_app with a strong generated password.');

try {
  const { migrate } = await import('./migrate');
  await migrate(ownerUrl);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // PostgreSQL does not accept a bind parameter in ALTER ROLE; quote as a SQL literal.
    await client.query(`ALTER ROLE spiich_app PASSWORD '${password.replaceAll("'", "''")}'`);
  } finally {
    await client.end();
  }
  const { seed } = await import('./seed');
  await seed();
  console.log('Hosted migrations, restricted role and demo seed ready.');
} catch {
  // Driver errors can contain connection details. Keep build logs credential-free.
  console.error('Hosted database preparation failed; inspect the database privately.');
  process.exitCode = 1;
} finally {
  const { pool } = await import('../server/db');
  await pool.end();
}
