import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Decimal } from '../../shared/money';
import { jsonFile, safeErrorCode, sealArtifacts, writeEvidence } from './artifacts';
import { outputDirectory, predecessorDirectory, verifyDevelopmentArtifact } from './authorize';
import { fixtureMessages, loadCases, seedFixtures, verifyCaseReferences } from './fixtures';
import {
  attemptsForRoute,
  evaluationSource,
  pairedSchedule,
  PROTOCOL,
  sha256,
  validateCoreFreeze,
  validatePermit,
  validateRunEnvironment,
} from './protocol';
import { scoreCompletenessResponse } from './scoring';
import { createEvaluationTransport } from './transport';
import { finalizeRunIntegrity } from './run-integrity';
import type { CompletenessOutcome, CompletenessRoute, CompletenessScore } from './types';
import { analyzeCompleteness, renderCompletenessMarkdown, renderCompletenessSvg } from './analysis';

function attemptsFor(output: string, trial: string) {
  const ledger = jsonFile(join(output, 'transport/ledger.json')) as {
    records: {
      id: string;
      trial: string;
      state: string;
      costUsd: string | null;
      reservedUsd: string;
      usage: unknown;
      httpStatus: number | null;
    }[];
  };
  return ledger.records
    .filter((entry) => entry.trial === trial)
    .map((entry) => {
      const directory = join(output, 'transport/attempts', entry.id);
      return {
        ...entry,
        request: jsonFile(join(directory, 'request.json')),
        response: existsSync(join(directory, 'response.json'))
          ? jsonFile(join(directory, 'response.json'))
          : null,
      };
    });
}
export async function runEvaluation(output = outputDirectory) {
  const binding = validateRunEnvironment(),
    source = evaluationSource(),
    freeze = validateCoreFreeze();
  if (source.hash !== process.env.COMPLETENESS_SOURCE_HASH) throw Error('COMPLETENESS_SOURCE_DRIFT');
  const approvalSha256 = process.env.COMPLETENESS_APPROVAL_SHA256!;
  const permit = validatePermit(process.env.COMPLETENESS_PRIVATE_APPROVAL, {
    approvalSha256,
    sourceCommit: binding.sourceCommit,
    sourceHash: source.hash,
    freezeSha256: freeze.freezeSha256,
  });
  const authorization = jsonFile(join(output, 'authorization.json')) as Record<string, unknown>;
  if (
    authorization.runId !== binding.runId ||
    authorization.sourceHash !== source.hash ||
    authorization.sourceCommit !== binding.sourceCommit ||
    authorization.phase !== binding.phase ||
    authorization.cohort !== PROTOCOL.cohort ||
    authorization.approvalSha256 !== approvalSha256 ||
    authorization.freezeSha256 !== freeze.freezeSha256
  )
    throw Error('COMPLETENESS_AUTHORIZATION_MISMATCH');
  if (process.env.AI_PROVIDER !== 'gemini' || process.env.AI_MODEL !== PROTOCOL.model)
    throw Error('COMPLETENESS_PROVIDER_MISMATCH');
  const predecessor =
    binding.phase === 'holdout'
      ? verifyDevelopmentArtifact(predecessorDirectory, {
          runId: process.env.COMPLETENESS_DEVELOPMENT_RUN!,
          sourceCommit: binding.sourceCommit,
          sourceHash: source.hash,
          approvalSha256,
          freezeSha256: freeze.freezeSha256,
          keySha256: permit.keySha256,
        })
      : null;
  if (JSON.stringify(authorization.predecessor) !== JSON.stringify(predecessor))
    throw Error('COMPLETENESS_PREDECESSOR_AUTHORIZATION_MISMATCH');
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || sha256(apiKey) !== permit.keySha256) throw Error('COMPLETENESS_KEY_MISMATCH');
  const cases = loadCases(binding.phase),
    schedule = pairedSchedule(cases, binding.phase);
  for (const item of cases) verifyCaseReferences(item);
  const phase = PROTOCOL.phases[binding.phase];
  const priorCost = predecessor?.chargedUsd ?? '0',
    priorAttempts = predecessor?.attempts ?? 0;
  if (new Decimal(priorCost).plus(phase.ceilingUsd).gt(PROTOCOL.totalCeilingUsd))
    throw Error('COMPLETENESS_CUMULATIVE_ALLOWANCE_EXCEEDED');
  writeEvidence(join(output, 'run.json'), {
    version: PROTOCOL.version,
    ...binding,
    cohort: PROTOCOL.cohort,
    source,
    freeze,
    approvalSha256,
    protocol: PROTOCOL,
    predecessor,
    scoringVersion: 'completeness-scoring-v1',
    startedAt: new Date().toISOString(),
    schedule: schedule.map(({ item, route }) => ({ caseId: item.id, route })),
    data: 'fresh isolated synthetic workspaces only',
    provider: 'gemini',
    model: PROTOCOL.model,
    capturesHttpAdmissionOrBrowser: false,
  });
  const transport = createEvaluationTransport({
    directory: join(output, 'transport'),
    model: PROTOCOL.model,
    apiKey,
    expectedKeySha256: permit.keySha256,
    ceilingUsd: phase.ceilingUsd,
    maxAttempts: phase.maxAttempts,
    inputUsdPerMillion: PROTOCOL.prices.inputUsdPerMillion,
    outputUsdPerMillion: PROTOCOL.prices.outputUsdPerMillion,
    maxRequestBytes: PROTOCOL.maximumRequestBytes,
  });
  let fixture: Awaited<ReturnType<typeof seedFixtures>> | undefined;
  let restore: (() => void) | undefined, endPool: (() => Promise<void>) | undefined;
  let failure: string | null = null,
    finalSourceHash: string | null = null;
  let finalFingerprint: unknown = null,
    attemptedExecutions = 0;
  const trials: {
    caseId: string;
    route: CompletenessRoute;
    durationMs: number;
    attempts: number;
    knownUsd: string;
    unknownReservedUsd: string;
    score: CompletenessScore;
  }[] = [];
  try {
    fixture = await seedFixtures({
      ownerUrl: process.env.MIGRATION_DATABASE_URL ?? '',
      runtimeUrl: process.env.DATABASE_URL ?? '',
      confirmation: 'CREATE_ISOLATED_COMPLETENESS_FIXTURE',
    });
    writeEvidence(join(output, 'fixture.json'), {
      orgId: fixture.orgId,
      foreignOrgId: fixture.foreignOrgId,
      chart: fixture.chart,
      counterparties: fixture.counterparties,
      entryAliases: fixture.entryAliases,
      referenceChecks: fixture.referenceChecks,
      workedChecks: fixture.workedChecks,
      storedLineChecks: fixture.storedLineChecks,
      counts: fixture.counts,
      fingerprint: fixture.initialFingerprint,
    });
    restore = transport.install();
    // Install the accounted fetch before any evaluated provider call. Pure scorer
    // parsing imports runtime definitions but performs no request on import.
    const { config } = await import('../../server/config');
    if (
      config.aiProvider !== 'gemini' ||
      config.aiModel !== PROTOCOL.model ||
      config.aiKey !== apiKey ||
      config.databaseUrl !== process.env.DATABASE_URL
    )
      throw Error('COMPLETENESS_IMPORTED_CONFIG_MISMATCH');
    const { financialChat } = await import('../../server/ai');
    const { pool } = await import('../../server/db');
    endPool = () => pool.end();
    for (const { item, route } of schedule) {
      if (evaluationSource().hash !== source.hash) throw Error('COMPLETENESS_SOURCE_DRIFT');
      const before = await fixture.fingerprint();
      if (before.sha256 !== fixture.initialFingerprint.sha256) throw Error('COMPLETENESS_BOOKS_CHANGED');
      const directory = join(output, 'trials', `${item.id}-${route}`);
      writeEvidence(join(directory, 'before.json'), before);
      transport.beginTrial({ caseId: item.id, route, maxAttempts: attemptsForRoute(route) });
      const started = performance.now(),
        outcome: CompletenessOutcome = {};
      attemptedExecutions++;
      try {
        outcome.response = await financialChat(fixture.orgId, fixtureMessages(item), { route });
      } catch (error) {
        outcome.error = { code: safeErrorCode(error) };
      } finally {
        transport.endTrial();
      }
      const durationMs = Math.round(performance.now() - started),
        attempts = attemptsFor(output, `${route}/${item.id}`);
      outcome.attempts = attempts;
      if (JSON.stringify(outcome).includes(apiKey)) throw Error('COMPLETENESS_CREDENTIAL_IN_OUTCOME');
      writeEvidence(join(directory, 'outcome.json'), { caseId: item.id, route, durationMs, outcome });
      const after = await fixture.fingerprint();
      writeEvidence(join(directory, 'after.json'), after);
      if (after.sha256 !== before.sha256) throw Error('COMPLETENESS_BOOKS_CHANGED');
      if (evaluationSource().hash !== source.hash) throw Error('COMPLETENESS_SOURCE_DRIFT');
      const score = scoreCompletenessResponse(item, outcome, {
        organizationId: fixture.orgId,
        chart: fixture.chart,
        counterparties: fixture.counterparties,
        referenceLedgerClaim: fixture.referenceLedgerClaim,
      });
      writeEvidence(join(directory, 'score.json'), score);
      const knownUsd = attempts
        .reduce((sum, item) => sum.plus(item.costUsd ?? '0'), new Decimal(0))
        .toString();
      const unknownReservedUsd = attempts
        .filter((item) => item.state !== 'known')
        .reduce((sum, item) => sum.plus(item.reservedUsd), new Decimal(0))
        .toString();
      trials.push({
        caseId: item.id,
        route,
        durationMs,
        attempts: attempts.length,
        knownUsd,
        unknownReservedUsd,
        score,
      });
      writeEvidence(
        join(output, 'progress.json'),
        { completed: trials.length, planned: phase.executions, trials, budget: transport.summary() },
        false,
      );
      console.log(
        JSON.stringify({
          caseId: item.id,
          route,
          classification: score.classification,
          focusCorrect: score.focusCorrect,
          durationMs,
          attempts: attempts.length,
        }),
      );
      if (transport.summary().haltReason) throw Error('COMPLETENESS_TRANSPORT_HALTED');
      if (
        outcome.error &&
        ['DATABASE_ERROR', 'DATABASE_UNAVAILABLE', 'COMPLETENESS_EXECUTION_FAILED'].includes(
          outcome.error.code,
        )
      )
        throw Error('COMPLETENESS_INFRASTRUCTURE_FAILED');
    }
  } catch (error) {
    failure = safeErrorCode(error);
  } finally {
    try {
      restore?.();
    } catch {
      failure ??= 'COMPLETENESS_RESTORE_FAILED';
    }
    try {
      if (fixture) {
        finalFingerprint = await fixture.fingerprint();
        if (JSON.stringify(finalFingerprint) !== JSON.stringify(fixture.initialFingerprint))
          failure ??= 'COMPLETENESS_BOOKS_CHANGED';
      }
    } catch {
      failure ??= 'COMPLETENESS_FINAL_FINGERPRINT_FAILED';
    }
    try {
      await endPool?.();
    } catch {
      failure ??= 'COMPLETENESS_POOL_CLOSE_FAILED';
    }
    try {
      await fixture?.close();
    } catch {
      failure ??= 'COMPLETENESS_FIXTURE_CLOSE_FAILED';
    }
  }
  let budget;
  try {
    budget = transport.close();
  } catch {
    failure ??= 'COMPLETENESS_LEDGER_CLOSE_FAILED';
    budget = transport.summary();
  }
  try {
    finalSourceHash = evaluationSource().hash;
    if (finalSourceHash !== source.hash) failure ??= 'COMPLETENESS_SOURCE_DRIFT';
  } catch {
    failure ??= 'COMPLETENESS_FINAL_SOURCE_FAILED';
  }
  const integrity = finalizeRunIntegrity({
    phase: binding.phase,
    failure,
    plannedExecutions: phase.executions,
    completedExecutions: trials.length,
    sourceHash: source.hash,
    finalSourceHash,
    initialFingerprint: fixture?.initialFingerprint,
    finalFingerprint,
    budget,
  });
  failure = integrity.failure;
  let complete = integrity.complete;
  let aggregate: ReturnType<typeof analyzeCompleteness> | null = null;
  // A full table of scores is not sufficient if final books/source/cost checks failed.
  // Retain every observation, but do not emit an adoption report for that run.
  if (complete && binding.phase === 'holdout') {
    try {
      aggregate = analyzeCompleteness({
        cases: cases.map(({ id, family }) => ({ id, family })),
        observations: trials,
      });
    } catch (error) {
      failure = safeErrorCode(error);
      complete = false;
    }
  }
  writeEvidence(join(output, 'summary.json'), {
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    ...binding,
    sourceHash: source.hash,
    freezeSha256: freeze.freezeSha256,
    approvalSha256,
    complete,
    failure,
    plannedExecutions: phase.executions,
    attemptedExecutions,
    completedExecutions: trials.length,
    finalSourceHash,
    trials,
    aggregate,
    budget,
    predecessor,
    scoringVersion: 'completeness-scoring-v1',
    cumulativeAccounting: {
      priorChargedUsd: priorCost,
      currentChargedUsd: budget.chargedUsd,
      totalChargedUsd: new Decimal(priorCost).plus(budget.chargedUsd).toString(),
      priorAttempts,
      currentAttempts: budget.attempts,
      totalAttempts: priorAttempts + budget.attempts,
      totalCeilingUsd: PROTOCOL.totalCeilingUsd,
      unusedDevelopmentTransferred: false,
    },
    initialFingerprint: fixture?.initialFingerprint ?? null,
    finalFingerprint,
    finishedAt: new Date().toISOString(),
    limitations: [
      'Synthetic internally authored questions; no production accuracy guarantee.',
      'Direct service evaluation, not HTTP admission, browser, load or hosting validation.',
      'Model-declared completion is not ground truth; wording is not independently human-rated.',
      'Whole-route comparison; declaration, checking and automatic arithmetic are combined.',
      'Current standard-rate estimates plus unknown reservations, not an invoice or account balance.',
    ],
  });
  if (aggregate) {
    writeFileSync(join(output, 'report.md'), renderCompletenessMarkdown(aggregate), {
      flag: 'wx',
      mode: 0o600,
    });
    writeFileSync(join(output, 'comparison.svg'), renderCompletenessSvg(aggregate), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  // Never seal an artifact containing the credential, including a provider's unexpected echo.
  const leak = (path: string) => readFileSync(path, 'utf8').includes(apiKey);
  if (leak(join(output, 'summary.json'))) throw Error('COMPLETENESS_CREDENTIAL_IN_OUTCOME');
  sealArtifacts(output);
  console.log(
    JSON.stringify({ phase: binding.phase, complete, completedExecutions: trials.length, failure, budget }),
  );
  if (!complete) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === 'inspect') console.log(JSON.stringify({ protocol: PROTOCOL, source: evaluationSource() }));
  else if (command === 'run')
    runEvaluation().catch((error: unknown) => {
      console.error(JSON.stringify({ error: safeErrorCode(error) }));
      process.exitCode = 1;
    });
  else {
    console.error('Use inspect or run. Execution requires the separately approved exact-source CI permit.');
    process.exitCode = 2;
  }
}
