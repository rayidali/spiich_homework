/** Pure held-out analysis. Questions, oracle labels and provider access are not
 * loaded here. One question is one paired unit; route executions are not
 * independent samples and duplicate/rerun cells cannot enlarge the sample. */
import { createHash } from 'node:crypto';
import { Decimal } from '../../shared/money';
import { PROTOCOL, attemptsForRoute } from './protocol';
import type { CompletenessRoute, CompletenessScore } from './types';

const routes = PROTOCOL.routes;
const candidates = ['adaptive', 'complete'] as const;
type Family = (typeof PROTOCOL.families)[number];
export type CompletenessObservation = {
  caseId: string;
  route: CompletenessRoute;
  score: CompletenessScore;
  durationMs?: number;
  attempts?: number;
  knownUsd?: string;
  unknownReservedUsd?: string;
};
export type CompletenessAnalysisInput = {
  cases: { id: string; family: string }[];
  observations: CompletenessObservation[];
};
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`COMPLETENESS_ANALYSIS_${code}`);
}
const uniqueStrings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'string') &&
  new Set(value).size === value.length;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const money = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+(?:\.\d{1,12})?$/.test(value);

/** Conditional exact one-sided McNemar/binomial test: candidate improvement.
 * The null assigns equal probability to either direction of each discordance. */
export function exactPairedImprovement(candidateOnly: number, controlOnly: number) {
  check(integer(candidateOnly) && integer(controlOnly) && candidateOnly + controlOnly <= 16, 'PAIR_COUNTS');
  const n = candidateOnly + controlOnly;
  let choose = 1n,
    numerator = 0n;
  for (let k = 0; k <= n; k++) {
    if (k >= candidateOnly) numerator += choose;
    if (k < n) choose = (choose * BigInt(n - k)) / BigInt(k + 1);
  }
  const denominator = 2n ** BigInt(n);
  return {
    p: Number(numerator) / Number(denominator),
    numerator: String(numerator),
    denominator: String(denominator),
  };
}
export function wilsonInterval(passed: number, n: number) {
  check(integer(passed) && integer(n) && passed <= n, 'INTERVAL_COUNTS');
  if (!n) return null;
  const z = 1.959963984540054,
    p = passed / n,
    d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return {
    level: 0.95,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
    exploratory: true as const,
  };
}
function validate(input: CompletenessAnalysisInput) {
  check(input.cases.length === PROTOCOL.phases.holdout.cases, 'CASE_COUNT');
  const cases = new Map(input.cases.map((item) => [item.id, item]));
  check(
    cases.size === input.cases.length && input.cases.every((item) => /^[A-Za-z0-9_-]{1,64}$/.test(item.id)),
    'CASE_ID',
  );
  check(
    input.cases.every((item) => PROTOCOL.families.includes(item.family as Family)),
    'FAMILY',
  );
  for (const family of PROTOCOL.families)
    check(input.cases.filter((item) => item.family === family).length === 4, 'FAMILY_COUNT');
  const cells = new Map<string, CompletenessObservation>();
  for (const item of input.observations) {
    const expected = cases.get(item.caseId),
      s = item.score;
    check(expected && routes.includes(item.route), 'UNKNOWN_CELL');
    const key = `${item.route}/${item.caseId}`;
    check(!cells.has(key), 'DUPLICATE_CELL');
    check(
      s && s.caseId === item.caseId && s.split === 'holdout' && s.family === expected.family,
      'SCORE_BINDING',
    );
    check(
      [
        'structured-correct',
        'wrong-answer',
        'partial-answer',
        'safe-no-answer',
        'execution-error',
        'ungradable',
      ].includes(s.classification),
      'CLASSIFICATION',
    );
    check(
      typeof s.passed === 'boolean' &&
        typeof s.focusCorrect === 'boolean' &&
        integer(s.requiredClaims) &&
        uniqueStrings(s.matchedClaims) &&
        s.matchedClaims.length <= s.requiredClaims &&
        uniqueStrings(s.matchedTables) &&
        uniqueStrings(s.primaryMatched) &&
        uniqueStrings(s.wrongFinancialClaims) &&
        uniqueStrings(s.hardBoundaryViolations) &&
        Array.isArray(s.reasons) &&
        s.reasons.every((reason) => typeof reason === 'string') &&
        integer(s.verifiedExtraClaims) &&
        integer(s.unverifiableExtraClaims) &&
        s.modelCompletionIgnored === true &&
        s.wordingReview === 'not_model_judged',
      'SCORE_INVALID',
    );
    check(
      !s.passed ||
        (s.classification === 'structured-correct' &&
          s.focusCorrect &&
          s.matchedClaims.length === s.requiredClaims &&
          !s.wrongFinancialClaims.length &&
          !s.hardBoundaryViolations.length &&
          !s.unverifiableExtraClaims),
      'PASS_CONTRADICTION',
    );
    check(
      item.attempts === undefined ||
        (integer(item.attempts) && item.attempts <= attemptsForRoute(item.route)),
      'ATTEMPTS',
    );
    check(
      item.durationMs === undefined || (Number.isFinite(item.durationMs) && item.durationMs >= 0),
      'DURATION',
    );
    check(
      (item.knownUsd === undefined && item.unknownReservedUsd === undefined) ||
        (money(item.knownUsd) && money(item.unknownReservedUsd)),
      'COST',
    );
    cells.set(key, item);
  }
  return cells;
}
function counts(items: CompletenessObservation[], planned: number) {
  const passed = items.filter((item) => item.score.passed).length;
  const requiredClaims = items.reduce((n, item) => n + item.score.requiredClaims, 0);
  const matchedClaims = items.reduce((n, item) => n + item.score.matchedClaims.length, 0);
  return {
    planned,
    observed: items.length,
    passed,
    complete: items.length === planned,
    passRate: items.length === planned ? passed / planned : null,
    wilson95: items.length === planned ? wilsonInterval(passed, planned) : null,
    focusCorrect: items.filter((item) => item.score.focusCorrect).length,
    claimCoverage: {
      required: requiredClaims,
      matched: matchedClaims,
      fraction: requiredClaims ? matchedClaims / requiredClaims : null,
    },
    matchedTables: items.reduce((n, item) => n + item.score.matchedTables.length, 0),
    wrongFinancialCases: items.filter((item) => item.score.wrongFinancialClaims.length).length,
    wrongFinancialClaims: items.reduce((n, item) => n + item.score.wrongFinancialClaims.length, 0),
    hardBoundaryCases: items.filter((item) => item.score.hardBoundaryViolations.length).length,
    hardBoundaryViolations: items.reduce((n, item) => n + item.score.hardBoundaryViolations.length, 0),
    unverifiableExtraClaims: items.reduce((n, item) => n + item.score.unverifiableExtraClaims, 0),
    classifications: Object.fromEntries(
      [
        'structured-correct',
        'wrong-answer',
        'partial-answer',
        'safe-no-answer',
        'execution-error',
        'ungradable',
      ].map((name) => [name, items.filter((item) => item.score.classification === name).length]),
    ),
  };
}
function operational(items: CompletenessObservation[], passed: number) {
  const duration = items
    .flatMap((item) => (item.durationMs === undefined ? [] : [item.durationMs]))
    .sort((a, b) => a - b);
  const attempts = items.flatMap((item) => (item.attempts === undefined ? [] : [item.attempts]));
  const costs = items.filter((item) => item.knownUsd !== undefined);
  const known = costs.reduce((sum, item) => sum.plus(item.knownUsd!), new Decimal(0));
  const unknown = costs.reduce((sum, item) => sum.plus(item.unknownReservedUsd!), new Decimal(0));
  return {
    duration: duration.length
      ? {
          reportedExecutions: duration.length,
          meanMs: duration.reduce((a, b) => a + b, 0) / duration.length,
          medianMs:
            (duration[Math.floor((duration.length - 1) / 2)] + duration[Math.floor(duration.length / 2)]) / 2,
          p95Ms: duration[Math.ceil(duration.length * 0.95) - 1],
        }
      : null,
    attempts: attempts.length
      ? { reportedExecutions: attempts.length, total: attempts.reduce((a, b) => a + b, 0) }
      : null,
    cost: costs.length
      ? {
          reportedExecutions: costs.length,
          knownUsd: known.toFixed(),
          unknownReservedUsd: unknown.toFixed(),
          chargedUsd: known.plus(unknown).toFixed(),
          chargedUsdPerCompleteAnswer:
            costs.length === 16 && passed ? known.plus(unknown).div(passed).toFixed() : null,
        }
      : null,
  };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function analyzeCompleteness(input: CompletenessAnalysisInput) {
  const cells = validate(input);
  const complete = cells.size === PROTOCOL.phases.holdout.executions;
  const routeResults = routes.map((route) => {
    const items = input.observations.filter((item) => item.route === route),
      all = counts(items, 16);
    return {
      route,
      ...all,
      families: PROTOCOL.families.map((family) => ({
        family,
        ...counts(
          items.filter((item) => item.score.family === family),
          4,
        ),
      })),
      operational: operational(items, all.passed),
    };
  });
  const comparisons = candidates.map((route) => {
    const pairs = input.cases.flatMap((item) => {
      const control = cells.get(`composable/${item.id}`),
        candidate = cells.get(`${route}/${item.id}`);
      return control && candidate
        ? [
            {
              caseId: item.id,
              family: item.family,
              control: control.score.passed,
              candidate: candidate.score.passed,
            },
          ]
        : [];
    });
    const candidateOnly = pairs.filter((item) => !item.control && item.candidate).length;
    const controlOnly = pairs.filter((item) => item.control && !item.candidate).length;
    return {
      candidate: route,
      control: 'composable' as const,
      pairedCases: pairs.length,
      bothPass: pairs.filter((item) => item.control && item.candidate).length,
      bothFail: pairs.filter((item) => !item.control && !item.candidate).length,
      candidateOnly,
      controlOnly,
      netAdditionalCompleteAnswers: candidateOnly - controlOnly,
      commonRegressions: pairs
        .filter((item) => item.family === 'common' && item.control && !item.candidate)
        .map((item) => item.caseId)
        .sort(),
      pairedDifference: pairs.length === 16 ? (candidateOnly - controlOnly) / 16 : null,
      exactOneSided: complete ? exactPairedImprovement(candidateOnly, controlOnly) : null,
      holmAdjustedP: null as number | null,
    };
  });
  if (complete) {
    let previous = 0;
    [...comparisons]
      .sort((a, b) => a.exactOneSided!.p - b.exactOneSided!.p || a.candidate.localeCompare(b.candidate))
      .forEach((comparison, index) => {
        previous = Math.max(previous, Math.min(1, comparison.exactOneSided!.p * (2 - index)));
        comparison.holmAdjustedP = previous;
      });
  }
  const decisions = comparisons.map((comparison) => {
    const route = routeResults.find((item) => item.route === comparison.candidate)!;
    const gates = {
      completePairedHoldout: complete,
      minimumAdditionalAnswers:
        comparison.netAdditionalCompleteAnswers >= PROTOCOL.adoption.minimumAdditionalCompleteAnswers,
      zeroWrongFinancialClaims: route.wrongFinancialClaims <= PROTOCOL.adoption.wrongFinancialClaimsAllowed,
      zeroHardBoundaryViolations:
        route.hardBoundaryViolations <= PROTOCOL.adoption.hardBoundaryViolationsAllowed,
      noCommonRegressions:
        comparison.commonRegressions.length <= PROTOCOL.adoption.commonQueryRegressionsAllowed,
      allBoundaryCasesPass:
        route.families.find((item) => item.family === 'boundary')!.passed ===
        PROTOCOL.adoption.requiredBoundaryPasses,
      holmImprovement:
        comparison.holmAdjustedP !== null && comparison.holmAdjustedP <= PROTOCOL.adoption.familywiseAlpha,
    };
    return {
      candidate: comparison.candidate,
      gates,
      eligibleForSeparateAcceptance: Object.values(gates).every(Boolean),
      failedGates: Object.entries(gates)
        .filter(([, pass]) => !pass)
        .map(([gate]) => gate),
    };
  });
  return {
    version: 'completeness-analysis-v1',
    protocolVersion: PROTOCOL.version,
    split: 'holdout' as const,
    inputSha256: createHash('sha256')
      .update(
        stable({
          cases: [...input.cases].sort((a, b) => a.id.localeCompare(b.id)),
          observations: [...input.observations].sort((a, b) =>
            `${a.caseId}/${a.route}`.localeCompare(`${b.caseId}/${b.route}`),
          ),
        }),
      )
      .digest('hex'),
    complete,
    plannedQuestions: 16,
    plannedExecutions: 48,
    observedExecutions: cells.size,
    missing: input.cases
      .flatMap((item) =>
        routes
          .filter((route) => !cells.has(`${route}/${item.id}`))
          .map((route) => ({ caseId: item.id, route })),
      )
      .sort((a, b) => `${a.caseId}/${a.route}`.localeCompare(`${b.caseId}/${b.route}`)),
    routes: routeResults,
    comparisons,
    decisions,
    eligibleCandidates: decisions
      .filter((item) => item.eligibleForSeparateAcceptance)
      .map((item) => item.candidate),
    deploymentAction: 'retain_composable_pending_separate_acceptance' as const,
    limitations: [
      'Sixteen synthetic question blocks; three routes are paired, not 48 independent accuracy samples.',
      'Wilson intervals are exploratory and do not establish production accuracy; related questions may be correlated.',
      'Exact paired tests condition on discordances and assume exchangeable directions across question blocks; Holm covers the two declared comparisons only.',
      'External scorer outcomes are analyzed as supplied. Model completion status is not a correctness label; unrestricted prose meaning is not independently judged here.',
      'Claim coverage and answer focus are separate from wrong financial claims. Boundary cases with no required claims have no claim-coverage denominator.',
      'Wrong-financial and hard-boundary counts are detected scorer flags, not an exhaustive tally of every false number; grading may stop at the first invalid row. Case counts identify affected responses.',
      'Cost and duration are descriptive of this execution environment, not load tests or invoice guarantees. Missing metric values are not imputed.',
      'Missing executions prevent eligibility. Passing this screen only identifies candidates for separate acceptance; it never selects or deploys a winner.',
      'Source, fixture, authorization and ledger integrity must be audited separately; this pure analyzer does not authorize spending.',
    ],
  };
}
export type CompletenessAnalysis = ReturnType<typeof analyzeCompleteness>;
const percent = (value: number | null) => (value === null ? 'unavailable' : `${(value * 100).toFixed(1)}%`);
const interval = (value: ReturnType<typeof wilsonInterval>) =>
  value ? `${percent(value.low)}–${percent(value.high)}` : 'unavailable';
export function renderCompletenessMarkdown(analysis: CompletenessAnalysis) {
  const rows = analysis.routes.map(
    (r) =>
      `| ${r.route} | ${r.passed}/${r.planned} (${r.observed} observed) | ${interval(r.wilson95)} | ${r.focusCorrect}/${r.observed} | ${r.claimCoverage.matched}/${r.claimCoverage.required}${r.claimCoverage.fraction === null ? ' (not applicable)' : ''} | ${r.wrongFinancialClaims} | ${r.hardBoundaryViolations} |`,
  );
  const families = analysis.routes.flatMap((r) =>
    r.families.map(
      (f) =>
        `| ${r.route} | ${f.family} | ${f.passed}/${f.planned} (${f.observed} observed) | ${f.focusCorrect} | ${f.claimCoverage.matched}/${f.claimCoverage.required} |`,
    ),
  );
  const paired = analysis.comparisons.map(
    (c) =>
      `| ${c.candidate} | ${c.pairedCases} | ${c.candidateOnly} | ${c.controlOnly} | ${c.netAdditionalCompleteAnswers} | ${c.exactOneSided?.p ?? 'unavailable'} | ${c.holmAdjustedP ?? 'unavailable'} |`,
  );
  const decisions = analysis.decisions.map(
    (d) =>
      `- ${d.candidate}: ${d.eligibleForSeparateAcceptance ? 'eligible for separate acceptance' : 'not eligible'}${d.failedGates.length ? `; unmet gates: ${d.failedGates.join(', ')}` : ''}.`,
  );
  const operations = analysis.routes.map(
    (r) =>
      `| ${r.route} | ${r.operational.attempts ? `${r.operational.attempts.total} (${r.operational.attempts.reportedExecutions} reported)` : 'unavailable'} | ${r.operational.duration ? `${r.operational.duration.medianMs.toFixed(1)} / ${r.operational.duration.p95Ms.toFixed(1)} (${r.operational.duration.reportedExecutions} reported)` : 'unavailable'} | ${r.operational.cost ? `$${r.operational.cost.knownUsd} + $${r.operational.cost.unknownReservedUsd} (${r.operational.cost.reportedExecutions} reported)` : 'unavailable'} |`,
  );
  return `# Three-route held-out comparison\n\nStatus: **${analysis.complete ? 'complete' : 'incomplete'}** (${analysis.observedExecutions}/${analysis.plannedExecutions} executions). Sixteen paired questions. Deployment remains unchanged.\n\n| Route | Complete answers | Exploratory Wilson 95% | Focus correct | Required claims matched | Detected wrong-financial flags | Detected hard-boundary flags |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## Family results\n\n| Route | Family | Complete answers | Focus correct | Required claims matched |\n| --- | --- | --- | --- | --- |\n${families.join('\n')}\n\n## Paired comparisons with composable\n\n| Candidate | Paired questions | Candidate-only passes | Control-only passes | Net gain | Exact one-sided p | Holm-adjusted p |\n| --- | --- | --- | --- | --- | --- | --- |\n${paired.join('\n')}\n\n${decisions.join('\n')}\n\n## Descriptive operations\n\n| Route | Attempts | Median / p95 milliseconds | Known USD + unknown reservations |\n| --- | --- | --- | --- |\n${operations.join('\n')}\n\n${analysis.limitations.map((item) => `- ${item}`).join('\n')}\n\nInput SHA-256: \`${analysis.inputSha256}\`.\n`;
}
export function renderCompletenessSvg(analysis: CompletenessAnalysis) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  const rows = analysis.routes
    .map((route, i) => {
      const y = 105 + i * 72,
        x = 170,
        width = (route.passed / 16) * 400;
      const ci = route.wilson95;
      return `<text x="20" y="${y + 20}">${route.route}</text><rect x="${x}" y="${y}" width="400" height="32" fill="#e2e8f0"/><rect x="${x}" y="${y}" width="${width}" height="32" fill="#2563eb"/>${ci ? `<line x1="${x + ci.low * 400}" x2="${x + ci.high * 400}" y1="${y + 16}" y2="${y + 16}" stroke="#111827" stroke-width="2"/>` : ''}<text x="585" y="${y + 20}">${route.passed}/16 (${route.observed} observed)</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="380" viewBox="0 0 800 380" role="img" aria-labelledby="title desc"><title id="title">Held-out complete answers by route</title><desc id="desc">${escape(`${analysis.complete ? 'Complete' : 'Incomplete'} paired evaluation. Black lines show exploratory Wilson 95 percent intervals only when all 16 executions are present. No deployment decision is automatic.`)}</desc><rect width="800" height="380" fill="white"/><g font-family="sans-serif" font-size="14" fill="#111827"><text x="20" y="30" font-size="21">Complete answers on 16 paired questions</text><text x="20" y="58">${analysis.complete ? 'Complete evaluation' : 'Incomplete evaluation — no candidate eligibility'}</text>${rows}<text x="20" y="340">Exploratory intervals; synthetic sample. Deployment unchanged.</text><text x="20" y="365" font-size="11">Input SHA-256: ${analysis.inputSha256}</text></g></svg>\n`;
}
export function renderCompletenessJson(analysis: CompletenessAnalysis) {
  return JSON.stringify(analysis, null, 2) + '\n';
}
