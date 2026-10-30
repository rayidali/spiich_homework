import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { setupDatabase } from '../../research/setup';
// Owner secret is only loaded by this provisioning CLI, never model/reader routes.
const owner =
  process.env.RESEARCH_OWNER_URL ||
  JSON.parse(readFileSync('.tools/vercel-session/deployment-env.json', 'utf8')).build.env
    .MIGRATION_DATABASE_URL;
try {
  console.log(JSON.stringify(await setupDatabase(owner)));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')
      : 'Research setup failed',
  );
  process.exitCode = 1;
}
