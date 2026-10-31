import 'dotenv/config';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { reviewCases } from '../../research/reference';
import { StudyBudget } from '../../research/budget';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { GeminiResearchClient, JevResearchClient } from '../../research/providers';
import { GeminiStartPacer } from '../../research/pacing';
import { requireFrozenVerifier } from '../../research/freeze-state';
import { sourceManifest } from '../../research/manifest';
import { assertStudyMayContinue } from '../../research/run-stop';
import {
  analyzeVerifiers,
  evaluateVerifier,
  JEV_THRESHOLD_GRID,
  renderVerifierMarkdown,
  reviewInputHash,
  selectJevThreshold,
  VERIFIER_METHODS,
  VERIFIER_PROTOCOL,
  visibleReviewInput,
  type ThresholdSelection,
  type VerifierRecord,
} from '../../research/validator-study';

const split = process.argv[2] ?? 'development';
if (split !== 'development' && split !== 'holdout') throw new Error('INVALID_VERIFIER_SPLIT');
const runId = process.argv[3] ?? 'verifiers-v1';
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(runId)) throw new Error('INVALID_VERIFIER_RUN_ID');
const directory = `docs/evidence/research-verifiers/${runId}`;
mkdirSync(directory, { recursive: true });
mkdirSync('.tools/research', { recursive: true });
const lockPath = '.tools/research/runner.lock';
if (existsSync(lockPath)) {
  const pid = Number(readFileSync(lockPath, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('INVALID_RESEARCH_RUNNER_LOCK');
  try {
    process.kill(pid, 0);
    throw new Error('RESEARCH_RUNNER_ALREADY_LIVE');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    unlinkSync(lockPath);
  }
}
const lock = openSync(lockPath, 'wx', 0o600);
writeFileSync(lock, String(process.pid));
closeSync(lock);

interface FrozenConfig extends ThresholdSelection {
  runId: string;
  frozenAt: string;
  developmentInputHash: string;
  sourceHash: string;
  developmentResultsHash: string;
}
const configPath = '.tools/research/verifier-config.json';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHash = digest(
  [
    'research/validator-study.ts',
    'research/review.ts',
    'research/providers/jev.ts',
    'research/providers/gemini.ts',
  ].map((file) => readFileSync(file, 'utf8')),
);
const developmentCases = reviewCases.filter((item) => item.split === 'development');
const developmentInputHash = digest(
  developmentCases.map((item) => ({ id: item.id, input: visibleReviewInput(item) })),
);
let selection: FrozenConfig | null = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : null;
const cases = reviewCases.filter((item) => item.split === split);
const outputPath = `${directory}/${split}.jsonl`;
const records: VerifierRecord[] = existsSync(outputPath)
  ? readFileSync(outputPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];

try {
  if (
    selection &&
    (selection.runId !== runId ||
      selection.sourceHash !== sourceHash ||
      selection.developmentInputHash !== developmentInputHash)
  )
    throw new Error('FROZEN_VERIFIER_CONFIG_MISMATCH');
  if (split === 'holdout' && !selection) throw new Error('HOLDOUT_REQUIRES_FROZEN_DEVELOPMENT_THRESHOLD');
  if (split === 'holdout') requireFrozenVerifier(selection!, sourceManifest().hash);
  const manifest = {
    protocol: VERIFIER_PROTOCOL,
    runId,
    split,
    sourceHash,
    inputHash: digest(cases.map((item) => visibleReviewInput(item))),
    caseIds: cases.map((item) => item.id),
    methods: VERIFIER_METHODS,
    thresholdGrid: JEV_THRESHOLD_GRID,
    threshold: selection?.threshold ?? 0.8,
    createdAt: new Date().toISOString(),
    frozenConfigAt: selection?.frozenAt ?? null,
    fullSourceHash: split === 'holdout' ? sourceManifest().hash : null,
    minimumGeminiStartSpacingMs: 4200,
  };
  const manifestPath = `${directory}/${split}-manifest.json`;
  if (existsSync(manifestPath)) {
    const prior = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const key of ['sourceHash', 'inputHash', 'protocol'])
      if (prior[key] !== manifest[key as keyof typeof manifest])
        throw new Error('VERIFIER_RESUME_MANIFEST_CHANGED');
  } else atomicJson(manifestPath, manifest);
  const budget = new StudyBudget('.tools/research/usage.json');
  const transport = new GeminiStartPacer().wrap(budget.wrap(providerTransport(httpTransport())));
  const clients = {
    gemini: new GeminiResearchClient(process.env.GEMINI_API_KEY ?? '', transport),
    jev: new JevResearchClient(process.env.TYPESAFE_API_KEY ?? '', transport),
  };
  const save = () => {
    const report = analyzeVerifiers(records, cases, selection?.threshold ?? 0.8);
    atomicJson(`${directory}/${split}-results.json`, report);
    writeFileSync(`${directory}/${split}-report.md`, renderVerifierMarkdown(report, selection));
    const ids = new Set(records.map((record) => record.id));
    atomicJson(
      `${directory}/${split}-usage.json`,
      budget.records.filter((record) => ids.has(record.episode)),
    );
  };
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index],
      input = visibleReviewInput(item),
      inputHash = reviewInputHash(input);
    const offset = index % VERIFIER_METHODS.length;
    const order = [...VERIFIER_METHODS.slice(offset), ...VERIFIER_METHODS.slice(0, offset)];
    for (const method of order) {
      const id = `${runId}:${split}:${method}:${item.id}`;
      const prior = records.find((record) => record.id === id);
      if (prior) {
        if (prior.inputHash !== inputHash) throw new Error('VERIFIER_RESUME_INPUT_CHANGED');
        continue;
      }
      budget.episode = id;
      const interrupted = budget.records.some((record) => record.episode === id);
      const result = interrupted
        ? {
            status: 'error' as const,
            decision: null,
            reasons: [],
            evidenceIds: [],
            durationMs: 0,
            error: 'INTERRUPTED_PRIOR_ATTEMPT',
          }
        : await evaluateVerifier(method, input, clients, selection?.threshold ?? 0.8);
      const record: VerifierRecord = {
        ...result,
        id,
        caseId: item.id,
        sourceGroupId: item.sourceGroupId,
        split,
        method,
        inputHash,
        threshold: method === 'jev' ? (selection?.threshold ?? 0.8) : null,
      };
      appendFileSync(outputPath, JSON.stringify(record) + '\n');
      records.push(record);
      save();
      console.log(
        JSON.stringify({
          caseId: item.id,
          method,
          status: record.status,
          decision: record.decision,
          completed: records.length,
          planned: cases.length * VERIFIER_METHODS.length,
        }),
      );
      assertStudyMayContinue(record.error);
    }
  }
  if (split === 'development') {
    const selected = selectJevThreshold(records, developmentCases);
    const proposed: FrozenConfig = {
      ...selected,
      runId,
      frozenAt: new Date().toISOString(),
      sourceHash,
      developmentInputHash,
      developmentResultsHash: digest(records),
    };
    if (selection && selection.developmentResultsHash !== proposed.developmentResultsHash)
      throw new Error('FROZEN_DEVELOPMENT_RESULTS_CHANGED');
    selection ??= proposed;
    atomicJson(configPath, selection);
    atomicJson(`${directory}/verifier-config.json`, selection);
    save();
    console.log(
      JSON.stringify({
        thresholdFrozen: selection.threshold,
        feasible: selection.feasible,
        frozenAt: selection.frozenAt,
      }),
    );
  }
} finally {
  unlinkSync(lockPath);
}
