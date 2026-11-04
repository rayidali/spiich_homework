import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  encryptedArchive,
  encryptionPreflight,
  assertEarliestRun,
} from '../conversation-acceptance/workflow';
import { createFileBudget, decodeBudgetSeed } from './budget';
import { runInitialNativeCases } from './native-runner';
import { hash, requireFixture } from './references';

const repository = 'rayidali/spiich_homework';
const workflow = 'native-analyst-evaluation.yml';
const output = '.tools/native-analyst-evaluation-output';
const encrypted = '.tools/native-analyst-evaluation-encrypted';
const database = 'daybook_analyst_acceptance_20261104';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const permitSchema = z.strictObject({
  version: z.literal(1),
  scopeId: z.literal('daybook-analyst-product-20261103'),
  cohort: z.string().regex(/^native-initial-[a-z0-9-]{4,48}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  modelId: z.literal('gemini-3.8-flash'),
  databaseName: z.literal(database),
  hostname: z.string().regex(/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/),
  seedLedgerSha256: digest,
  artifactKeySha256: digest,
  fixtureFingerprint: digest,
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
const safeCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_:.-]{1,99}$/.test(code)
    ? code
    : 'NATIVE_CI_OPERATION_FAILED';
};
function configuration(command: string, env = process.env) {
  const raw = env.ANALYST_PRIVATE_PERMIT ?? '';
  requireFixture(Buffer.byteLength(raw) <= 8192 && hash(raw) === env.ANALYST_PERMIT_SHA256, 'PERMIT_HASH');
  const permit = permitSchema.parse(JSON.parse(raw));
  requireFixture(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_REPOSITORY === repository &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/${workflow}@refs/heads/main` &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
      env.GITHUB_SHA === permit.sourceCommit &&
      env.ANALYST_SOURCE_COMMIT === permit.sourceCommit &&
      env.ANALYST_COHORT === permit.cohort,
    'EXACT_MANUAL_WORKFLOW_REQUIRED',
  );
  requireFixture(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === permit.sourceCommit,
    'SOURCE_COMMIT_MISMATCH',
  );
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--'], { stdio: 'pipe' });
  const start = Date.parse(permit.approvedAt),
    end = Date.parse(permit.expiresAt);
  requireFixture(
    end > start &&
      end - start <= 48 * 3600000 &&
      (command === 'encrypt' || (start <= Date.now() && Date.now() < end)),
    'PERMIT_EXPIRED',
  );
  return {
    permit,
    binding: { sourceCommit: permit.sourceCommit, runId: env.GITHUB_RUN_ID!, phase: 'development' as const },
  };
}

export function assertNativeRuntimeUrl(raw: string, hostname: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INVALID_RUNTIME_DATABASE');
  }
  requireFixture(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      decodeURIComponent(url.username) === 'spiich_app' &&
      url.hostname.replace(/-pooler(?=\.)/, '') === hostname.replace(/-pooler(?=\.)/, '') &&
      url.pathname === `/${database}` &&
      (!url.port || url.port === '5432') &&
      !url.hash &&
      Boolean(url.password) &&
      [...url.searchParams.keys()].every((k) => ['sslmode', 'channel_binding'].includes(k)) &&
      ['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''),
    'PINNED_RUNTIME_DATABASE_REQUIRED',
  );
}

async function authorizeUnusedCohort(permit: z.infer<typeof permitSchema>, runId: string) {
  const token = process.env.GH_TOKEN ?? '';
  requireFixture(token.length > 0 && !/[\r\n\0]/.test(token), 'GITHUB_TOKEN_REQUIRED');
  const runs: unknown[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    requireFixture(response.ok, 'GITHUB_HISTORY_UNAVAILABLE');
    const text = await response.text();
    requireFixture(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'GITHUB_HISTORY_SIZE');
    const body = JSON.parse(text) as { total_count: unknown; workflow_runs: unknown[] };
    requireFixture(
      Number.isSafeInteger(body.total_count) &&
        Number(body.total_count) <= 1000 &&
        Array.isArray(body.workflow_runs) &&
        body.workflow_runs.length <= 100,
      'GITHUB_HISTORY_SHAPE',
    );
    total ??= Number(body.total_count);
    requireFixture(total === body.total_count, 'GITHUB_HISTORY_CHANGED');
    runs.push(...body.workflow_runs);
    if (body.workflow_runs.length < 100) {
      requireFixture(runs.length === total, 'GITHUB_HISTORY_INCOMPLETE');
      return assertEarliestRun(runs, {
        runId,
        cohort: permit.cohort,
        sourceCommit: permit.sourceCommit,
        sourceHash: permit.seedLedgerSha256,
        approvalHash: process.env.ANALYST_PERMIT_SHA256!,
        runName: `native-analyst/${permit.cohort}`,
      });
    }
  }
  throw new Error('GITHUB_HISTORY_INCOMPLETE');
}

export async function nativeWorkflowCommand(command: string) {
  requireFixture(['preflight', 'run', 'encrypt'].includes(command), 'UNKNOWN_COMMAND');
  const { permit, binding } = configuration(command);
  const key = process.env.ANALYST_ARTIFACT_KEY ?? '';
  encryptionPreflight(key, permit.artifactKeySha256, binding);
  if (command === 'encrypt') {
    if (!existsSync(output)) return;
    const receipt = encryptedArchive(output, encrypted, key, permit.artifactKeySha256, binding, {
      purpose: 'native-analyst-initial-six-case-capture',
      scopeId: permit.scopeId,
      cohort: permit.cohort,
      seedLedgerSha256: permit.seedLedgerSha256,
      sourceCommit: permit.sourceCommit,
    });
    console.log(JSON.stringify({ encrypted: true, archiveSha256: receipt.archiveSha256 }));
    return;
  }
  const seed = decodeBudgetSeed(process.env.ANALYST_BUDGET_LEDGER ?? '');
  requireFixture(hash(seed) === permit.seedLedgerSha256, 'BUDGET_SEED_HASH');
  if (command === 'preflight') {
    console.log(JSON.stringify({ preflight: true, providerCalls: 0 }));
    return;
  }
  await authorizeUnusedCohort(permit, binding.runId);
  mkdirSync('.tools', { recursive: true, mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  const save = (name: string, value: unknown) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  save('permit.json', permit);
  writeFileSync(join(output, 'input-ledger.json'), seed, { mode: 0o600, flag: 'wx' });
  const budget = createFileBudget({
    seed,
    seedSha256: permit.seedLedgerSha256,
    path: join(output, 'usage.json'),
    scopeId: permit.scopeId,
    cohort: permit.cohort,
  });
  let closePool: (() => Promise<void>) | undefined;
  try {
    const runtimeUrl = process.env.ANALYST_RUNTIME_URL ?? '',
      auditUrl = process.env.ANALYST_FIXTURE_AUDIT_URL ?? '';
    assertNativeRuntimeUrl(runtimeUrl, permit.hostname);
    requireFixture(
      Boolean(auditUrl) && Boolean(process.env.ANALYST_GEMINI_KEY?.trim()),
      'EVALUATION_CREDENTIALS_REQUIRED',
    );
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AI_PROVIDER = 'gemini';
    const [
      { pool },
      { postgresAnalystStore },
      { createAnalystSql },
      { createNativeAnalystService },
      { verifyPinnedRemoteDatabase },
    ] = await Promise.all([
      import('../../server/db'),
      import('../../server/analyst-store'),
      import('../../server/analyst-sql'),
      import('../../server/native-analyst-service'),
      import('./database'),
    ]);
    closePool = () => pool.end();
    const identity = await pool.query('SELECT current_user AS role,current_database() AS database');
    requireFixture(
      identity.rows[0]?.role === 'spiich_app' && identity.rows[0]?.database === database,
      'RUNTIME_IDENTITY_MISMATCH',
    );
    const verifyFixture = async () => {
      const receipt = await verifyPinnedRemoteDatabase(auditUrl, permit.hostname);
      requireFixture(
        receipt.fingerprintBefore === permit.fixtureFingerprint &&
          receipt.fingerprintAfter === permit.fixtureFingerprint,
        'PINNED_FIXTURE_CHANGED',
      );
      return receipt;
    };
    const result = await runInitialNativeCases({
      outputDirectory: join(output, 'capture'),
      budget,
      binding: {
        sourceCommit: permit.sourceCommit,
        modelId: permit.modelId,
        configurationSha256: hash(JSON.stringify({ permit, turnBudgetNanoUsd: 500_000_000 })),
      },
      verifyFixture,
      readRuntime: async (org, id) => (await postgresAnalystStore.read(org, id, 'daybook')).runtime,
      serviceFactory: (hooks) =>
        createNativeAnalystService({
          ...hooks,
          store: postgresAnalystStore,
          sql: createAnalystSql({ connect: () => pool.connect(), now: hooks.now }),
          settings: () => ({
            apiKey: process.env.ANALYST_GEMINI_KEY!,
            modelId: permit.modelId,
            turnBudgetNanoUsd: 500_000_000,
          }),
        }),
    });
    save('result.json', result);
    console.log(
      JSON.stringify({
        captured: true,
        conversations: result.conversations,
        turns: result.turns,
        completedTurns: result.completedTurns,
        accuracyScore: null,
      }),
    );
    requireFixture(result.completedTurns === result.turns, 'NATIVE_CAPTURE_HAS_OPERATIONAL_FAILURES');
  } catch (error) {
    save('driver-failure.json', { code: safeCode(error), at: new Date().toISOString() });
    throw error;
  } finally {
    save('final-budget-snapshot.json', await budget.snapshot());
    await closePool?.();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  nativeWorkflowCommand(process.argv[2]).catch((error) => {
    console.error(JSON.stringify({ ok: false, code: safeCode(error) }));
    process.exitCode = 1;
  });
}
