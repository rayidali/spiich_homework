import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEvaluationTransport } from '../completion-repair-evaluation/transport';
import { outcomeWriter, privateJson, runConversations } from '../conversation-acceptance/runner';
import { safeCode } from '../conversation-acceptance/protocol';
import { cases, clock, type Case } from './specification';
import { seedDatabase } from './database';
import { assess } from './scoring';
import {
  sourceBinding,
  validateApproval,
  verifyCommittedSource,
  requireCondition,
  databaseTarget,
} from './protocol';
export async function execute(approvalPath: string, approvalHash: string) {
  const root = process.cwd();
  requireCondition(
    process.env.NODE_ENV === 'test' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true',
    'CI_REQUIRED',
  );
  requireCondition(
    lstatSync(approvalPath).isFile() && !lstatSync(approvalPath).isSymbolicLink(),
    'APPROVAL_FILE',
  );
  const source = sourceBinding(root),
    key = process.env.GEMINI_API_KEY?.trim() ?? '';
  const approval = validateApproval(readFileSync(approvalPath, 'utf8'), approvalHash, source.hash, key);
  verifyCommittedSource(root, approval.sourceCommit, source);
  const ownerUrl = process.env.FLEXIBLE_OWNER_DATABASE_URL ?? '',
    runtimeUrl = process.env.FLEXIBLE_DATABASE_URL ?? '';
  databaseTarget(ownerUrl, runtimeUrl, approval.databaseName);
  process.env.DATABASE_URL = runtimeUrl;
  process.env.MIGRATION_DATABASE_URL = ownerUrl;
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_MODEL = approval.model;
  process.env.GEMINI_API_KEY = key;
  const base = join(root, '.tools/flexible-analytics-runs');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  requireCondition(!lstatSync(base).isSymbolicLink(), 'OUTPUT_DIRECTORY');
  const directory = join(base, approval.cohort);
  mkdirSync(directory, { mode: 0o700 });
  privateJson(join(directory, 'source.json'), source);
  privateJson(join(directory, 'approval.json'), approval);
  const write = outcomeWriter(directory);
  let database: Awaited<ReturnType<typeof seedDatabase>> | undefined;
  let transport: ReturnType<typeof createEvaluationTransport> | undefined;
  let restore: (() => void) | undefined;
  let pool: { end(): Promise<void> } | undefined;
  let result: Awaited<ReturnType<typeof runConversations>> | null = null;
  let failure: string | null = null;
  let after: Awaited<ReturnType<Awaited<ReturnType<typeof seedDatabase>>['fingerprint']>> | null = null;
  let budget: unknown = null;
  const cleanupErrors: string[] = [];
  try {
    database = await seedDatabase(ownerUrl, runtimeUrl, approval.databaseName, root);
    privateJson(join(directory, 'database-before.json'), {
      ...database.before,
      storedLineChecks: database.storedLineChecks,
      oracleChecks: database.oracleChecks,
    });
    const app = await import('../../server/ai');
    pool = (await import('../../server/db')).pool;
    const config = (await import('../../server/config')).config;
    requireCondition(
      config.aiProvider === 'gemini' &&
        config.aiModel === approval.model &&
        config.aiKey === key &&
        config.databaseUrl === runtimeUrl,
      'RUNTIME_CONFIG',
    );
    const upstream = globalThis.fetch.bind(globalThis);
    const revalidate = () =>
      validateApproval(
        readFileSync(approvalPath, 'utf8'),
        approvalHash,
        sourceBinding(root).hash,
        config.aiKey,
      );
    transport = createEvaluationTransport(
      {
        directory: join(directory, 'transport'),
        model: approval.model,
        apiKey: key,
        expectedKeySha256: approval.keySha256,
        ceilingUsd: approval.ceilingUsd,
        maxAttempts: approval.maxAttempts,
        inputUsdPerMillion: approval.inputUsdPerMillion,
        outputUsdPerMillion: approval.outputUsdPerMillion,
        maxRequestBytes: approval.maxRequestBytes,
        reservationBasis: approval.reservationBasis,
      },
      async (input, init) => {
        revalidate();
        return upstream(input, init);
      },
    );
    restore = transport.install();
    const fixture = database;
    result = await runConversations({
      selectedCases: cases,
      transport,
      chat: (messages) => app.financialChat(fixture.org, messages, { route: 'composable', asOfDate: clock }),
      assess: (item, turn, response) => assess(item as Case, turn, response, fixture.org),
      beforeTurn: () => {
        revalidate();
      },
      afterTurn: async () =>
        requireCondition((await fixture.fingerprint()).hash === fixture.before.hash, 'BOOKS_CHANGED'),
      write,
    });
  } catch (error) {
    failure = safeCode(error);
  } finally {
    if (restore)
      try {
        restore();
      } catch {
        cleanupErrors.push('FETCH_RESTORE_FAILED');
      }
    if (transport)
      try {
        budget = transport.close();
      } catch {
        cleanupErrors.push('TRANSPORT_CLOSE_FAILED');
        budget = { unavailable: true, inspectPrivateLedger: true };
      }
    if (database) {
      try {
        after = await database.fingerprint();
        requireCondition(after.hash === database.before.hash, 'BOOKS_CHANGED');
      } catch {
        cleanupErrors.push('FINAL_FINGERPRINT_FAILED');
      }
      try {
        await database.close();
      } catch {
        cleanupErrors.push('DATABASE_CLOSE_FAILED');
      }
    }
    if (pool)
      try {
        await pool.end();
      } catch {
        cleanupErrors.push('POOL_CLOSE_FAILED');
      }
    try {
      requireCondition(sourceBinding(root).hash === source.hash, 'SOURCE_DRIFT');
    } catch {
      cleanupErrors.push('FINAL_SOURCE_DRIFT');
    }
  }
  const closure = {
    version: 'flexible-analytics-closure-v1',
    cohort: approval.cohort,
    sourceCommit: approval.sourceCommit,
    sourceHash: source.hash,
    status:
      failure || cleanupErrors.length || !result?.executionComplete
        ? 'STOPPED_INCOMPLETE'
        : 'EXECUTION_COMPLETE_REVIEW_PENDING',
    result,
    failure,
    cleanupErrors,
    budget,
    booksUnchanged: !!database && after?.hash === database.before.hash,
    after,
    semanticReview: 'pending',
    overallPass: false,
  };
  privateJson(join(directory, 'closure.json'), closure);
  return closure;
}
