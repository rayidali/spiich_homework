/** Postprocessing only. This file is outside the frozen model/runtime source tree. */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, pairedDifference, summarizeRoute, type StudyEpisode } from '../research/scoring';
import type { StudyReport } from '../research/report';
import type { ResearchQuestion } from '../research/dataset';

export interface CommonMapping {
  schemaVersion: number;
  id: string;
  sourceSha256: Record<string, string>;
  selectedGroupIds: string[];
  selectedQuestionIds: string[];
  groups: {
    groupId: string;
    questionIds: string[];
    split: string;
    family: string;
    classification: string;
    rationale: string;
  }[];
}
export interface CommonRouteAmendment {
  schemaVersion: 1;
  mappingId: string;
  file: 'research/routes.ts';
  definitionSha256: string;
  comparisonSha256: string;
  reviewedAt: string;
  rationale: string;
}
export interface CommonMetadataAmendment {
  schemaVersion: 2;
  mappingId: string;
  membershipUnchanged: true;
  reviewedAt: string;
  rationale: string;
  changes: {
    file: 'research/baseline.ts' | 'research/routes.ts';
    definitionSha256: string;
    comparisonSha256: string;
    rationale: string;
  }[];
}
export type CommonAmendment = CommonRouteAmendment | CommonMetadataAmendment;
export interface CommonValidityNotice {
  schemaVersion: number;
  runId: string;
  eligibleForSelection: boolean;
  originalResultsSha256: string;
  classification?: string;
  interpretation?: string;
  issues?: { code: string; detail: string }[];
}
interface CommonInput {
  mapping: CommonMapping;
  primary: StudyReport;
  episodes: StudyEpisode[];
  questions: ResearchQuestion[];
  comparisonSourceHashes: Record<string, string>;
  currentQuestionFileSha256: string;
  amendment?: CommonAmendment;
  validityNotice?: CommonValidityNotice;
  primaryReportSha256?: string;
  bootstrapSamples?: number;
}
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const unique = (values: string[]) => new Set(values).size === values.length;
const rate = (value: number | null) => (value === null ? 'N/A' : `${(100 * value).toFixed(1)}%`);
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (v) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[v]!,
  );

export function analyzeCommonCapabilities(input: CommonInput) {
  const { mapping, primary, episodes, questions } = input;
  const samples = input.bootstrapSamples ?? 2000;
  if (!Number.isInteger(samples) || samples < 100 || samples > 100000)
    throw new Error('INVALID_BOOTSTRAP_SAMPLES');
  const byQuestion = new Map(questions.map((q) => [q.id, q]));
  if (
    mapping.schemaVersion !== 1 ||
    !unique(mapping.selectedQuestionIds) ||
    !unique(mapping.selectedGroupIds) ||
    !unique(mapping.groups.map((g) => g.groupId))
  )
    throw new Error('INVALID_COMMON_MAPPING');
  const allIds = mapping.groups.flatMap((g) => g.questionIds);
  if (!unique(allIds) || allIds.length !== questions.length || allIds.some((id) => !byQuestion.has(id)))
    throw new Error('INCOMPLETE_MAPPING_COVERAGE');
  for (const group of mapping.groups) {
    if (
      group.questionIds.length !== 2 ||
      !group.rationale.trim() ||
      group.questionIds.some((id) => {
        const q = byQuestion.get(id)!;
        return q.groupId !== group.groupId || q.family !== group.family || q.split !== group.split;
      })
    )
      throw new Error('MAPPING_GROUP_METADATA_MISMATCH');
  }
  const selectedGroups = mapping.groups.filter((g) => g.classification === 'common_answerable');
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));
  if (
    !sameSet(
      selectedGroups.map((g) => g.groupId),
      mapping.selectedGroupIds,
    ) ||
    !sameSet(
      selectedGroups.flatMap((g) => g.questionIds),
      mapping.selectedQuestionIds,
    )
  )
    throw new Error('MAPPING_MEMBERSHIP_MISMATCH');
  const sourceFiles = ['research/baseline.ts', 'research/routes.ts', 'research/fixtures/questions.json'];
  const amendment = input.amendment;
  const validMetadataAmendment = Boolean(
    amendment?.schemaVersion === 2 &&
      amendment.mappingId === mapping.id &&
      amendment.membershipUnchanged === true &&
      Number.isFinite(Date.parse(amendment.reviewedAt)) &&
      amendment.rationale.trim().length >= 30 &&
      Array.isArray(amendment.changes) &&
      amendment.changes.length === 2 &&
      sameSet(
        amendment.changes.map((change) => change.file),
        ['research/baseline.ts', 'research/routes.ts'],
      ) &&
      amendment.changes.every(
        (change) =>
          digest(change.definitionSha256) &&
          digest(change.comparisonSha256) &&
          change.definitionSha256 === mapping.sourceSha256[change.file] &&
          change.comparisonSha256 === input.comparisonSourceHashes[change.file] &&
          change.rationale.trim().length >= 30,
      ),
  );
  const sourceChecks = sourceFiles.map((file) => {
    const definitionSha256 = mapping.sourceSha256[file] ?? null;
    const comparisonSha256 = input.comparisonSourceHashes[file] ?? null;
    const a = input.amendment;
    const exact =
      digest(definitionSha256) && digest(comparisonSha256) && definitionSha256 === comparisonSha256;
    const amended =
      !exact &&
      Boolean(
        a &&
          ((a.schemaVersion === 1 &&
            file === 'research/routes.ts' &&
            a.mappingId === mapping.id &&
            a.file === file &&
            a.definitionSha256 === definitionSha256 &&
            a.comparisonSha256 === comparisonSha256 &&
            digest(definitionSha256) &&
            digest(comparisonSha256) &&
            Number.isFinite(Date.parse(a.reviewedAt)) &&
            a.rationale.trim().length >= 30) ||
            (a.schemaVersion === 2 &&
              validMetadataAmendment &&
              a.changes.some((change) => change.file === file))),
      );
    return {
      file,
      definitionSha256,
      comparisonSha256,
      status: exact ? 'match' : amended ? 'reviewed_amendment' : 'mismatch',
      amendment: amended ? a : null,
    };
  });
  const questionMetadataSourceValid =
    digest(input.currentQuestionFileSha256) &&
    input.currentQuestionFileSha256 === mapping.sourceSha256['research/fixtures/questions.json'];
  const membershipSourcesValid =
    questionMetadataSourceValid && sourceChecks.every((s) => s.status !== 'mismatch');
  if (
    !Number.isInteger(primary.expectedRepeats) ||
    primary.expectedRepeats < 1 ||
    !unique(primary.questions.map((q) => q.id))
  )
    throw new Error('INVALID_PRIMARY_PLAN');
  const plannedIds = new Set(primary.questions.map((q) => q.id));
  if (episodes.some((e) => e.split !== primary.split || !plannedIds.has(e.questionId)))
    throw new Error('RAW_EPISODE_OUTSIDE_PRIMARY_PLAN');
  for (const q of primary.questions) {
    const canonical = byQuestion.get(q.id);
    if (
      !canonical ||
      q.groupId !== canonical.groupId ||
      q.split !== primary.split ||
      q.split !== canonical.split ||
      q.family !== canonical.family ||
      q.question !== canonical.question
    )
      throw new Error('PRIMARY_QUESTION_METADATA_MISMATCH');
  }
  const relevantRaw = episodes.filter((e) => e.split === primary.split && plannedIds.has(e.questionId));
  if (
    !unique(relevantRaw.map((e) => e.id)) ||
    !unique(relevantRaw.map((e) => `${e.route}:${e.questionId}:${e.repeat}`))
  )
    throw new Error('DUPLICATE_RAW_EPISODE');
  if (
    !unique(primary.scores.map((s) => s.id)) ||
    !unique(primary.scores.map((s) => `${s.route}:${s.questionId}:${s.repeat}`))
  )
    throw new Error('DUPLICATE_PRIMARY_SCORE');
  const rawById = new Map(relevantRaw.map((e) => [e.id, e]));
  if (primary.scores.length !== relevantRaw.length) throw new Error('PRIMARY_RAW_EPISODES_OUT_OF_SYNC');
  for (const score of primary.scores) {
    const raw = rawById.get(score.id),
      q = byQuestion.get(score.questionId);
    if (
      !raw ||
      !q ||
      !plannedIds.has(score.questionId) ||
      score.split !== primary.split ||
      !ROUTES.includes(score.route) ||
      !Number.isInteger(score.repeat) ||
      score.repeat < 0 ||
      score.repeat >= primary.expectedRepeats ||
      score.groupId !== q.groupId ||
      score.family !== q.family ||
      ['route', 'questionId', 'groupId', 'family', 'split', 'repeat', 'status', 'durationMs'].some(
        (k) => raw[k as keyof StudyEpisode] !== score[k as keyof typeof score],
      )
    )
      throw new Error('PRIMARY_RAW_METADATA_MISMATCH');
    if (
      !Number.isFinite(score.durationMs) ||
      score.durationMs < 0 ||
      typeof score.success !== 'boolean' ||
      (score.status === 'error' && score.success)
    )
      throw new Error('INVALID_PRIMARY_OUTCOME');
  }
  if (
    primary.routes.length !== 9 ||
    !sameSet(
      primary.routes.map((r) => r.route),
      [...ROUTES],
    )
  )
    throw new Error('INVALID_PRIMARY_ROUTES');
  const selectedQuestions = questions.filter(
    (q) => q.split === primary.split && mapping.selectedQuestionIds.includes(q.id),
  );
  const selectedIds = new Set(selectedQuestions.map((q) => q.id));
  const plannedSubgroup = selectedQuestions.filter((q) => plannedIds.has(q.id));
  const scores = primary.scores.filter((s) => selectedIds.has(s.questionId));
  const fullSplitCoverage = plannedSubgroup.length === selectedQuestions.length;
  const fullExpected = selectedQuestions.length * primary.expectedRepeats;
  const plannedExpected = plannedSubgroup.length * primary.expectedRepeats;
  const wholeRunComplete = ROUTES.every(
    (route) =>
      primary.scores.filter((s) => s.route === route).length ===
      primary.questions.length * primary.expectedRepeats,
  );
  const snapshot = primary.snapshotIntegrity;
  const snapshotVerified =
    snapshot?.status === 'verified' &&
    snapshot.scope === 'ledger_and_corpus' &&
    digest(snapshot.before) &&
    snapshot.before === snapshot.after;
  const primaryIntegrityEligible =
    primary.complete && primary.eligibleForConclusion && wholeRunComplete && snapshotVerified;
  const validityNotice = input.validityNotice ?? null;
  const validityNoticeBound =
    validityNotice === null
      ? null
      : validityNotice.schemaVersion === 1 &&
        validityNotice.runId === primary.runId &&
        digest(validityNotice.originalResultsSha256) &&
        validityNotice.originalResultsSha256 === input.primaryReportSha256;
  const validityNoticeAllowsSelection =
    validityNotice === null || (validityNoticeBound === true && validityNotice.eligibleForSelection === true);
  const wholeBenchmarkCoverage = sameSet(
    primary.questions.map((q) => q.id),
    questions.filter((q) => q.split === primary.split).map((q) => q.id),
  );
  const routes = ROUTES.map((route) => {
    const summary = summarizeRoute(route, scores, samples);
    const whole = primary.routes.find((r) => r.route === route)!;
    const rawViolations = relevantRaw
      .filter((e) => e.route === route)
      .flatMap((e) => [...(e.hardGateViolations ?? []), ...(e.validation?.hardGateViolations ?? [])]);
    const hardGateViolations = [
      ...new Set([
        ...summary.hardGateViolations,
        ...whole.hardGateViolations,
        ...primary.scores.filter((s) => s.route === route).flatMap((s) => s.hardGateViolations),
        ...rawViolations,
      ]),
    ];
    return {
      ...summary,
      macroSuccessRate: undefined,
      observedFamilies: summary.families.filter((f) => f.episodes > 0).map((f) => f.family),
      fullSplitPlannedEpisodes: fullExpected,
      plannedInRunEpisodes: plannedExpected,
      missingPlannedEpisodes: plannedExpected - summary.episodes,
      unscheduledFullSplitEpisodes: fullExpected - plannedExpected,
      missingFullSplitEpisodes: fullExpected - summary.episodes,
      complete: summary.episodes === fullExpected && fullSplitCoverage,
      errors: primary.scores.filter(
        (s) => s.route === route && selectedIds.has(s.questionId) && s.status === 'error',
      ).length,
      blocked: primary.scores.filter(
        (s) => s.route === route && selectedIds.has(s.questionId) && s.status === 'blocked',
      ).length,
      hardGateViolations,
      disqualified: whole.disqualified || hardGateViolations.length > 0,
      wholeBenchmark: {
        microSuccessRate: whole.microSuccessRate,
        macroSuccessRate: whole.macroSuccessRate,
        episodes: whole.episodes,
        plannedEpisodes: whole.plannedEpisodes,
        complete: whole.complete,
        disqualified: whole.disqualified,
      },
      failures: [...new Set(scores.filter((s) => s.route === route).flatMap((s) => s.failures))]
        .sort()
        .map((kind) => ({
          kind,
          episodes: scores.filter((s) => s.route === route && s.failures.includes(kind)).length,
        })),
    };
  });
  const eligibleForConclusion =
    primaryIntegrityEligible &&
    validityNoticeAllowsSelection &&
    wholeBenchmarkCoverage &&
    membershipSourcesValid &&
    routes.every((r) => r.complete);
  const comparisons = primary.comparisons.map(({ hypothesis, kind, route, control }) => ({
    hypothesis,
    kind,
    route,
    control,
    effect: pairedDifference(
      scores.filter((s) => s.route === route),
      scores.filter((s) => s.route === control),
      samples,
    ),
  }));
  return {
    schemaVersion: 1,
    runId: primary.runId,
    mappingId: mapping.id,
    split: primary.split,
    expectedRepeats: primary.expectedRepeats,
    selectedQuestionIds: selectedQuestions.map((q) => q.id),
    selectedGroupIds: [...new Set(selectedQuestions.map((q) => q.groupId))],
    plannedQuestionIdsInRun: plannedSubgroup.map((q) => q.id),
    membershipSourcesValid,
    sourceChecks,
    questionMetadataSourceValid,
    primaryComplete: primary.complete,
    primaryIntegrityEligible,
    validityNotice,
    validityNoticeBound,
    validityNoticeAllowsSelection,
    primarySnapshot: snapshot,
    wholeRunComplete,
    wholeBenchmarkCoverage,
    fullSplitCoverage,
    eligibleForConclusion,
    eligibleRoutes: eligibleForConclusion ? routes.filter((r) => !r.disqualified).map((r) => r.route) : [],
    routes,
    comparisons,
    notes: [
      'Supplementary common-answerable subgroup; the whole-benchmark six-family macro remains primary. No winner is selected by this analyzer.',
      'All recorded errors and blocks remain in subgroup denominators; missing and unscheduled episodes are separate. No candidate was selected using observed correctness.',
      'The fixed held-out subgroup has 12 questions in six scenario groups, covering financial and entry families only. Repetitions and paraphrases are not independent observations.',
      'Observed-family macro averages only families with measurements; it is not a six-family macro. Always read family counts and missing coverage.',
      'Paired intervals use scenario-group blocks within families and are exploratory, unadjusted for multiple comparisons, and unstable with so few groups. A zero-width empirical interval does not imply certainty.',
      'Primary completion, verified ledger-and-corpus fingerprint, full subgroup coverage, and matching membership-source hashes are required for comparative eligibility. Any hard-gate violation anywhere in a route remains disqualifying.',
      'Changed source files are diagnostic unless an explicit reviewed amendment binds exact definition/comparison hashes. Legacy route-only amendments cannot waive baseline changes; a version-2 metadata amendment must bind both baseline and route hashes and preserve membership. Question-source changes cannot be waived.',
      'This postprocessor reuses the preserved primary scores after checking raw outcome identity and metadata. It does not silently rescore using a later reference or rubric version.',
      'An adjacent post-run validity notice supersedes mechanical completion/integrity eligibility. A notice with an unverified run/report binding also forces diagnostic status; it never silently repairs or replaces original scores.',
    ],
  };
}
export type CommonAnalysis = ReturnType<typeof analyzeCommonCapabilities>;
export function renderCommonMarkdown(report: CommonAnalysis) {
  const lines = [
    `# Common-capability analysis: ${report.runId}`,
    '',
    report.eligibleForConclusion
      ? 'Measurements and source/integrity gates complete. Interpret eligible routes with the stated limitations; no winner is selected.'
      : '**Diagnostic only — ineligible for comparative conclusions.** Incomplete measurements, unverified primary integrity, or membership-source changes must be resolved.',
    '',
    `Split: ${report.split}. Fixed subgroup: ${report.selectedQuestionIds.length} questions / ${report.selectedGroupIds.length} groups. Questions scheduled in this run: ${report.plannedQuestionIdsInRun.length}.`,
    ...(report.validityNotice
      ? [
          '',
          `**Post-run validity notice:** ${report.validityNotice.classification ?? 'Present'}. Bound to this original report: ${report.validityNoticeBound ? 'yes' : 'NO — unverified'}. Allows selection: ${report.validityNoticeAllowsSelection ? 'yes, subject to all other gates' : 'NO'}.`,
          ...(report.validityNotice.issues ?? []).map((issue) => `- ${issue.code}: ${issue.detail}`),
          report.validityNotice.interpretation ?? '',
        ]
      : []),
    '',
    '| Route | Measured / full planned | Success / measured | Micro | Observed-family macro | Families | Errors | Missing planned / unscheduled | Hard gate |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |',
    ...report.routes.map(
      (r) =>
        `| ${r.route} | ${r.episodes}/${r.fullSplitPlannedEpisodes} | ${r.successes}/${r.episodes} | ${rate(r.microSuccessRate)} | ${rate(r.observedFamilyMacro)} | ${r.observedFamilies.join(', ') || 'None'} | ${r.errors} | ${r.missingPlannedEpisodes}/${r.unscheduledFullSplitEpisodes} | ${r.disqualified ? 'DISQUALIFIED' : 'None recorded'} |`,
    ),
    '',
    'Observed-family macro is not the primary six-family score. All hard gates from the whole run apply even when the offending question is outside this subgroup.',
    '',
    '## Paired exploratory effects',
    '',
    '| Contrast | Paired episodes / groups | Difference | Unadjusted 95% group interval | Unpaired |',
    '| --- | ---: | ---: | --- | ---: |',
    ...report.comparisons.map(
      (c) =>
        `| ${c.hypothesis}: ${c.route} − ${c.control} | ${c.effect?.pairedEpisodes ?? 0}/${c.effect?.groups ?? 0} | ${c.effect ? (100 * c.effect.estimate).toFixed(1) + ' pp' : 'N/A'} | ${c.effect?.low == null || c.effect?.high == null ? 'N/A' : `${(100 * c.effect.low).toFixed(1)} to ${(100 * c.effect.high).toFixed(1)} pp`} | ${c.effect ? c.effect.unpairedControl + c.effect.unpairedTreatment : 0} |`,
    ),
    '',
    '## Membership-source provenance',
    '',
    '| File | Status | Definition SHA-256 | Comparison-run SHA-256 |',
    '| --- | --- | --- | --- |',
    ...report.sourceChecks.map(
      (s) =>
        `| ${s.file} | ${s.status} | ${s.definitionSha256 ?? 'missing'} | ${s.comparisonSha256 ?? 'missing'} |`,
    ),
    '',
    ...report.sourceChecks.flatMap((s) =>
      s.amendment
        ? [
            `Reviewed amendment for ${s.file}: ${s.amendment.reviewedAt}; ${s.amendment.rationale.replaceAll('|', '\\|')}`,
          ]
        : [],
    ),
    '',
    '## Limits',
    '',
    ...report.notes.map((n) => `- ${n}`),
    '',
    'Full per-family counts, whole-benchmark context, failure categories and interval warnings are in common-capabilities.json. success.svg is a standalone descriptive figure.',
    '',
  ];
  return lines.join('\n');
}
export function renderCommonSvg(report: CommonAnalysis) {
  const body = report.routes
    .map((r, i) => {
      const y = 72 + i * 42;
      const width = 600 * (r.microSuccessRate ?? 0);
      const color = r.disqualified ? '#b91c1c' : report.eligibleForConclusion ? '#2563eb' : '#64748b';
      return `<text x="20" y="${y + 4}">${r.route}</text><rect x="85" y="${y - 10}" width="${width}" height="20" fill="${color}"/><text x="720" y="${y + 4}">${escape(rate(r.microSuccessRate))} (${r.episodes}/${r.fullSplitPlannedEpisodes})${r.disqualified ? ' !' : ''}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 490" role="img"><title>Common-capability micro success</title><desc>Descriptive subgroup success, errors included. Labels show recorded/full planned episodes. Red indicates a route hard gate. Missing data is N/A. No winner is selected.</desc><rect width="960" height="490" fill="white"/><g font-family="sans-serif" font-size="14" fill="#172033"><text x="20" y="25">${escape(report.runId)} — ${report.eligibleForConclusion ? 'complete measurement' : 'DIAGNOSTIC / INELIGIBLE'}</text>${body}<text x="20" y="475">${report.selectedQuestionIds.length} questions / ${report.selectedGroupIds.length} scenario groups; paired uncertainty in report.md.</text></g></svg>`;
}

export function runCommonAnalysis(directory: string, amendmentPath?: string) {
  const read = (path: string) => readFileSync(path, 'utf8');
  const mappingPath = 'docs/research/common-capabilities-v1.json';
  const primaryText = read(join(directory, 'results.json'));
  const rawText = read(join(directory, 'episodes.jsonl'));
  const sourceText = read(join(directory, 'source-manifest.json'));
  const mappingText = read(mappingPath);
  const questionText = read('research/fixtures/questions.json');
  const validityPath = join(directory, 'validity-notice.json');
  const validityText = existsSync(validityPath) ? read(validityPath) : null;
  const source = JSON.parse(sourceText) as { files: Record<string, string> };
  const result = analyzeCommonCapabilities({
    mapping: JSON.parse(mappingText),
    primary: JSON.parse(primaryText),
    episodes: rawText
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line)),
    questions: JSON.parse(questionText),
    comparisonSourceHashes: source.files,
    currentQuestionFileSha256: sha(questionText),
    amendment: amendmentPath ? JSON.parse(read(amendmentPath)) : undefined,
    validityNotice: validityText ? JSON.parse(validityText) : undefined,
    primaryReportSha256: sha(primaryText),
  });
  const output = join(directory, 'common-capabilities');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'common-capabilities.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(output, 'report.md'), renderCommonMarkdown(result));
  writeFileSync(join(output, 'success.svg'), renderCommonSvg(result));
  writeFileSync(
    join(output, 'analysis-provenance.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        runId: result.runId,
        analyzerSha256: sha(read(fileURLToPath(import.meta.url))),
        mappingSha256: sha(mappingText),
        primaryReportSha256: sha(primaryText),
        rawEpisodesSha256: sha(rawText),
        sourceManifestSha256: sha(sourceText),
        amendmentSha256: amendmentPath ? sha(read(amendmentPath)) : null,
        validityNoticeSha256: validityText ? sha(validityText) : null,
      },
      null,
      2,
    ) + '\n',
  );
  return {
    output,
    eligibleForConclusion: result.eligibleForConclusion,
    selectedQuestions: result.selectedQuestionIds.length,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error(
      'Usage: node --import tsx scripts/analyze-common-capabilities.ts <run-directory> [reviewed-amendment.json]',
    );
  console.log(JSON.stringify(runCommonAnalysis(process.argv[2], process.argv[3])));
}
