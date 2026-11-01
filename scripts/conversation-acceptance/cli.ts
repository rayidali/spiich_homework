import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEvaluationTransport } from '../completion-repair-evaluation/transport';
import { clock } from '../../tests/conversation-acceptance/book';
import { cases, oracles } from '../../tests/conversation-acceptance/cases';
import { validateSpecification } from '../../tests/conversation-acceptance/validate';
import { seedDatabase } from './database';
import { assessTurn } from './scoring';
import { outcomeWriter, privateJson, runConversations } from './runner';
import {
  preparation,
  focusedPreparation,
  selectedCasesForApproval,
  sourceBinding,
  validateApproval,
  verifyCommittedSource,
  requireCondition,
  safeCode,
  databaseTarget,
} from './protocol';

export async function execute(approvalPath: string, approvalHash: string) {
  const root = process.cwd();
  requireCondition(process.env.NODE_ENV === 'test', 'TEST_ENVIRONMENT_REQUIRED');
  requireCondition(validateSpecification(cases, oracles).length === 0, 'INVALID_SPECIFICATION');
  const source = sourceBinding(root);
  const key = process.env.GEMINI_API_KEY?.trim() ?? '';
  const approvalFile = resolve(approvalPath);
  requireCondition(
    lstatSync(approvalFile).isFile() && !lstatSync(approvalFile).isSymbolicLink(),
    'APPROVAL_FILE',
  );
  const raw = readFileSync(approvalFile, 'utf8');
  const approval = validateApproval(raw, approvalHash, source.hash, key);
  const selectedCases = selectedCasesForApproval(approval);
  verifyCommittedSource(root, approval.sourceCommit, source);
  const ownerUrl = process.env.CONVERSATION_OWNER_DATABASE_URL ?? '';
  const runtimeUrl = process.env.CONVERSATION_DATABASE_URL ?? '';
  databaseTarget(ownerUrl, runtimeUrl, approval.databaseName);
  // All app imports occur after explicitly replacing database/provider settings.
  // dotenv's default non-overwrite behavior cannot substitute the production URL.
  process.env.DATABASE_URL = runtimeUrl;
  process.env.MIGRATION_DATABASE_URL = ownerUrl;
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_MODEL = approval.model;
  process.env.GEMINI_API_KEY = key;
  const base = join(root, '.tools', 'conversation-acceptance-runs');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  requireCondition(!lstatSync(base).isSymbolicLink(), 'OUTPUT_DIRECTORY');
  const directory = join(base, approval.cohort);
  mkdirSync(directory, { mode: 0o700 }); // Existing cohorts cannot be replayed.
  privateJson(join(directory, 'source.json'), source);
  privateJson(join(directory, 'approval.json'), approval);
  const write = outcomeWriter(directory);
  let database: Awaited<ReturnType<typeof seedDatabase>> | undefined;
  let transport: ReturnType<typeof createEvaluationTransport> | undefined;
  let restore: (() => void) | undefined;
  let pool: { end(): Promise<void> } | undefined;
  let result: Awaited<ReturnType<typeof runConversations>> | null = null;
  let failure: string | null = null;
  let after: unknown = null;
  const cleanupErrors: string[] = [];
  try {
    database = await seedDatabase(ownerUrl, runtimeUrl, approval.databaseName, root);
    privateJson(join(directory, 'database-before.json'), database.before);
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
      },
      async (input, init) => {
        // Also check before an internal schema-repair dispatch. If this fails after
        // the transport reserved, its full unknown reservation remains retained.
        validateApproval(
          readFileSync(approvalFile, 'utf8'),
          approvalHash,
          sourceBinding(root).hash,
          config.aiKey,
        );
        return upstream(input, init);
      },
    );
    restore = transport.install();
    const fixture = database;
    result = await runConversations({
      selectedCases,
      transport,
      chat: (messages) => app.financialChat(fixture.org, messages, { route: 'composable', asOfDate: clock }),
      assess: (item, turn, response, messages) =>
        assessTurn(item.turns[turn].expected, response, {
          caseId: item.id,
          turnIndex: turn,
          messages,
          org: fixture.org,
          chart: fixture.chart,
        }),
      beforeTurn: () => {
        validateApproval(
          readFileSync(approvalFile, 'utf8'),
          approvalHash,
          sourceBinding(root).hash,
          config.aiKey,
        );
      },
      afterTurn: async () =>
        requireCondition((await fixture.fingerprint()).hash === fixture.before.hash, 'BOOKS_CHANGED'),
      write,
    });
  } catch (error) {
    failure = safeCode(error);
  } finally {
    if (restore) {
      try {
        restore();
        restore = undefined;
      } catch {
        cleanupErrors.push('CONVERSATION_ACCEPTANCE_FETCH_RESTORE_FAILED');
      }
    }
    let budget: unknown = null;
    if (transport) {
      try {
        budget = transport.close();
      } catch {
        cleanupErrors.push('CONVERSATION_ACCEPTANCE_TRANSPORT_CLOSE_FAILED');
        budget = { unavailable: true, inspectPrivateLedger: true };
      }
    }
    if (database) {
      try {
        after = await database.fingerprint();
      } catch {
        cleanupErrors.push('CONVERSATION_ACCEPTANCE_FINAL_FINGERPRINT_FAILED');
      }
      try {
        await database.close();
      } catch {
        cleanupErrors.push('CONVERSATION_ACCEPTANCE_DATABASE_CLOSE_FAILED');
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch {
        cleanupErrors.push('CONVERSATION_ACCEPTANCE_POOL_CLOSE_FAILED');
      }
    }
    let finalSourceHash: string | null = null;
    try {
      finalSourceHash = sourceBinding(root).hash;
    } catch {
      cleanupErrors.push('CONVERSATION_ACCEPTANCE_FINAL_SOURCE_FAILED');
    }
    if (finalSourceHash !== source.hash) failure ??= 'CONVERSATION_ACCEPTANCE_SOURCE_DRIFT';
    if (database && after && JSON.stringify(after) !== JSON.stringify(database.before))
      failure ??= 'CONVERSATION_ACCEPTANCE_BOOKS_CHANGED';
    failure ??= cleanupErrors[0] ?? (result?.haltReason ? result.haltReason : null);
    privateJson(join(directory, 'closure.json'), {
      version:
        approval.version === 'conversation-acceptance-approval-v1'
          ? 'conversation-acceptance-run-v1'
          : 'conversation-acceptance-run-v2',
      ...(approval.version === 'conversation-acceptance-approval-v2'
        ? { caseIds: approval.caseIds, maxRequests: approval.maxRequests, maxAttempts: approval.maxAttempts }
        : {}),
      status:
        failure || !result?.executionComplete ? 'STOPPED_INCOMPLETE' : 'EXECUTION_COMPLETE_REVIEW_PENDING',
      result,
      failure,
      cleanupErrors,
      budget,
      before: database?.before ?? null,
      after,
      sourceHash: source.hash,
      finalSourceHash,
      semanticReview: 'pending',
      overallPass: false,
      finishedAt: new Date().toISOString(),
    });
  }
  return { directory, failure, result };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === 'prepare') {
    console.log(JSON.stringify(preparation(), null, 2));
    return;
  }
  if (args.length === 1 && args[0] === 'prepare-focused') {
    console.log(JSON.stringify(focusedPreparation(), null, 2));
    return;
  }
  if ((args.length === 1 || args.length === 2) && args[0] === 'check-db') {
    requireCondition(process.env.NODE_ENV === 'test', 'TEST_ENVIRONMENT_REQUIRED');
    const fixture = await seedDatabase(
      process.env.CONVERSATION_OWNER_DATABASE_URL ?? '',
      process.env.CONVERSATION_DATABASE_URL ?? '',
      process.env.CONVERSATION_DATABASE_NAME ?? '',
    );
    try {
      const after = await fixture.fingerprint();
      requireCondition(after.hash === fixture.before.hash, 'BOOKS_CHANGED');
      const receipt = {
        version: 'conversation-fixture-db-check-v1',
        storedLineChecks: fixture.storedLineChecks,
        oracleChecks: fixture.oracleChecks,
        before: fixture.before,
        after,
        providerCalls: 0,
      };
      if (args[1]) {
        const receiptPath = resolve(args[1]);
        requireCondition(receiptPath.startsWith(resolve('.tools') + '/'), 'RECEIPT_PATH');
        mkdirSync(resolve(receiptPath, '..'), { recursive: true, mode: 0o700 });
        privateJson(receiptPath, receipt);
      }
      console.log(JSON.stringify(receipt));
    } finally {
      await fixture.close();
    }
    return;
  }
  requireCondition(
    args.length === 3 && args[0] === 'execute',
    'USAGE_PREPARE_CHECK_DB_OR_EXECUTE_APPROVAL_PATH_SHA256',
  );
  const result = await execute(args[1], args[2]);
  console.log(JSON.stringify(result));
  if (result.failure || !result.result?.executionComplete) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(safeCode(error));
    process.exitCode = 1;
  });
