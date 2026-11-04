import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { verifyDatabase } from './database';
import { FixtureError, requireFixture } from './references';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'database-name': { type: 'string' }, output: { type: 'string' } },
  });
  requireFixture(
    positionals.length === 1 && ['seed-check', 'verify'].includes(positionals[0]),
    'USAGE_SEED_CHECK_OR_VERIFY',
  );
  const ownerUrl = process.env.ANALYST_FIXTURE_OWNER_URL;
  requireFixture(ownerUrl && values['database-name'], 'EXPLICIT_DATABASE_ENV_AND_NAME_REQUIRED');
  const receipt = await verifyDatabase(
    ownerUrl,
    values['database-name'],
    positionals[0] as 'seed-check' | 'verify',
  );
  const json = JSON.stringify(receipt, null, 2) + '\n';
  if (values.output) writeFileSync(values.output, json, { flag: 'wx', mode: 0o600 });
  process.stdout.write(json);
}

main().catch((error: unknown) => {
  // PostgreSQL errors and URLs may contain credentials. Only emit our finite codes.
  console.error(
    JSON.stringify({
      ok: false,
      code: error instanceof FixtureError ? error.code : 'FIXTURE_VERIFICATION_FAILED',
    }),
  );
  process.exitCode = 1;
});
