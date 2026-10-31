import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../server/config';
import { pool } from '../server/db';
import { financialChat, proposeEntry, runInsightTool } from '../server/ai';
import { getAiUsage, resetAiUsage, setAiBudget, type ModelMetadata } from '../server/ai-provider';
import { today } from '../server/reports';
import { AppError } from '../server/errors';
import { evaluationCases, FIXTURE_VERSION, SELECTED_DATE, type EvaluationCase } from './evaluation/cases';
import {
  assertEvaluationContextScope,
  createEvaluationFixture,
  journalFingerprint,
  withUnchangedEvaluationJournal,
  type EvaluationWorkspace,
} from './evaluation/fixtures';
import { parseEvaluationOptions } from './evaluation/options';
import {
  percentile,
  scoreClarification,
  scoreEntry,
  scoreInsight,
  shouldStop,
  type Score,
} from './evaluation/scoring';

// Opt-in live evaluation: synthetic fixtures are posted in NEW workspaces only.
// Model responses are never posted. No external API is called by unit tests.
type Result = {
  id: string;
  name: string;
  split: string;
  group: string;
  repetition: number;
  status: 'passed' | 'failed' | 'error';
  durationMs: number;
  failures: string[];
  actual?: unknown;
  beforeCorrection?: unknown;
  beforeCorrectionTargetMatch?: Score;
  beforeCorrectionError?: string;
  expectedCorrectionId?: string;
  expectedCorrectionRetrieved?: boolean;
  learningWorkspaces?: { before: string; after: string; teachingEntryId: string };
  semanticReviewRequired: boolean;
  semanticReview?: { status: 'pending'; rubric: string };
  errorCode?: string;
  metadata: ModelMetadata[];
};
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const help = `Daybook live AI evaluation (provider calls may be billed)

npm run ai:evaluate -- --suite smoke
npm run ai:evaluate -- --suite development --max-attempts 32 --max-total-tokens 150000
npm run ai:evaluate -- --suite holdout --repeats 3 --max-attempts 96 --max-total-tokens 400000

Options: --suite smoke|development|holdout|all, --repeats 1..10,
         --max-attempts 1..200, --max-total-tokens 1..2000000,
         --candidate short-name, --help

Default: four smoke cases, one repetition, at most eight provider attempts.
No automatic retries. Auth/quota/model-access failures stop the suite.
The token guard stops subsequent calls after reported usage reaches the cap;
one bounded request can cross it. Unreported usage and estimated cost remain
explicitly unknown. This is not an absolute billing ceiling.

Requires a running migrated database and configured AI provider. Creates two
base workspaces plus a separate before/after pair per correction case/repeat.
All reference-authored teaching posts precede the protected journal baseline.
These synthetic workspaces remain available for evidence inspection.
No existing workspace is reset and no model response becomes a journal entry.
Holdout labels must remain frozen while tuning on development results.
`;

function compactResponse(
  value: Awaited<ReturnType<typeof proposeEntry>> | Awaited<ReturnType<typeof financialChat>>,
) {
  if ('entry' in value)
    return {
      action: value.action,
      entry: value.entry,
      questions: value.questions,
      explanation: value.explanation,
      context: value.context,
    };
  return { query: value.query, answer: value.answer, evidence: value.evidence };
}

async function evaluate() {
  const options = parseEvaluationOptions(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return;
  }
  if (!config.aiKey) {
    console.error(
      'No key is configured for the selected AI provider. No fixture or provider call was created.',
    );
    process.exitCode = 2;
    return;
  }
  const smoke = new Set(['dev-rent', 'dev-fx', 'dev-missing-fx', 'dev-cash']);
  const selected = evaluationCases.filter(
    (c) =>
      options.suite === 'all' || (options.suite === 'smoke' ? smoke.has(c.id) : c.split === options.suite),
  );
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const codeVersions = Object.fromEntries(
    await Promise.all(
      [
        'server/ai.ts',
        'server/ai-provider.ts',
        'server/categorization-memory.ts',
        'server/ledger.ts',
        'server/ledger-validation.ts',
        'scripts/evaluate-ai.ts',
        'scripts/evaluation/cases.ts',
        'scripts/evaluation/fixtures.ts',
        'scripts/evaluation/scoring.ts',
      ].map(async (file) => [file, sha256(await readFile(file, 'utf8'))]),
    ),
  );
  const fixture = await createEvaluationFixture(runId, {
    correctionCases: selected.filter((item) => item.correction),
    repeats: options.repeats,
  });
  const initialFingerprint = await journalFingerprint(fixture.protectedOrganizations);
  const results: Result[] = [];
  let stoppedReason: string | null = null;
  resetAiUsage();
  setAiBudget({ maxAttempts: options.maxAttempts, maxTotalTokens: options.maxTotalTokens });
  console.log(
    `Evaluating ${selected.length} cases × ${options.repeats} on ${config.aiProvider}/${config.aiModel}. Candidate: ${options.candidate}.`,
  );
  async function invoke(item: EvaluationCase, target: EvaluationWorkspace) {
    return withUnchangedEvaluationJournal(fixture.protectedOrganizations, async () => {
      const messages = [{ role: 'user' as const, content: item.text }];
      const response = await (item.mode === 'entry'
        ? proposeEntry(target.org, messages, SELECTED_DATE)
        : financialChat(target.org, messages));
      if ('entry' in response) await assertEvaluationContextScope(target.org, response.context);
      return response;
    });
  }
  async function score(
    item: EvaluationCase,
    response: Awaited<ReturnType<typeof invoke>>,
    target: EvaluationWorkspace,
  ) {
    if ('tool' in item.expected) {
      // Expected arguments test model routing; the deterministic report functions
      // supply the financial oracle and are checked by separate database tests.
      const expected = await runInsightTool(target.org, item.expected.tool, item.expected.args);
      return scoreInsight(response, item.expected, expected);
    }
    return item.expected.action === 'READY'
      ? scoreEntry(response, item.expected, target.codesById)
      : scoreClarification(response, item.mode);
  }
  outer: for (let repetition = 1; repetition <= options.repeats; repetition++) {
    for (const item of selected) {
      const started = performance.now();
      const row: Result = {
        id: item.id,
        name: item.name,
        split: item.split,
        group: item.group,
        repetition,
        status: 'error',
        durationMs: 0,
        failures: [],
        metadata: [],
        semanticReviewRequired: 'action' in item.expected && item.expected.action === 'CLARIFY',
        ...(item.reviewRubric
          ? { semanticReview: { status: 'pending' as const, rubric: item.reviewRubric } }
          : {}),
      };
      try {
        let target: EvaluationWorkspace = fixture;
        if (item.correction) {
          const pair = fixture.learningPairs.find((p) => p.caseId === item.id && p.repetition === repetition);
          if (!pair) throw new Error('Evaluation teaching workspace is missing.');
          target = pair.after;
          row.learningWorkspaces = {
            before: pair.before.org,
            after: pair.after.org,
            teachingEntryId: pair.teaching.entryId,
          };
          row.expectedCorrectionId = pair.teaching.memoryId;
          try {
            const before = await invoke(item, pair.before);
            row.beforeCorrection = compactResponse(before);
            row.beforeCorrectionTargetMatch = await score(item, before, pair.before);
            row.metadata.push(before.ai);
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              shouldStop(error.code, error.status) ||
              [
                'AI_PROVIDER_ERROR',
                'AI_TIMEOUT',
                'AI_SERVICE_UNAVAILABLE',
                'AI_CONNECTION_ERROR',
                'EVALUATION_JOURNAL_CHANGED',
              ].includes(error.code)
            )
              throw error;
            row.beforeCorrectionError = error.code;
          }
        }
        const actual = await invoke(item, target);
        row.metadata.push(actual.ai);
        row.actual = compactResponse(actual);
        const result = await score(item, actual, target);
        if (row.expectedCorrectionId && 'entry' in actual) {
          row.expectedCorrectionRetrieved = actual.context.correctionIds.includes(row.expectedCorrectionId);
          if (!row.expectedCorrectionRetrieved) {
            result.passed = false;
            result.failures.push('The confirmed correction was not retrieved for this proposal.');
          }
        }
        row.status = result.passed ? 'passed' : 'failed';
        row.failures = result.failures;
      } catch (error) {
        // Arbitrary database/transport errors may contain connection details.
        // Store only explicit application codes, never raw exception messages.
        row.errorCode = error instanceof AppError ? error.code : 'EVALUATION_INTERNAL_ERROR';
        row.failures = [row.errorCode];
        if (
          !(error instanceof AppError) ||
          shouldStop(error.code, error.status) ||
          [
            'AI_PROVIDER_ERROR',
            'AI_TIMEOUT',
            'AI_SERVICE_UNAVAILABLE',
            'AI_CONNECTION_ERROR',
            'EVALUATION_JOURNAL_CHANGED',
          ].includes(error.code)
        )
          stoppedReason = row.errorCode;
      }
      row.durationMs = Math.round(performance.now() - started);
      results.push(row);
      console.log(
        `${row.status.toUpperCase()} ${row.id} [${repetition}] (${row.durationMs} ms)${row.errorCode ? ` ${row.errorCode}` : ''}`,
      );
      if (stoppedReason) break outer;
      if (getAiUsage().unreportedUsage) {
        stoppedReason = 'PROVIDER_USAGE_UNREPORTED';
        break outer;
      }
    }
  }
  setAiBudget(null);
  const finalFingerprint = await journalFingerprint(fixture.protectedOrganizations);
  const unchanged = initialFingerprint === finalFingerprint;
  const usage = getAiUsage();
  const providerDurations = results.flatMap((r) => r.metadata.map((m) => m.durationMs));
  const planned = selected.length * options.repeats;
  const report = {
    runId,
    ranAt: new Date().toISOString(),
    provider: config.aiProvider,
    model: config.aiModel,
    modelVersions: [
      ...new Set(results.flatMap((r) => r.metadata.map((m) => m.modelVersion).filter(Boolean))),
    ],
    candidate: options.candidate,
    suite: options.suite,
    passMeaning: 'Automated checks only. Clarification question semantics still require human review.',
    fixture: {
      version: FIXTURE_VERSION,
      organizationId: fixture.org,
      decoyOrganizationId: fixture.otherOrg,
      protectedOrganizationIds: fixture.protectedOrganizations,
      initialJournalFingerprint: initialFingerprint,
      finalJournalFingerprint: finalFingerprint,
      teachingSetup: {
        path: 'recordProposal -> createEntry reviewed draft -> postEntry',
        origin: 'Reference-authored wrong proposals and reviewed corrections; no model output posted',
        completedBeforeProtectedBaseline: true,
        foreignTeaching: fixture.foreignTeaching,
        learningPairs: fixture.learningPairs.map(({ caseId, repetition, before, after, teaching }) => ({
          caseId,
          repetition,
          beforeOrganizationId: before.org,
          afterOrganizationId: after.org,
          ...teaching,
        })),
      },
      selectedDate: SELECTED_DATE,
      businessDateAtRun: today(),
      timezone: 'America/New_York',
      datasetSha256: sha256(JSON.stringify(evaluationCases)),
      selectedCaseIds: selected.map((r) => r.id),
      codeVersions,
    },
    limits: {
      repeats: options.repeats,
      maxAttempts: options.maxAttempts,
      maxTotalTokens: options.maxTotalTokens,
      automaticRetries: 0,
      tokenLimitMeaning:
        'Between-request guard based on reported usage; one bounded request may exceed it. Not an absolute billing ceiling.',
    },
    summary: {
      planned,
      completed: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      errors: results.filter((r) => r.status === 'error').length,
      skipped: planned - results.length,
      stoppedReason,
      journalUnchanged: unchanged,
      clarificationSemanticsPendingReview: results.filter((r) => r.semanticReviewRequired).length,
      providerLatencyMs: {
        p50: percentile(providerDurations, 0.5),
        p95: percentile(providerDurations, 0.95),
      },
      usage,
      estimatedCost: null,
      costNote:
        'No dollar estimate: token usage is reported, but billing tier and price schedule were not assumed.',
    },
    passed:
      !stoppedReason &&
      unchanged &&
      results.length === planned &&
      results.every((r) => r.status === 'passed'),
    limitations: [
      'Small engineering evaluation, not a production accuracy estimate.',
      'Clarification automation checks only routing, a nonempty question, and absence of a ready entry or financial evidence. Question meaning requires human review using the recorded rubric; an automated pass is not a semantic accuracy claim.',
      'Before-correction target matching is diagnostic only: clarification can be correct before the new fact exists, so a better post-correction match alone is not proof of model learning.',
      'Correction cases use fresh before/after workspace pairs per repetition. After-context contains both a reference-authored posted teaching entry and its ACTIVE memory; this does not isolate memory retrieval from posted-history retrieval or establish model weight learning.',
      'V2 preserves all 40 prompts, labels and splits but changes correction fixture construction. Compare historical V1 results with that disclosed context change; do not pool them as one unchanged experiment.',
      'Financial answers are checked against deterministic SQL-backed functions; financial engine correctness has separate database tests.',
      'The holdout split is reserved from development tuning. Once its failures inform changes, report that reuse and do not call it unseen.',
      'Unit/contract tests do not establish live provider accuracy. Source account IDs differ across isolated runs; source hashes and case labels remain recorded.',
    ],
    results,
  };
  await mkdir('docs/evidence/ai-evaluations', { recursive: true });
  const data = JSON.stringify(report, null, 2) + '\n';
  await writeFile(`docs/evidence/ai-evaluations/${runId}.json`, data, { flag: 'wx' });
  await writeFile('docs/evidence/ai-evaluation-v2.json', data);
  console.log(
    `Automated checks: ${report.summary.passed}/${planned} passed; ${report.summary.skipped} skipped; ${usage.attempts} provider attempts. Clarifications awaiting semantic review: ${report.summary.clarificationSemanticsPendingReview}. Journal unchanged: ${unchanged}.`,
  );
  console.log(`Evidence: docs/evidence/ai-evaluations/${runId}.json`);
  if (!report.passed) process.exitCode = 1;
}

evaluate()
  .catch((error) => {
    console.error(
      error instanceof AppError
        ? `Evaluation stopped: ${error.code}.`
        : 'Evaluation setup failed. Check options (--help), database access, and migrations. No raw connection error is logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => {
    setAiBudget(null);
    return pool.end();
  });
