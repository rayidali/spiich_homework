/** Provider-free postprocessing; intentionally outside the frozen inference source tree. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import type { UsageRecord } from '../research/budget';

// Enough precision for exact sums of <=100,000 finite IEEE-754 values after decimal serialization.
// This cannot recover precision already lost when the original ledger calculated a Number.
const Exact = Decimal.clone({ precision: 1000, toExpNeg: -1000, toExpPos: 1000 });
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const COST_PHASES = [
  'main_holdout',
  'reviewer_holdout',
  'reviewer_development',
  'development_pilots_smokes',
  'indexing_preflight',
  'recovery_key_quota',
  'recovery_transport',
  'recovery_prelaunch_continuation',
  'recovery_operator',
] as const;
type Phase = (typeof COST_PHASES)[number];
type Period = 'baseline' | 'additional';
type HttpOutcome = 'http_2xx' | 'http_other' | 'unobserved';
const kinds = [
  'generate',
  'critic',
  'embed',
  'file-search-query',
  'file-store',
  'file-index',
  'file-poll',
  'jev-systemone',
  'jev-rerank',
  'jev-verify',
];
const safeId = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,239}$/;
const runId = /^[A-Za-z0-9_-]{1,60}$/;
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

export interface CostOptions {
  baselineCount: number;
  mainRunId: string;
  reviewerRunId: string;
  /** Explicit, hashed metadata classifications for previously unrecognized setup/development IDs. */
  extraClassifications?: { episode: string; phase: 'indexing_preflight' | 'development_pilots_smokes' }[];
}
export interface CostTotals {
  records: number;
  knownCostRecords: number;
  unknownCostRecords: number;
  http2xxRecords: number;
  otherHttpRecords: number;
  unobservedHttpRecords: number;
  knownCostAboveReservationRecords: number;
  reportedEstimateUsd: string;
  unknownCostReservationUsd: string;
  countedUsd: string;
  allReservationsUsd: string;
}
export interface CostReconciliation {
  schemaVersion: 1;
  accounting: string;
  baselineCount: number;
  additionalCount: number;
  mainRunId: string;
  reviewerRunId: string;
  total: CostTotals;
  byProvider: { provider: UsageRecord['provider']; totals: CostTotals }[];
  byPeriod: { period: Period; totals: CostTotals }[];
  byPhase: { phase: Phase; totals: CostTotals }[];
  details: {
    period: Period;
    phase: Phase;
    provider: UsageRecord['provider'];
    kind: string;
    httpOutcome: HttpOutcome;
    totals: CostTotals;
  }[];
  partitionChecks: { phase: true; provider: true; period: true; detail: true };
  scope: string[];
}
const fail = (code: string): never => {
  throw new Error(`COST_RECONCILIATION_${code}`);
};

/** Only these 12 fields can reach the public export. Extra private fields are never copied. */
export function sanitizeUsage(input: unknown): UsageRecord[] {
  if (!Array.isArray(input) || input.length > 100000) return fail('INVALID_LEDGER');
  const seen = new Set<string>();
  const nonnegative = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('INVALID_RECORD');
    const r = raw as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      !safeId.test(r.id) ||
      seen.has(r.id) ||
      typeof r.episode !== 'string' ||
      !safeId.test(r.episode) ||
      typeof r.provider !== 'string' ||
      !['gemini', 'jev'].includes(r.provider) ||
      typeof r.kind !== 'string' ||
      !kinds.includes(r.kind) ||
      typeof r.model !== 'string' ||
      !/^(?:gemini-[a-z0-9.-]{1,80}|jev-[0-9.]{1,30})$/.test(r.model) ||
      typeof r.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.at) ||
      !Number.isFinite(Date.parse(r.at)) ||
      new Date(r.at).toISOString() !== r.at ||
      !nonnegative(r.reserveUsd) ||
      !(r.estimatedUsd === null || nonnegative(r.estimatedUsd)) ||
      !['inputTokens', 'outputTokens'].every(
        (key) => r[key] === null || (nonnegative(r[key]) && Number.isSafeInteger(r[key])),
      ) ||
      !(r.durationMs === null || nonnegative(r.durationMs)) ||
      !(
        r.status === null ||
        (Number.isInteger(r.status) && Number(r.status) >= 100 && Number(r.status) <= 599)
      ) ||
      (r.provider === 'jev') !== r.kind.startsWith('jev-') ||
      (r.provider === 'jev') !== r.model.startsWith('jev-')
    )
      return fail('INVALID_RECORD');
    seen.add(r.id);
    return {
      id: r.id,
      episode: r.episode,
      provider: r.provider as UsageRecord['provider'],
      kind: r.kind,
      model: r.model,
      at: r.at,
      reserveUsd: r.reserveUsd,
      estimatedUsd: r.estimatedUsd as number | null,
      status: r.status as number | null,
      inputTokens: r.inputTokens as number | null,
      outputTokens: r.outputTokens as number | null,
      durationMs: r.durationMs as number | null,
    };
  });
}

function builtInPhases(episode: string, options: CostOptions): Phase[] {
  const matches: Phase[] = [];
  const segments = episode.split(':');
  const mainShape =
    segments.length === 4 &&
    /^R[0-8]$/.test(segments[1]) &&
    /^[a-z][a-z0-9-]*$/.test(segments[2]) &&
    /^[0-9]+$/.test(segments[3]);
  const reviewerShape =
    segments.length === 4 &&
    ['deterministic', 'llm', 'jev'].includes(segments[2]) &&
    /^[a-z0-9_-]+$/.test(segments[3]);
  if (segments[0] === options.mainRunId && mainShape) matches.push('main_holdout');
  if (segments[0] === options.reviewerRunId && reviewerShape) {
    if (segments[1] === 'holdout') matches.push('reviewer_holdout');
    if (segments[1] === 'development') matches.push('reviewer_development');
  }
  if (mainShape && /^(?:pilot|smoke|development)-v[1-9][0-9]*$/.test(segments[0]))
    matches.push('development_pilots_smokes');
  if (
    episode === 'setup' ||
    /^index:(?:files|vectors)$/.test(episode) ||
    /^(?:provider|retrieval)-smoke-v[1-9][0-9]*$/.test(episode) ||
    /^route-preflight-R[0-8]-[a-z][a-z0-9-]*-[0-9]{13}$/.test(episode) ||
    /^current-key-index-access:[0-9]{13}$/.test(episode)
  )
    matches.push('indexing_preflight');
  for (const [prefix, phase] of [
    ['recovery-probe', 'recovery_key_quota'],
    ['transport-recovery-probe', 'recovery_transport'],
    ['prelaunch-continuation-probe', 'recovery_prelaunch_continuation'],
  ] as const)
    if (new RegExp(`^${prefix}:${uuid}$`).test(episode)) matches.push(phase);
  if (new RegExp(`^operator-probe:${uuid}:${uuid}$`).test(episode)) matches.push('recovery_operator');
  return matches;
}

function validateOptions(options: CostOptions, records: UsageRecord[]) {
  if (
    !Number.isSafeInteger(options.baselineCount) ||
    options.baselineCount < 0 ||
    options.baselineCount > records.length ||
    !runId.test(options.mainRunId) ||
    !runId.test(options.reviewerRunId) ||
    options.mainRunId === options.reviewerRunId
  )
    fail('INVALID_OPTIONS');
  const extras = options.extraClassifications ?? [];
  if (!Array.isArray(extras)) fail('INVALID_CLASSIFICATIONS');
  const seen = new Set<string>();
  for (const entry of extras) {
    if (
      !entry ||
      Object.keys(entry).sort().join(',') !== 'episode,phase' ||
      typeof entry.episode !== 'string' ||
      !safeId.test(entry.episode) ||
      !['indexing_preflight', 'development_pilots_smokes'].includes(entry.phase) ||
      seen.has(entry.episode) ||
      builtInPhases(entry.episode, options).length ||
      /^(?:holdout|verifiers|recovery-probe|transport-recovery-probe|prelaunch-continuation-probe|operator-probe)(?:[-:]|$)/.test(
        entry.episode,
      ) ||
      entry.episode.startsWith(`${options.mainRunId}:`) ||
      entry.episode.startsWith(`${options.reviewerRunId}:`) ||
      !records.some((r) => r.episode === entry.episode)
    )
      fail('INVALID_CLASSIFICATIONS');
    seen.add(entry.episode);
  }
}
export function classifyCostEpisode(episode: string, options: CostOptions): Phase {
  const matches = [
    ...builtInPhases(episode, options),
    ...(options.extraClassifications ?? []).filter((x) => x.episode === episode).map((x) => x.phase),
  ];
  if (matches.length === 0) return fail('UNCLASSIFIED_EPISODE');
  if (matches.length !== 1) return fail('OVERLAPPING_CLASSIFICATIONS');
  return matches[0];
}
const httpOutcome = (r: UsageRecord): HttpOutcome =>
  r.status === null ? 'unobserved' : r.status >= 200 && r.status < 300 ? 'http_2xx' : 'http_other';
function totals(records: UsageRecord[]): CostTotals {
  const sum = (select: (r: UsageRecord) => number) =>
    records.reduce((acc, r) => acc.plus(String(select(r))), new Exact(0)).toFixed();
  return {
    records: records.length,
    knownCostRecords: records.filter((r) => r.estimatedUsd !== null).length,
    unknownCostRecords: records.filter((r) => r.estimatedUsd === null).length,
    http2xxRecords: records.filter((r) => httpOutcome(r) === 'http_2xx').length,
    otherHttpRecords: records.filter((r) => httpOutcome(r) === 'http_other').length,
    unobservedHttpRecords: records.filter((r) => httpOutcome(r) === 'unobserved').length,
    knownCostAboveReservationRecords: records.filter(
      (r) => r.estimatedUsd !== null && r.estimatedUsd > r.reserveUsd,
    ).length,
    reportedEstimateUsd: sum((r) => r.estimatedUsd ?? 0),
    unknownCostReservationUsd: sum((r) => (r.estimatedUsd === null ? r.reserveUsd : 0)),
    countedUsd: sum((r) => r.estimatedUsd ?? r.reserveUsd),
    allReservationsUsd: sum((r) => r.reserveUsd),
  };
}
function assertPartition(whole: CostTotals, parts: CostTotals[]) {
  for (const key of Object.keys(whole) as (keyof CostTotals)[]) {
    const sum = parts.reduce((acc, part) => acc.plus(String(part[key])), new Exact(0));
    if (!sum.equals(String(whole[key]))) fail('PARTITION_MISMATCH');
  }
}

export function reconcileUsage(
  input: unknown,
  options: CostOptions,
): { usage: UsageRecord[]; report: CostReconciliation } {
  const usage = sanitizeUsage(input);
  validateOptions(options, usage);
  const rows = usage.map((record, index) => ({
    record,
    phase: classifyCostEpisode(record.episode, options),
    period: (index < options.baselineCount ? 'baseline' : 'additional') as Period,
  }));
  const total = totals(usage);
  const byProvider = (['gemini', 'jev'] as const).map((provider) => ({
    provider,
    totals: totals(usage.filter((r) => r.provider === provider)),
  }));
  const byPeriod = (['baseline', 'additional'] as const).map((period) => ({
    period,
    totals: totals(rows.filter((r) => r.period === period).map((r) => r.record)),
  }));
  const byPhase = COST_PHASES.map((phase) => ({
    phase,
    totals: totals(rows.filter((r) => r.phase === phase).map((r) => r.record)),
  }));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = [row.period, row.phase, row.record.provider, row.record.kind, httpOutcome(row.record)].join(
      '|',
    );
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const details = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      period: group[0].period,
      phase: group[0].phase,
      provider: group[0].record.provider,
      kind: group[0].record.kind,
      httpOutcome: httpOutcome(group[0].record),
      totals: totals(group.map((r) => r.record)),
    }));
  for (const partition of [byProvider, byPeriod, byPhase, details])
    assertPartition(
      total,
      partition.map((p) => p.totals),
    );
  return {
    usage,
    report: {
      schemaVersion: 1,
      accounting:
        'Exact decimal addition of the stored serialized numbers; counted = reported estimate where present, otherwise retained reservation. Not a provider invoice.',
      baselineCount: options.baselineCount,
      additionalCount: usage.length - options.baselineCount,
      mainRunId: options.mainRunId,
      reviewerRunId: options.reviewerRunId,
      total,
      byProvider,
      byPeriod,
      byPhase,
      details,
      partitionChecks: { phase: true, provider: true, period: true, detail: true },
      scope: [
        'Records count reservations, not proven network calls. A local rejection can still retain a reservation.',
        'Unknown costs include successful embeddings without reported usage; HTTP status and request kind remain separate.',
        'A known estimate of zero remains known; missing usage never becomes a zero estimate.',
        'All four operational recovery categories are overhead, excluded from route accuracy and route-only costs.',
        'Baseline/additional is the immutable ledger position boundary, not a date or an inferred billing period.',
        'Stored estimates and original reserves are not repriced or retroactively rounded. Prior Number precision cannot be restored.',
        'This is the shared research ledger only; production traffic, unrecorded external services and actual account balance are outside its scope.',
        'The exporter checks a quiescent local snapshot, not experiment completion or scientific validity; those require the run audits.',
      ],
    },
  };
}

export function renderCostMarkdown(report: CostReconciliation): string {
  const header =
    '| Category | Records | Reported estimate USD | Unknown reservation USD | Counted USD |\n| --- | ---: | ---: | ---: | ---: |';
  const row = (name: string, t: CostTotals) =>
    `| ${name} | ${t.records} | ${t.reportedEstimateUsd} | ${t.unknownCostReservationUsd} | ${t.countedUsd} |`;
  return `# Research cost reconciliation\n\n${report.accounting}\n\n${header}\n${row('All research records', report.total)}\n${report.byProvider.map((p) => row(p.provider, p.totals)).join('\n')}\n${report.byPeriod.map((p) => row(p.period, p.totals)).join('\n')}\n\nProvider and baseline/additional rows are alternative partitions, not extra costs to add together.\n\n${header}\n${report.byPhase.map((p) => row(p.phase, p.totals)).join('\n')}\n\n${report.scope.map((s) => `- ${s}`).join('\n')}\n\nThe JSON detail table partitions each phase by provider, baseline/additional, request kind and observed HTTP outcome. Exact totals retain serialized precision; do not add independently rounded display values.\n`;
}

function assertQuiescent(ledger: string) {
  for (const path of [
    `${ledger}.lock`,
    join(dirname(ledger), 'runner.lock'),
    join(dirname(ledger), 'pump-owner.lock'),
  ]) {
    if (existsSync(path)) fail('ACTIVE_OR_STALE_LOCK');
  }
  const queue = join(dirname(ledger), 'queue');
  if (existsSync(queue)) {
    for (const name of readdirSync(queue)) {
      if (name.endsWith('.ready')) fail('OUTSTANDING_REQUEST');
      if (name.endsWith('.claimed')) {
        const done = join(queue, name.slice(0, -'.claimed'.length) + '.done');
        if (
          !existsSync(done) ||
          !/^\d{3}\s+[0-9.]+\s+\d+\s+DAYBOOK_HTTP_DONE_V1\s*$/.test(readFileSync(done, 'utf8'))
        )
          fail('OUTSTANDING_REQUEST');
      }
    }
  }
}
export function exportCostSnapshot(ledger: string, output: string, options: CostOptions) {
  assertQuiescent(ledger);
  if (existsSync(output)) fail('OUTPUT_EXISTS');
  let bytes: Buffer;
  let input: unknown;
  try {
    bytes = readFileSync(ledger);
    input = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('UNREADABLE_LEDGER');
  }
  const { usage, report } = reconcileUsage(input, options);
  const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';
  const sanitized = json(usage),
    reportJson = json(report);
  assertQuiescent(ledger);
  if (!readFileSync(ledger).equals(bytes)) fail('LEDGER_CHANGED');
  const provenance = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    recordCount: usage.length,
    baselineCount: options.baselineCount,
    mainRunId: options.mainRunId,
    reviewerRunId: options.reviewerRunId,
    ledgerSha256: sha(bytes),
    usageSha256: sha(sanitized),
    reportSha256: sha(reportJson),
    sanitizedBaselinePrefixSha256: sha(JSON.stringify(usage.slice(0, options.baselineCount))),
    analyzerSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    classifications: options.extraClassifications ?? [],
    classificationsSha256: sha(JSON.stringify(options.extraClassifications ?? [])),
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'all-study-usage.json'), sanitized, { flag: 'wx' });
  writeFileSync(join(output, 'cost-reconciliation.json'), reportJson, { flag: 'wx' });
  writeFileSync(join(output, 'cost-reconciliation.md'), renderCostMarkdown(report), { flag: 'wx' });
  // The provenance file is the commit marker. A partial export without it is not complete.
  assertQuiescent(ledger);
  if (!readFileSync(ledger).equals(bytes)) fail('LEDGER_CHANGED');
  writeFileSync(join(output, 'analysis-provenance.json'), json(provenance), { flag: 'wx' });
  return provenance;
}

function main() {
  const args = process.argv.slice(2),
    values = new Map<string, string>();
  const allowed = [
    '--ledger',
    '--output',
    '--baseline-count',
    '--main-run',
    '--reviewer-run',
    '--classifications',
  ];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || values.has(args[i])) fail('INVALID_ARGUMENTS');
    values.set(args[i], args[i + 1]);
  }
  if (!values.has('--ledger') || !values.has('--output')) fail('INVALID_ARGUMENTS');
  let extras: CostOptions['extraClassifications'];
  if (values.has('--classifications')) {
    try {
      extras = JSON.parse(readFileSync(values.get('--classifications')!, 'utf8'));
    } catch {
      fail('INVALID_CLASSIFICATIONS');
    }
  }
  const result = exportCostSnapshot(resolve(values.get('--ledger')!), resolve(values.get('--output')!), {
    baselineCount: Number(values.get('--baseline-count') ?? '841'),
    mainRunId: values.get('--main-run') ?? 'holdout-v1',
    reviewerRunId: values.get('--reviewer-run') ?? 'verifiers-v1',
    extraClassifications: extras,
  });
  console.log(JSON.stringify({ exportedRecords: result.recordCount, usageSha256: result.usageSha256 }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const code =
      error instanceof Error && /^COST_RECONCILIATION_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'COST_RECONCILIATION_FAILED';
    console.error(code);
    process.exitCode = 1;
  }
}
