/** Frozen, secondary analysis weights; never used to select model prompts or replace task success. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, ROUTES } from '../research/scoring';
import type { StudyReport } from '../research/report';
import type { CommonValidityNotice } from './analyze-common-capabilities';

export const SENSITIVITY_WEIGHTS = [
  { id: 'original', label: 'Original', factual: 40, completion: 20, grounding: 20, uncertainty: 10 },
  {
    id: 'financial',
    label: 'Financial emphasis',
    factual: 50,
    completion: 15,
    grounding: 15,
    uncertainty: 10,
  },
  { id: 'evidence', label: 'Evidence emphasis', factual: 30, completion: 15, grounding: 35, uncertainty: 10 },
  {
    id: 'uncertainty',
    label: 'Uncertainty emphasis',
    factual: 30,
    completion: 15,
    grounding: 20,
    uncertainty: 25,
  },
  {
    id: 'equal',
    label: 'Equal dimensions',
    factual: 22.5,
    completion: 22.5,
    grounding: 22.5,
    uncertainty: 22.5,
  },
] as const;
const maxima = { factual: 40, completion: 20, grounding: 20, uncertainty: 10 } as const;
const components = Object.keys(maxima) as (keyof typeof maxima)[];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const digest = (text: unknown): text is string => typeof text === 'string' && /^[a-f0-9]{64}$/.test(text);
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rounded = (value: number | null) => (value === null ? null : Math.round(value * 10000) / 10000);
export function weightSensitivity(
  primary: StudyReport,
  options: { validityNotice?: CommonValidityNotice; primaryReportSha256?: string } = {},
) {
  if (
    new Set(primary.scores.map((s) => s.id)).size !== primary.scores.length ||
    new Set(primary.scores.map((s) => `${s.route}:${s.questionId}:${s.repeat}`)).size !==
      primary.scores.length
  )
    throw new Error('DUPLICATE_SCORE');
  if (
    primary.routes.length !== 9 ||
    new Set(primary.routes.map((r) => r.route)).size !== 9 ||
    primary.routes.some((r) => !ROUTES.includes(r.route))
  )
    throw new Error('INVALID_ROUTE_SET');
  for (const score of primary.scores) {
    if (
      !ROUTES.includes(score.route) ||
      !FAMILIES.includes(score.family) ||
      components.some(
        (name) => !Number.isFinite(score[name]) || score[name] < 0 || score[name] > maxima[name],
      )
    )
      throw new Error('INVALID_SCORE_COMPONENT');
    if (score.status === 'error' && components.some((name) => score[name] !== 0))
      throw new Error('ERROR_HAS_NONZERO_COMPONENT');
  }
  const notice = options.validityNotice ?? null;
  const noticeBound =
    notice === null
      ? null
      : notice.schemaVersion === 1 &&
        notice.runId === primary.runId &&
        digest(notice.originalResultsSha256) &&
        notice.originalResultsSha256 === options.primaryReportSha256;
  const noticeAllowsSelection =
    notice === null || (noticeBound === true && notice.eligibleForSelection === true);
  const fingerprint = primary.snapshotIntegrity;
  const complete =
    primary.complete &&
    primary.routes.every(
      (r) =>
        r.complete &&
        r.episodes === r.plannedEpisodes &&
        primary.scores.filter((s) => s.route === r.route).length === r.episodes,
    );
  const integrity =
    primary.eligibleForConclusion &&
    fingerprint?.status === 'verified' &&
    fingerprint.scope === 'ledger_and_corpus' &&
    digest(fingerprint.before) &&
    fingerprint.before === fingerprint.after;
  const eligible =
    complete &&
    integrity &&
    noticeAllowsSelection &&
    ROUTES.every((route) =>
      FAMILIES.every((family) => primary.scores.some((s) => s.route === route && s.family === family)),
    );
  const routes = ROUTES.map((route) => {
    const original = primary.routes.find((r) => r.route === route)!;
    const scores = primary.scores.filter((s) => s.route === route);
    const disqualified = original.disqualified || scores.some((s) => s.hardGateViolations.length > 0);
    const columns = SENSITIVITY_WEIGHTS.map((weight) => {
      const value = (s: (typeof scores)[number]) =>
        components.reduce((sum, name) => sum + (weight[name] * s[name]) / maxima[name], 0);
      const families = FAMILIES.map((family) => {
        const rows = scores.filter((s) => s.family === family);
        return { family, episodes: rows.length, meanScore90: rounded(mean(rows.map(value))) };
      });
      return {
        id: weight.id,
        meanScore90: rounded(mean(scores.map(value))),
        familyMacro90: families.every((f) => f.meanScore90 !== null)
          ? rounded(mean(families.map((f) => f.meanScore90!)))
          : null,
        families,
        rank: null as number | null,
      };
    });
    return {
      route,
      episodes: scores.length,
      plannedEpisodes: original.plannedEpisodes,
      missingEpisodes: original.missingEpisodes,
      errors: scores.filter((s) => s.status === 'error').length,
      disqualified,
      primaryMacroSuccess: original.macroSuccessRate,
      columns,
      minimumRank: null as number | null,
      maximumRank: null as number | null,
    };
  });
  if (eligible) {
    for (const route of routes.filter((r) => !r.disqualified)) {
      for (const column of route.columns) {
        if (column.familyMacro90 !== null)
          column.rank =
            1 +
            routes.filter(
              (other) =>
                !other.disqualified &&
                other.columns.find((c) => c.id === column.id)!.familyMacro90! >
                  column.familyMacro90! + 0.0001,
            ).length;
      }
      const ranks = route.columns.flatMap((c) => (c.rank === null ? [] : [c.rank]));
      route.minimumRank = ranks.length ? Math.min(...ranks) : null;
      route.maximumRank = ranks.length ? Math.max(...ranks) : null;
    }
  }
  return {
    schemaVersion: 1,
    runId: primary.runId,
    split: primary.split,
    weights: SENSITIVITY_WEIGHTS,
    specificationSha256: sha(JSON.stringify(SENSITIVITY_WEIGHTS)),
    complete,
    eligibleForComparativeInterpretation: eligible,
    validityNotice: notice,
    validityNoticeBound: noticeBound,
    routes,
    notes: [
      'Secondary dashboard robustness only. Whole-benchmark six-family task success, paired effects and hard gates remain primary; no winner is chosen from these columns.',
      'Every alternative totals90. Components are normalized by their original maxima40/20/20/10; the unavailable10-point human clarity score is not imputed.',
      'Errors retain zero components; blocks retain their recorded graded components. Missing episodes remain missing, and any invalidity notice supersedes mechanical completeness.',
      'Each headline column is an equal-family mean, unavailable when a family lacks observations. Micro means and per-family counts remain available separately.',
      'Ranks use competition ties and exclude disqualified routes. Ranks are unavailable for incomplete/ineligible studies. Stable ranks do not establish prose faithfulness or statistical superiority.',
      'Weights were fixed before held-out evaluation and were not selected using observed scores. Do not select the most favorable column or average columns into a new objective.',
    ],
  };
}
export function renderSensitivity(report: ReturnType<typeof weightSensitivity>) {
  const num = (n: number | null) => (n === null ? 'N/A' : n.toFixed(2));
  return [
    `# Secondary weight sensitivity: ${report.runId}`,
    '',
    report.eligibleForComparativeInterpretation
      ? 'Complete measurements; secondary sensitivity only, no winner selected.'
      : '**Diagnostic only: incomplete or ineligible study. No ranking or selection claim.**',
    '',
    report.validityNotice
      ? `Post-run validity: ${report.validityNotice.classification ?? 'notice present'}; original-report binding ${report.validityNoticeBound ? 'verified' : 'unverified'}.`
      : '',
    `Specification SHA-256: ${report.specificationSha256}`,
    '',
    '| Route | Recorded/planned | Errors | ' +
      report.weights.map((w) => w.label + ' /90').join(' | ') +
      ' | Rank range |',
    '| --- | ---: | ---: | ' + report.weights.map(() => '---:').join(' | ') + ' | --- |',
    ...report.routes.map(
      (r) =>
        `| ${r.route}${r.disqualified ? ' DISQUALIFIED' : ''} | ${r.episodes}/${r.plannedEpisodes} | ${r.errors} | ${r.columns.map((c) => num(c.familyMacro90)).join(' | ')} | ${r.minimumRank === null ? 'N/A' : `${r.minimumRank}–${r.maximumRank}`} |`,
    ),
    '',
    'All columns above are equal-family macro means; see sensitivity.json for micro means and per-family counts.',
    '',
    '## Fixed weights',
    '',
    '| Weighting | Factual | Completion | Grounding | Uncertainty |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.weights.map(
      (w) => `| ${w.label} | ${w.factual} | ${w.completion} | ${w.grounding} | ${w.uncertainty} |`,
    ),
    '',
    '## Limits',
    '',
    ...report.notes.map((n) => `- ${n}`),
    '',
  ].join('\n');
}
export function runSensitivity(directory: string) {
  const primaryText = readFileSync(join(directory, 'results.json'), 'utf8');
  const noticePath = join(directory, 'validity-notice.json');
  const noticeText = existsSync(noticePath) ? readFileSync(noticePath, 'utf8') : null;
  const report = weightSensitivity(JSON.parse(primaryText), {
    validityNotice: noticeText ? JSON.parse(noticeText) : undefined,
    primaryReportSha256: sha(primaryText),
  });
  const output = join(directory, 'sensitivity');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'sensitivity.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(output, 'report.md'), renderSensitivity(report));
  writeFileSync(
    join(output, 'analysis-provenance.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        runId: report.runId,
        specificationSha256: report.specificationSha256,
        primaryReportSha256: sha(primaryText),
        validityNoticeSha256: noticeText ? sha(noticeText) : null,
        analyzerSha256: sha(readFileSync(fileURLToPath(import.meta.url), 'utf8')),
      },
      null,
      2,
    ) + '\n',
  );
  return { output, eligible: report.eligibleForComparativeInterpretation };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error('Usage: node --import tsx scripts/analyze-weight-sensitivity.ts <run-directory>');
  console.log(JSON.stringify(runSensitivity(process.argv[2])));
}
