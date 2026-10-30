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
import { execFileSync } from 'node:child_process';
import { questions, type ResearchQuestion } from '../../research/dataset';
import { executeRoute, routes, type RouteId } from '../../research/routes';
import { ResearchDatabase } from '../../research/database';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { StudyBudget } from '../../research/budget';
import { buildReport, writeReport, type SnapshotIntegrity } from '../../research/report';
import { type StudyEpisode } from '../../research/scoring';
import { answerSchema } from '../../research/answer';
import { sourceManifest } from '../../research/manifest';
import { EpisodeLimits } from '../../research/limits';
import { GeminiStartPacer } from '../../research/pacing';
import { requireFrozenVerifier } from '../../research/freeze-state';

const suite = process.argv[2] ?? 'smoke';
if (!['smoke', 'pilot', 'development', 'holdout'].includes(suite)) throw new Error('Unknown suite');
const runId = process.argv[3] ?? `${suite}-v1`;
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(runId)) throw new Error('Invalid run ID');
const selectedRoutes = (process.env.RESEARCH_ROUTES?.split(',') ?? Object.keys(routes)) as RouteId[];
if (selectedRoutes.some((id) => !(id in routes))) throw new Error('Invalid route');
const split = suite === 'holdout' ? 'holdout' : 'development';
let selected = questions.filter((q) => q.split === split);
if (suite === 'smoke' || suite === 'pilot') {
  const perFamily = suite === 'smoke' ? 1 : 2,
    counts = new Map<string, number>();
  selected = selected.filter((q) => {
    if (!q.id.endsWith('-1')) return false;
    const count = counts.get(q.family) ?? 0;
    if (count >= perFamily) return false;
    counts.set(q.family, count + 1);
    return true;
  });
}
const repeats = suite === 'holdout' ? 3 : 1;
const path = `docs/evidence/research-runs/${runId}`;
mkdirSync(path, { recursive: true });
mkdirSync('.tools/research', { recursive: true });
const lockPath = '.tools/research/runner.lock';
if (existsSync(lockPath)) {
  const pid = Number(readFileSync(lockPath, 'utf8'));
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
const http = httpTransport(),
  budget = new StudyBudget('.tools/research/usage.json');
const pacer = new GeminiStartPacer();
const readerUrl = JSON.parse(readFileSync('.tools/research/database-private.json', 'utf8')).readerUrl;
const db = new ResearchDatabase(readerUrl, http);
const index = existsSync('.tools/research/index-state.json')
  ? JSON.parse(readFileSync('.tools/research/index-state.json', 'utf8'))
  : { store: undefined };
const verifierConfig = existsSync('.tools/research/verifier-config.json')
  ? JSON.parse(readFileSync('.tools/research/verifier-config.json', 'utf8'))
  : null;
if (suite === 'holdout' && (!verifierConfig || verifierConfig.selectedOn !== 'development'))
  throw new Error('HOLDOUT_REQUIRES_FROZEN_DEVELOPMENT_THRESHOLD');
const episodesPath = `${path}/episodes.jsonl`;
const episodes: StudyEpisode[] = existsSync(episodesPath)
  ? readFileSync(episodesPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
let revision = 'working-tree';
try {
  revision = execFileSync('git', ['-C', '/private/tmp/daybook-publish.kbVq33', 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  /* Archivehash records workingtree separately. */
}
const manifest = {
  runId,
  suite,
  split,
  repeats,
  routeIds: selectedRoutes,
  questionIds: selected.map((q) => q.id),
  createdAt: new Date().toISOString(),
  transport: process.env.RESEARCH_TRANSPORT ?? 'fetch',
  generator: 'gemini-3.5-flash-lite',
  critic: 'gemini-3.5-flash-lite',
  jev: 'jev-1.14.0',
  embedding: 'gemini-embedding-001',
  dimensions: 768,
  minimumGeminiStartSpacingMs: pacer.spacingMs,
  sourceRevision: revision,
  protocolHash: createHash('sha256').update(readFileSync('docs/PLAN.md')).digest('hex'),
  datasetHash: createHash('sha256')
    .update(readFileSync('research/fixtures/snapshot-manifest.json'))
    .digest('hex'),
};
const source = sourceManifest();
if (suite === 'holdout') requireFrozenVerifier(verifierConfig, source.hash);
Object.assign(manifest, {
  sourceHash: source.hash,
  runtime: source.runtime,
  indexHash: createHash('sha256').update(JSON.stringify(index)).digest('hex'),
  verifierThreshold: verifierConfig?.threshold ?? 0.8,
  verifierConfigHash: verifierConfig
    ? createHash('sha256').update(JSON.stringify(verifierConfig)).digest('hex')
    : null,
  sourceRevisionMeaning: 'Last published ancestor; sourceHash identifies actual working source',
});
if (existsSync(`${path}/manifest.json`)) {
  const prior = JSON.parse(readFileSync(`${path}/manifest.json`, 'utf8'));
  for (const key of [
    'protocolHash',
    'datasetHash',
    'suite',
    'generator',
    'critic',
    'jev',
    'embedding',
    'dimensions',
    'minimumGeminiStartSpacingMs',
    'sourceHash',
    'runtime',
    'indexHash',
    'verifierThreshold',
    'verifierConfigHash',
    'routeIds',
    'questionIds',
    'repeats',
  ])
    if (JSON.stringify(prior[key]) !== JSON.stringify((manifest as Record<string, unknown>)[key]))
      throw new Error('RESEARCH_RESUME_MANIFEST_CHANGED');
} else {
  atomicJson(`${path}/manifest.json`, manifest);
  atomicJson(`${path}/source-manifest.json`, source);
}
let snapshotIntegrity: SnapshotIntegrity = {
  status: 'unverified',
  before: null,
  after: null,
  scope: 'ledger_and_corpus',
  reason: 'Final complete ledger/document/embedding fingerprint is pending.',
};
function saveReport() {
  writeReport(
    path,
    buildReport(episodes, budget.records, questions, {
      split,
      expectedRepeats: repeats,
      plannedQuestionIds: selected.map((q) => q.id),
      runId,
      sourceRevision: revision,
      snapshotIntegrity,
      extraLimitations: [
        'Queue-transport wall latency includes local dispatch delays and is not production request latency. Provider durations are measured separately.',
        'All study generators normalized to Gemini3.5FlashLite; R0 is an architecture reproduction. Same-model critic errors may correlate.',
      ],
    }),
  );
}
function blankBlock(summary: string) {
  return answerSchema.parse({
    behavior: 'BLOCK',
    summary,
    facts: [],
    evidenceIds: [],
    assumptions: [],
    assumptionTags: [],
    clarificationTopics: [],
    clarificationTopicTags: [],
    proposalLines: [],
    calculations: [],
  });
}
async function episode(route: RouteId, q: ResearchQuestion, repeat: number, snapshot: string) {
  const id = `${runId}:${route}:${q.id}:${repeat}`;
  if (episodes.some((e) => e.id === id)) return;
  if (sourceManifest().hash !== source.hash) throw new Error('RESEARCH_SOURCE_CHANGED_DURING_RUN');
  const start = performance.now();
  budget.episode = id;
  let value: StudyEpisode = {
    id,
    route,
    questionId: q.id,
    groupId: q.groupId,
    family: q.family,
    split: q.split,
    repeat,
    status: 'error',
    organizationId: q.organizationId,
    durationMs: 0,
  };
  // An interrupted request with this exact episode ID is not silently re-run.
  if (budget.records.some((r) => r.episode === id)) value.error = 'INTERRUPTED_PRIOR_ATTEMPT';
  else
    try {
      const limits = new EpisodeLimits();
      const transport = pacer.wrap(budget.wrap(providerTransport(limits.http(http))), {
        remainingMs: () => limits.remaining(),
      });
      const result = await executeRoute(route, q, {
        db: new ResearchDatabase(readerUrl, limits.http(http)),
        limits,
        snapshot,
        store: index.store,
        jevThreshold: verifierConfig?.threshold ?? 0.8,
        geminiKey: process.env.GEMINI_API_KEY ?? '',
        jevKey: process.env.TYPESAFE_API_KEY ?? '',
        transport: async (request) => {
          limits.model(request);
          return transport(request);
        },
      });
      value = { ...value, ...result, status: 'ok' };
      const validation = 'validation' in result ? result.validation : undefined;
      const review =
        'review' in result
          ? (result.review as { decision?: string; data?: { decision?: string } } | null)
          : null;
      const decision = review?.decision ?? review?.data?.decision;
      if ((validation && !validation.valid) || (decision && decision !== 'PASS')) {
        value = {
          ...value,
          status: 'blocked',
          answer: blankBlock('This answer needs review before it can be released.'),
        };
        Object.assign(value, { candidateAnswer: result.answer });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      value.error = message.includes('://') ? 'RESEARCH_REQUEST_FAILED' : message.slice(0, 300);
    }
  value.durationMs = Math.round(performance.now() - start);
  value.providerDurationMs = budget.records
    .filter((r) => r.episode === id)
    .reduce((a, r) => a + (r.durationMs ?? 0), 0);
  appendFileSync(episodesPath, JSON.stringify(value) + '\n');
  episodes.push(value);
  if (episodes.length % 9 === 0) saveReport();
  console.log(
    JSON.stringify({
      episode: id,
      status: value.status,
      completed: episodes.length,
      total: selected.length * selectedRoutes.length * repeats,
      error: value.error ?? null,
    }),
  );
  if (typeof value.error === 'string' && /BUDGET_EXHAUSTED|CIRCUIT_OPEN/.test(value.error))
    throw new Error(value.error);
}
let frozenSnapshot: string | undefined;
try {
  const before = await db.fingerprint();
  if (existsSync(`${path}/before.json`)) {
    frozenSnapshot = JSON.parse(readFileSync(`${path}/before.json`, 'utf8')).fingerprint;
    if (frozenSnapshot !== before) throw new Error('RESEARCH_RESUME_DATABASE_CHANGED');
  } else {
    frozenSnapshot = before;
    atomicJson(`${path}/before.json`, { fingerprint: before });
  }
  snapshotIntegrity = { ...snapshotIntegrity, before: frozenSnapshot ?? null };
  for (let repeat = 0; repeat < repeats; repeat++)
    for (let i = 0; i < selected.length; i++) {
      const offset = (i + repeat) % selectedRoutes.length;
      const rotated = [...selectedRoutes.slice(offset), ...selectedRoutes.slice(0, offset)];
      for (const route of rotated) await episode(route, selected[i], repeat, before);
    }
  saveReport();
} finally {
  try {
    const after = await db.fingerprint();
    snapshotIntegrity = {
      status: frozenSnapshot === after ? 'verified' : 'changed',
      before: frozenSnapshot ?? null,
      after,
      scope: 'ledger_and_corpus',
    };
    if (sourceManifest().hash !== source.hash) {
      snapshotIntegrity = { ...snapshotIntegrity, status: 'unverified', reason: 'SOURCE_CHANGED_DURING_RUN' };
      process.exitCode = 1;
    }
    atomicJson(`${path}/after.json`, {
      fingerprint: after,
      unchanged: frozenSnapshot === after,
      complete: episodes.length === selected.length * selectedRoutes.length * repeats,
    });
    if (frozenSnapshot && frozenSnapshot !== after) process.exitCode = 1;
  } catch {
    snapshotIntegrity = {
      status: 'unverified',
      before: frozenSnapshot ?? null,
      after: null,
      scope: 'ledger_and_corpus',
      reason: 'AFTER_CHECK_UNAVAILABLE',
    };
    atomicJson(`${path}/after.json`, {
      fingerprint: null,
      unchanged: null,
      error: 'AFTER_CHECK_UNAVAILABLE',
      complete: false,
    });
    process.exitCode = 1;
  }
  saveReport();
  unlinkSync(lockPath);
}
