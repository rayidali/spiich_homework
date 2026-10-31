import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  fsyncSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseEnv } from 'dotenv';
import {
  prepareCategorySnapshot,
  selectCategory,
  getCategoryFailureMetadata,
  type CategoryMetadata,
  type CategoryResult,
  type CategoryTransport,
} from '../../server/category-selector';
import {
  CATEGORY_PRICES,
  CATEGORY_PRICE_DATE,
  CategoryBudget,
  verifyCategoryCarry,
  type CategoryCarryOptions,
  type CategoryOpeningCarry,
} from './budget';
import { categoryCases } from './fixtures';
import {
  buildCategoryReport,
  categoryReportHtml,
  categoryReportMarkdown,
  type ReportObservation,
} from './report';
import { privateJson, queuedTransport, type TransportObservation } from './transport';
import {
  CATEGORY_EVALUATION_VERSION,
  CATEGORY_ORDER_SEED,
  type CategoryCase,
  type Selector,
  type Split,
} from './types';

export const categorySourceFiles = [
  'server/category-selector.ts',
  'server/errors.ts',
  'shared/money.ts',
  'shared/schema.ts',
  'scripts/category-evaluation/types.ts',
  'scripts/category-evaluation/fixtures.ts',
  'scripts/category-evaluation/references.ts',
  'scripts/category-evaluation/scoring.ts',
  'scripts/category-evaluation/budget.ts',
  'scripts/category-evaluation/transport.ts',
  'scripts/category-evaluation/dispatch.ts',
  'scripts/category-evaluation/run.ts',
  'scripts/category-evaluation/report.ts',
  'docs/CATEGORIZATION_PROTOCOL.md',
  'docs/evidence/category-pricing-2026-10-31.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
];
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const safeCode = (error: unknown) => {
  const value =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  return typeof value === 'string' && /^(?:AI_|INVALID_|BUDGET_|TRANSPORT_|RUN_)[A-Z0-9_]{1,100}$/.test(value)
    ? value
    : 'RUN_INTERNAL_ERROR';
};
function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    throw new Error('RUN_STATE_CORRUPT');
  }
}
function immutable(path: string, value: unknown) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function categorySourceBinding(root: string, files = categorySourceFiles) {
  const hashes = Object.fromEntries(files.map((path) => [path, sha(readFileSync(join(root, path)))]));
  return { files: hashes, sourceHash: digest(hashes) };
}
type Slot = {
  index: number;
  id: string;
  caseId: string;
  selector: Selector;
  split: Split;
  inputHash: string;
  snapshotHash: string;
};
export type CategoryRunRecord = ReportObservation & {
  slotId: string;
  index: number;
  sourceHash: string;
  manifestHash: string;
  snapshotHash: string;
  startedAt: string;
  finishedAt: string;
  metadata: CategoryMetadata | null;
  basis: CategoryResult['basis'] | null;
  httpStatus: number | null;
  exitCode: number | null;
  claimed: boolean;
  dispatched: boolean;
  localFailure: string | null;
  previousHash: string;
  recordHash: string;
  failureDisposition: 'none' | 'continue_next_slot' | 'halt';
};
type Manifest = {
  version: typeof CATEGORY_EVALUATION_VERSION;
  run: string;
  source: ReturnType<typeof categorySourceBinding>;
  configHash: string;
  plan: Slot[];
  createdAt: string;
  openingCarry: CategoryOpeningCarry | null;
};
type RunOptions = {
  root: string;
  run: string;
  split: Split;
  mode: 'create' | 'resume';
  keys: { gemini: string; jev: string };
  // Injection exists only for provider-free tests; the CLI fixes all three selectors,
  // the full fixture set and the explicit production source-file list above.
  directory?: string;
  selectors?: Selector[];
  cases?: CategoryCase[];
  sourceFiles?: string[];
  carry?: Omit<CategoryCarryOptions, 'keyFingerprints'>;
};
type Dependencies = {
  transport?: (
    directory: string,
    id: string,
    budget: CategoryBudget,
    observation: TransportObservation,
  ) => CategoryTransport;
  onRecorded?: (record: CategoryRunRecord) => void;
};

export function plannedCategorySlots(cases: CategoryCase[], selectors: Selector[]): Slot[] {
  if (
    new Set(cases.map((c) => c.id)).size !== cases.length ||
    new Set(selectors).size !== selectors.length ||
    !selectors.length ||
    selectors.some((s) => !['reference', 'gemini', 'jev'].includes(s))
  )
    throw new Error('RUN_PLAN');
  const ordered = ['development', 'holdout'].flatMap((split) =>
    cases
      .filter((c) => c.split === split)
      .sort((a, b) =>
        digest(`${CATEGORY_ORDER_SEED}:${split}:${a.id}`).localeCompare(
          digest(`${CATEGORY_ORDER_SEED}:${split}:${b.id}`),
        ),
      ),
  );
  return ordered.flatMap((item, caseIndex) => {
    const prepared = prepareCategorySnapshot(item.input.facts, item.input.context);
    if (sha(JSON.stringify(item.input)) !== item.inputHash) throw new Error('RUN_INPUT_BINDING');
    return selectors.map((_, offset) => {
      const selector = selectors[(offset + caseIndex) % selectors.length];
      return {
        index: caseIndex * selectors.length + offset,
        id: `${selector}:${item.id}`,
        caseId: item.id,
        selector,
        split: item.split,
        inputHash: item.inputHash,
        snapshotHash: prepared.hash,
      };
    });
  });
}
const slotName = (index: number) => `${String(index).padStart(4, '0')}.json`;
function outcome(result: CategoryResult) {
  if (result.decision === 'SELECT') return { decision: result.decision, accountId: result.accountId };
  if (result.decision === 'CLARIFY')
    return { decision: result.decision, topic: result.topic, question: result.question };
  return { decision: result.decision, reason: result.reason, message: result.message };
}
function verifyStored(directory: string, manifest: Manifest, manifestHash: string) {
  const records: CategoryRunRecord[] = [];
  let previousHash = manifestHash;
  const names = readdirSync(join(directory, 'observations')).sort();
  for (const [index, name] of names.entries()) {
    if (name !== slotName(index)) throw new Error('RUN_OUTCOME_ORDER');
    const record = readJson<CategoryRunRecord>(join(directory, 'observations', name));
    const slot = manifest.plan[index];
    const { recordHash, ...body } = record;
    if (
      !slot ||
      recordHash !== digest(body) ||
      record.previousHash !== previousHash ||
      record.manifestHash !== manifestHash ||
      record.sourceHash !== manifest.source.sourceHash ||
      record.index !== index ||
      record.slotId !== slot.id ||
      record.caseId !== slot.caseId ||
      record.selector !== slot.selector ||
      record.snapshotHash !== slot.snapshotHash ||
      record.inputHash !== slot.inputHash ||
      !['ok', 'error'].includes(record.status)
    )
      throw new Error('RUN_OUTCOME_BINDING');
    const start = readJson<{ slotId: string; manifestHash: string; startedAt: string }>(
      join(directory, 'started', name),
    );
    if (
      start.slotId !== slot.id ||
      start.manifestHash !== manifestHash ||
      start.startedAt !== record.startedAt
    )
      throw new Error('RUN_START_BINDING');
    records.push(record);
    previousHash = recordHash;
  }
  const starts = readdirSync(join(directory, 'started')).sort();
  if (starts.length > records.length + 1 || starts.some((name, index) => name !== slotName(index)))
    throw new Error('RUN_START_ORDER');
  return records;
}
function reconcileBudget(records: CategoryRunRecord[], budget: CategoryBudget, allowStartedId?: string) {
  const ledger = budget.snapshot();
  for (const reservation of ledger.records) {
    const record = records.find((r) => r.slotId === reservation.id);
    if (!record && reservation.id === allowStartedId) continue;
    if (
      !record ||
      record.selector !== reservation.provider ||
      record.attempts !== 1 ||
      reservation.state === 'pending' ||
      (reservation.state === 'known'
        ? record.reportedCostUsd !== reservation.chargedUsd || record.reservedUnknownUsd !== null
        : record.reservedUnknownUsd !== reservation.chargedUsd || record.reportedCostUsd !== null)
    )
      throw new Error('RUN_BUDGET_BINDING');
  }
  if (records.some((r) => r.attempts === 1 && !ledger.records.some((row) => row.id === r.slotId)))
    throw new Error('RUN_UNRESERVED_ATTEMPT');
}

/** All networking is injected queued transport; this runner never calls fetch. */
export async function runCategoryEvaluation(options: RunOptions, dependencies: Dependencies = {}) {
  const { root, run, split, mode } = options;
  const keys = { gemini: options.keys.gemini.trim(), jev: options.keys.jev.trim() };
  if (
    !/^[a-z0-9-]{1,60}$/.test(run) ||
    !['development', 'holdout'].includes(split) ||
    !['create', 'resume'].includes(mode)
  )
    throw new Error('RUN_ARGUMENTS');
  if (mode === 'create' && split !== 'development') throw new Error('RUN_DEVELOPMENT_FIRST');
  const selectors = options.selectors ?? ['reference', 'gemini', 'jev'];
  for (const provider of ['gemini', 'jev'] as const)
    if (selectors.includes(provider) && (!keys[provider] || /[\r\n\0]/.test(keys[provider])))
      throw new Error('RUN_KEY_MISSING');
  const cases = options.cases ?? categoryCases;
  const plan = plannedCategorySlots(cases, selectors);
  const source = categorySourceBinding(root, options.sourceFiles);
  const directory = options.directory ?? join(root, '.tools/category-evaluation', run);
  const keyFingerprints = Object.fromEntries(
    (['gemini', 'jev'] as const).filter((p) => selectors.includes(p)).map((p) => [p, sha(keys[p])]),
  );
  const carryOptions = options.carry ? { ...options.carry, keyFingerprints } : undefined;
  if (carryOptions && run !== 'category-learning-20261031-v3') throw new Error('RUN_CARRY_VERSION');
  // Only injected provider-free tests can omit the reviewed predecessor. The
  // production CLI never supplies a transport injection or a fresh allowance.
  if (!carryOptions && selectors.some((s) => s !== 'reference') && !dependencies.transport)
    throw new Error('RUN_CARRY_REQUIRED');
  const openingCarry = carryOptions
    ? verifyCategoryCarry(join(directory, 'budget.json'), source.sourceHash, carryOptions)
    : null;
  const config = {
    version: CATEGORY_EVALUATION_VERSION,
    selectors,
    models: CATEGORY_PRICES,
    priceDate: CATEGORY_PRICE_DATE,
    timeoutMs: 25000,
    maxPaidCallsPerProvider: 57,
    maxTotalPaidCalls: 114,
    keyFingerprints,
    openingCarry,
    dataHash: digest(cases),
    planHash: digest(plan),
  };
  if (mode === 'create') mkdirSync(directory, { recursive: false, mode: 0o700 });
  if (!existsSync(directory)) throw new Error('RUN_NOT_FOUND');
  const lock = join(directory, 'runner.lock');
  closeSync(openSync(lock, 'wx', 0o600));
  let budget: CategoryBudget | undefined;
  try {
    const manifestPath = join(directory, 'manifest.json');
    if (mode === 'create') {
      mkdirSync(join(directory, 'observations'), { mode: 0o700 });
      mkdirSync(join(directory, 'started'), { mode: 0o700 });
      immutable(join(directory, 'private-config.json'), config);
      immutable(manifestPath, {
        version: CATEGORY_EVALUATION_VERSION,
        run,
        source,
        configHash: digest(config),
        plan,
        createdAt: new Date().toISOString(),
        openingCarry,
      } satisfies Manifest);
    }
    const manifest = readJson<Manifest>(manifestPath),
      manifestHash = digest(manifest);
    if (
      manifest.version !== CATEGORY_EVALUATION_VERSION ||
      manifest.run !== run ||
      manifest.configHash !== digest(config) ||
      digest(readJson(join(directory, 'private-config.json'))) !== digest(config) ||
      digest(manifest.source) !== digest(source) ||
      digest(manifest.openingCarry) !== digest(openingCarry) ||
      digest(manifest.plan) !== digest(plan)
    )
      throw new Error('RUN_FREEZE_MISMATCH');
    const records = verifyStored(directory, manifest, manifestHash);
    if (existsSync(join(directory, 'halt.json'))) throw new Error('RUN_HALTED_REVIEW_REQUIRED');
    if (records.some((r) => r.status === 'error' && r.failureDisposition !== 'continue_next_slot'))
      throw new Error('RUN_ERROR_REVIEW_REQUIRED');
    const developmentPlan = plan.filter((p) => p.split === 'development');
    if (split === 'holdout' && developmentPlan.some((p) => !records.some((r) => r.slotId === p.id)))
      throw new Error('RUN_DEVELOPMENT_INCOMPLETE');
    if (split === 'development' && records.some((r) => plan[r.index].split === 'holdout'))
      throw new Error('RUN_PHASE_ORDER');
    if (existsSync(join(directory, 'finished.json'))) unlinkSync(join(directory, 'finished.json'));
    budget = new CategoryBudget(join(directory, 'budget.json'), source.sourceHash, mode, carryOptions);
    const next = plan[records.length];
    reconcileBudget(
      records,
      budget,
      next && existsSync(join(directory, 'started', slotName(next.index))) ? next.id : undefined,
    );
    const snapshotCache = new Map(
      cases.map((c) => [c.id, prepareCategorySnapshot(c.input.facts, c.input.context)]),
    );
    const selectedCases = cases.filter((c) => c.split === split);
    let halted = false;
    const serverErrorStreak: Record<Selector, number> = { reference: 0, gemini: 0, jev: 0 };
    for (const record of records) {
      if (record.failureDisposition === 'continue_next_slot') serverErrorStreak[record.selector]++;
      else if (record.attempts === 1 && record.status === 'ok') serverErrorStreak[record.selector] = 0;
    }
    const checkSource = () => {
      if (categorySourceBinding(root, options.sourceFiles).sourceHash !== source.sourceHash)
        throw new Error('RUN_SOURCE_CHANGED');
    };
    const saveReport = () => {
      const pendingSlot = plan[records.length];
      const orphanId =
        pendingSlot && existsSync(join(directory, 'started', slotName(pendingSlot.index)))
          ? pendingSlot.id
          : undefined;
      reconcileBudget(records, budget!, orphanId);
      const report = buildCategoryReport(
        selectedCases,
        records.filter((r) => plan[r.index].split === split),
        {
          run,
          split,
          sourceHash: source.sourceHash,
          selectors,
          cohortAccounting: budget!.accounting(),
          integrity: {
            sourceVerified: categorySourceBinding(root, options.sourceFiles).sourceHash === source.sourceHash,
            inputVerified: records.every(
              (r) => r.inputHash === plan[r.index].inputHash && r.snapshotHash === plan[r.index].snapshotHash,
            ),
            budgetReconciled: !budget!
              .snapshot()
              .records.some((r) => !records.some((record) => record.slotId === r.id)),
            halted,
          },
        },
      );
      const output = join(directory, split);
      mkdirSync(output, { recursive: true, mode: 0o700 });
      privateJson(join(output, 'results.json'), report);
      writeFileSync(join(output, 'report.md'), categoryReportMarkdown(report), { mode: 0o600 });
      writeFileSync(join(output, 'report.html'), categoryReportHtml(report), { mode: 0o600 });
      privateJson(join(directory, 'checkpoint.json'), {
        run,
        split,
        recorded: records.length,
        planned: plan.length,
        manifestHash,
        lastRecordHash: records.at(-1)?.recordHash ?? manifestHash,
        halted,
        sourceHash: source.sourceHash,
      });
      return report;
    };
    let report = saveReport();
    for (const slot of plan.filter((p) => p.split === split && p.index >= records.length)) {
      checkSource();
      if (slot.index !== records.length) throw new Error('RUN_PLAN_ORDER');
      const startPath = join(directory, 'started', slotName(slot.index));
      const interrupted = existsSync(startPath);
      if (!interrupted)
        immutable(startPath, { slotId: slot.id, manifestHash, startedAt: new Date().toISOString() });
      const start = readJson<{ slotId: string; manifestHash: string; startedAt: string }>(startPath);
      if (start.slotId !== slot.id || start.manifestHash !== manifestHash)
        throw new Error('RUN_START_BINDING');
      const observed: TransportObservation = {
        dispatched: false,
        httpStatus: null,
        networkMs: null,
        exitCode: null,
      };
      let pendingTransport: ReturnType<CategoryTransport> | undefined;
      let result: CategoryResult | undefined,
        failure: unknown,
        metadata: CategoryMetadata | null = null;
      const began = performance.now();
      try {
        if (interrupted) throw new Error('RUN_INTERRUPTED_ATTEMPT');
        const snapshot = snapshotCache.get(slot.caseId)!;
        if (snapshot.hash !== slot.snapshotHash) throw new Error('RUN_SNAPSHOT_CHANGED');
        const transport = (dependencies.transport ?? queuedTransport)(directory, slot.id, budget, observed);
        const wrapped: CategoryTransport = (request) => {
          if (pendingTransport) throw new Error('RUN_MULTIPLE_REQUESTS');
          if (budget!.snapshot().records.filter((r) => r.provider === request.provider).length >= 57)
            throw new Error('BUDGET_PLAN_LIMIT');
          pendingTransport = transport(request);
          return pendingTransport;
        };
        result = await selectCategory(
          snapshot,
          slot.selector === 'reference'
            ? { provider: 'reference' }
            : {
                provider: slot.selector,
                apiKey: keys[slot.selector],
                transport: wrapped,
                timeoutMs: 25000,
                model: CATEGORY_PRICES[slot.selector].model,
              },
        );
        metadata = result.metadata;
      } catch (error) {
        failure = error;
        metadata = getCategoryFailureMetadata(error) ?? null;
      } finally {
        // selectCategory's timeout races the queue abort poll. Drain that same
        // promise before reading/releasing the budget; never start another call.
        if (pendingTransport) await pendingTransport.catch(() => undefined);
      }
      const reservation = budget.snapshot().records.find((r) => r.id === slot.id);
      const localFailure =
        'localFailure' in observed && typeof observed.localFailure === 'string'
          ? observed.localFailure
          : null;
      if (localFailure && !failure) failure = new Error(localFailure);
      if (
        !failure &&
        result &&
        result.metadata.attempts === 1 &&
        result.metadata.provider === 'gemini' &&
        (result.metadata.returnedModel === null ||
          !/^gemini-3\.5-flash-lite(?:-|$)/.test(result.metadata.returnedModel))
      )
        failure = new Error('RUN_MODEL_MISMATCH');
      if (!failure && reservation && reservation.state !== 'known')
        failure = new Error('RUN_USAGE_UNVERIFIED');
      try {
        checkSource();
      } catch (error) {
        failure = error;
      }
      const ordinaryServerError =
        !!failure &&
        !localFailure &&
        safeCode(failure) === 'AI_PROVIDER_ERROR' &&
        observed.httpStatus !== null &&
        observed.httpStatus >= 500 &&
        observed.httpStatus <= 599;
      if (ordinaryServerError) serverErrorStreak[slot.selector]++;
      else if (!failure && reservation) serverErrorStreak[slot.selector] = 0;
      const failureDisposition = failure
        ? ordinaryServerError && serverErrorStreak[slot.selector] < 2
          ? 'continue_next_slot'
          : 'halt'
        : 'none';
      const body: Omit<CategoryRunRecord, 'recordHash'> = {
        caseId: slot.caseId,
        selector: slot.selector,
        inputHash: slot.inputHash,
        status: failure ? 'error' : 'ok',
        result: failure || !result ? null : outcome(result),
        ...(failure ? { errorCode: localFailure ?? safeCode(failure) } : {}),
        attempts: reservation ? 1 : 0,
        latencyMs: interrupted ? null : Math.max(0, Math.round(performance.now() - began)),
        reportedCostUsd: reservation?.state === 'known' ? reservation.chargedUsd : null,
        reservedUnknownUsd: reservation && reservation.state !== 'known' ? reservation.chargedUsd : null,
        slotId: slot.id,
        index: slot.index,
        sourceHash: source.sourceHash,
        manifestHash,
        snapshotHash: slot.snapshotHash,
        startedAt: start.startedAt,
        finishedAt: new Date().toISOString(),
        metadata,
        basis: result?.basis ?? null,
        httpStatus: observed.httpStatus,
        exitCode: observed.exitCode,
        networkMs: observed.networkMs,
        claimed: 'claimed' in observed && observed.claimed === true,
        dispatched: observed.dispatched,
        localFailure,
        previousHash: records.at(-1)?.recordHash ?? manifestHash,
        failureDisposition,
      };
      const record = { ...body, recordHash: digest(body) };
      immutable(join(directory, 'observations', slotName(slot.index)), record);
      records.push(record);
      if (failureDisposition === 'halt') {
        halted = true;
        immutable(join(directory, 'halt.json'), {
          slotId: slot.id,
          errorCode: record.errorCode,
          sourceHash: source.sourceHash,
          recordedAt: record.finishedAt,
          resume: 'Requires explicit reviewed continuation; no automatic retry or source rebinding.',
        });
      }
      report = saveReport();
      dependencies.onRecorded?.(record);
      if (halted) break;
    }
    const close = split === 'holdout' && report.complete && !halted && report.integrity.sourceVerified;
    budget.release(close);
    privateJson(join(directory, 'finished.json'), {
      run,
      split,
      complete: report.complete,
      halted,
      budgetClosed: close,
      sourceHash: source.sourceHash,
      observed: report.observed,
      planned: report.planned,
    });
    return report;
  } finally {
    budget?.release();
    unlinkSync(lock);
  }
}

export function parseCategoryArguments(args: string[]) {
  if (
    ![3, 5].includes(args.length) ||
    args.some((arg) => !/^--(split|run|mode|carry-from|carry-sha256)=/.test(arg))
  )
    throw new Error('RUN_ARGUMENTS');
  const values = Object.fromEntries(
    args.map((arg) => {
      const i = arg.indexOf('=');
      return [arg.slice(2, i), arg.slice(i + 1)];
    }),
  );
  if (
    !['development', 'holdout'].includes(values.split) ||
    !['create', 'resume'].includes(values.mode) ||
    !/^[a-z0-9-]{1,60}$/.test(values.run ?? '') ||
    Object.keys(values).length !== args.length ||
    (args.length === 5 &&
      (!values['carry-from'] ||
        /[\r\n\0]/.test(values['carry-from']) ||
        !/^[a-f0-9]{64}$/.test(values['carry-sha256'] ?? '')))
  )
    throw new Error('RUN_ARGUMENTS');
  return {
    split: values.split as Split,
    run: values.run,
    mode: values.mode as 'create' | 'resume',
    ...(args.length === 5
      ? { carry: { receiptPath: resolve(values['carry-from']), receiptSha256: values['carry-sha256'] } }
      : {}),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseCategoryArguments(process.argv.slice(2));
    const root = process.cwd();
    const env = existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'))) : {};
    const keys = {
      gemini: process.env.GEMINI_API_KEY ?? env.GEMINI_API_KEY ?? '',
      jev: process.env.TYPESAFE_API_KEY ?? env.TYPESAFE_API_KEY ?? '',
    };
    mkdirSync(join(root, '.tools/category-evaluation'), { recursive: true, mode: 0o700 });
    const result = await runCategoryEvaluation(
      { root, ...args, keys },
      {
        onRecorded: (row) =>
          console.log(
            JSON.stringify({
              index: row.index,
              slot: row.slotId,
              status: row.status,
              attempts: row.attempts,
            }),
          ),
      },
    );
    console.log(
      JSON.stringify({
        run: args.run,
        split: args.split,
        complete: result.complete,
        recorded: result.observed,
        planned: result.planned,
      }),
    );
    if (!result.complete || result.integrity.halted) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ error: safeCode(error) }));
    process.exitCode = 1;
  }
}
