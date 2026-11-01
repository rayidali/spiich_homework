import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evaluationSource,
  pairedSchedule,
  PROTOCOL,
  validateRunEnvironment,
  validatePredecessorEvidence,
  type EvaluationRoute,
} from './protocol';
import { fixtureMessages, loadCases, seedFixtures } from './fixtures';
import {
  aggregatePairedScores,
  scoreAdaptiveResponse,
  type AdaptiveOutcome,
  type AdaptiveScore,
} from './scoring';
import { createEvaluationTransport } from './transport';
import { scoreAdaptiveResponseV2 } from './scoring-v2';
import { Decimal } from '../../shared/money';

const defaultOutput = '.tools/adaptive-evaluation-output';
function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeEvidence(path: string, value: unknown, exclusive = true) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!exclusive) renameSync(temporary, path);
}
function errorCode(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z_]{1,95}$/.test(error.code)
  )
    return error.code;
  if (error instanceof Error && /^(EVALUATION|ADAPTIVE_EVALUATION|FIXTURE)_[A-Z_]+$/.test(error.message))
    return error.message;
  return 'EVALUATION_EXECUTION_FAILED';
}
function attemptsFor(output: string, trial: string) {
  const ledger = json(join(output, 'transport/ledger.json')) as {
    records: { id: string; trial: string; state: string; usage: unknown; httpStatus: number | null }[];
  };
  return ledger.records
    .filter((entry) => entry.trial === trial)
    .map((entry) => {
      const directory = join(output, 'transport/attempts', entry.id);
      return {
        ...entry,
        request: json(join(directory, 'request.json')),
        response: existsSync(join(directory, 'response.json'))
          ? json(join(directory, 'response.json'))
          : null,
      };
    });
}

export async function runEvaluation(output = defaultOutput) {
  const binding = validateRunEnvironment();
  const source = evaluationSource();
  if (source.hash !== process.env.EVALUATION_SOURCE_HASH) throw Error('EVALUATION_SOURCE_DRIFT');
  const authorization = json(join(output, 'authorization.json')) as Record<string, unknown>;
  if (
    authorization.runId !== binding.runId ||
    authorization.sourceHash !== source.hash ||
    authorization.sourceCommit !== binding.sourceCommit ||
    authorization.phase !== binding.phase ||
    authorization.cohort !== PROTOCOL.cohort
  )
    throw Error('EVALUATION_AUTHORIZATION_MISMATCH');
  if (process.env.AI_PROVIDER !== 'gemini' || process.env.AI_MODEL !== PROTOCOL.model)
    throw Error('EVALUATION_PROVIDER_MISMATCH');
  const predecessor = validatePredecessorEvidence();
  if (JSON.stringify(authorization.predecessor) !== JSON.stringify(predecessor))
    throw Error('EVALUATION_PREDECESSOR_AUTHORIZATION_MISMATCH');
  const { expectedKeySha256, ...safePredecessor } = predecessor;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const keyHash = process.env.EVALUATION_KEY_SHA256;
  if (!apiKey || !keyHash) throw Error('EVALUATION_KEY_MISSING');
  if (keyHash !== expectedKeySha256) throw Error('EVALUATION_PREDECESSOR_KEY_MISMATCH');
  const cases = loadCases(binding.phase);
  const schedule = pairedSchedule(cases, binding.phase);
  const phase = PROTOCOL.phases[binding.phase];
  if (new Decimal(predecessor.chargedUsd).plus(phase.ceilingUsd).gt(PROTOCOL.totalCeilingUsd))
    throw Error('EVALUATION_CUMULATIVE_ALLOWANCE_EXCEEDED');
  writeEvidence(join(output, 'run.json'), {
    version: PROTOCOL.version,
    ...binding,
    cohort: PROTOCOL.cohort,
    source,
    protocol: PROTOCOL,
    predecessor: safePredecessor,
    scoringVersion: 'adaptive-scoring-v2',
    startedAt: new Date().toISOString(),
    schedule: schedule.map(({ item, route }) => ({ caseId: item.id, route })),
    data: 'new isolated synthetic workspaces only',
    provider: 'gemini',
    model: PROTOCOL.model,
    capturesHttpAdmissionOrBrowser: false,
  });
  const transport = createEvaluationTransport({
    directory: join(output, 'transport'),
    model: PROTOCOL.model,
    apiKey,
    expectedKeySha256: keyHash,
    ceilingUsd: phase.ceilingUsd,
    maxAttempts: phase.maxAttempts,
    inputUsdPerMillion: PROTOCOL.prices.inputUsdPerMillion,
    outputUsdPerMillion: PROTOCOL.prices.outputUsdPerMillion,
    maxRequestBytes: PROTOCOL.maximumRequestBytes,
  });
  let fixture: Awaited<ReturnType<typeof seedFixtures>> | undefined;
  let restore: (() => void) | undefined;
  let endPool: (() => Promise<void>) | undefined;
  let failure: string | null = null;
  let finalFingerprint: unknown = null;
  let finalSourceHash: string | null = null;
  let attemptedExecutions = 0;
  const scores: { caseId: string; route: EvaluationRoute; score: AdaptiveScore }[] = [];
  const trials: {
    caseId: string;
    route: EvaluationRoute;
    durationMs: number;
    attempts: number;
    score: AdaptiveScore;
  }[] = [];
  try {
    fixture = await seedFixtures({
      ownerUrl: process.env.MIGRATION_DATABASE_URL ?? '',
      runtimeUrl: process.env.DATABASE_URL ?? '',
      confirmation: 'CREATE_ISOLATED_ADAPTIVE_FIXTURE',
    });
    writeEvidence(join(output, 'fixture.json'), {
      orgId: fixture.orgId,
      foreignOrgId: fixture.foreignOrgId,
      chart: fixture.chart,
      counterparties: fixture.counterparties,
      referenceChecks: fixture.referenceChecks,
      storedLineChecks: fixture.storedLineChecks,
      counts: fixture.counts,
      fingerprint: fixture.initialFingerprint,
    });
    restore = transport.install();
    // The only provider transport is the accounted wrapper before application import.
    const { config } = await import('../../server/config');
    if (
      config.aiProvider !== 'gemini' ||
      config.aiModel !== PROTOCOL.model ||
      config.aiKey !== apiKey ||
      config.databaseUrl !== process.env.DATABASE_URL
    )
      throw Error('EVALUATION_IMPORTED_CONFIG_MISMATCH');
    const { financialChat } = await import('../../server/ai');
    const { pool } = await import('../../server/db');
    endPool = () => pool.end();
    for (const { item, route } of schedule) {
      if (evaluationSource().hash !== source.hash) throw Error('EVALUATION_SOURCE_DRIFT');
      const before = await fixture.fingerprint();
      if (before.sha256 !== fixture.initialFingerprint.sha256) throw Error('EVALUATION_BOOKS_CHANGED');
      const directory = join(output, 'trials', `${item.id}-${route}`);
      writeEvidence(join(directory, 'before.json'), before);
      transport.beginTrial({ caseId: item.id, route, maxAttempts: route === 'adaptive' ? 3 : 2 });
      const started = performance.now();
      const outcome: AdaptiveOutcome = {};
      attemptedExecutions++;
      try {
        outcome.response = await financialChat(fixture.orgId, fixtureMessages(item), { route });
      } catch (error) {
        outcome.error = { code: errorCode(error) };
      } finally {
        transport.endTrial();
      }
      const durationMs = Math.round(performance.now() - started);
      const attempts = attemptsFor(output, `${route}/${item.id}`);
      outcome.attempts = attempts;
      // The fixture contains invented business data. Never persist a credential echoed unexpectedly.
      if (JSON.stringify(outcome).includes(apiKey)) throw Error('EVALUATION_CREDENTIAL_IN_OUTCOME');
      writeEvidence(join(directory, 'outcome.json'), { caseId: item.id, route, durationMs, outcome });
      const after = await fixture.fingerprint();
      writeEvidence(join(directory, 'after.json'), after);
      if (after.sha256 !== before.sha256) throw Error('EVALUATION_BOOKS_CHANGED');
      if (evaluationSource().hash !== source.hash) throw Error('EVALUATION_SOURCE_DRIFT');
      const scoringContext = {
        organizationId: fixture.orgId,
        chart: fixture.chart,
        counterparties: fixture.counterparties,
      };
      const originalV1Score = scoreAdaptiveResponse(item, outcome, scoringContext);
      writeEvidence(join(directory, 'score-v1.json'), originalV1Score);
      const score = scoreAdaptiveResponseV2(item, outcome, {
        organizationId: fixture.orgId,
        chart: fixture.chart,
        counterparties: fixture.counterparties,
      });
      writeEvidence(join(directory, 'score.json'), score);
      scores.push({ caseId: item.id, route, score });
      trials.push({ caseId: item.id, route, durationMs, attempts: attempts.length, score });
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
          durationMs,
          attempts: attempts.length,
        }),
      );
      if (transport.summary().haltReason) throw Error('EVALUATION_TRANSPORT_HALTED');
      if (
        outcome.error &&
        ['DATABASE_ERROR', 'DATABASE_UNAVAILABLE', 'EVALUATION_EXECUTION_FAILED'].includes(outcome.error.code)
      )
        throw Error('EVALUATION_INFRASTRUCTURE_FAILED');
    }
    finalFingerprint = await fixture.fingerprint();
    if (JSON.stringify(finalFingerprint) !== JSON.stringify(fixture.initialFingerprint))
      throw Error('EVALUATION_BOOKS_CHANGED');
  } catch (error) {
    failure = errorCode(error);
  } finally {
    try {
      restore?.();
    } catch {
      failure ??= 'EVALUATION_RESTORE_FAILED';
    }
    try {
      if (fixture) {
        finalFingerprint = await fixture.fingerprint();
        if (JSON.stringify(finalFingerprint) !== JSON.stringify(fixture.initialFingerprint))
          failure ??= 'EVALUATION_BOOKS_CHANGED';
      }
    } catch {
      failure ??= 'EVALUATION_FINAL_FINGERPRINT_FAILED';
    }
    try {
      await endPool?.();
    } catch {
      failure ??= 'EVALUATION_POOL_CLOSE_FAILED';
    }
    try {
      await fixture?.close();
    } catch {
      failure ??= 'EVALUATION_FIXTURE_CLOSE_FAILED';
    }
  }
  let budget: unknown;
  try {
    budget = transport.close();
  } catch {
    failure ??= 'EVALUATION_LEDGER_CLOSE_FAILED';
    budget = transport.summary();
  }
  try {
    finalSourceHash = evaluationSource().hash;
    if (finalSourceHash !== source.hash) failure ??= 'EVALUATION_SOURCE_DRIFT';
  } catch {
    failure ??= 'EVALUATION_FINAL_SOURCE_FAILED';
  }
  const complete = failure === null && trials.length === phase.executions;
  const aggregate = complete ? aggregatePairedScores(cases, scores, binding.phase) : null;
  writeEvidence(join(output, 'summary.json'), {
    version: PROTOCOL.version,
    ...binding,
    sourceHash: source.hash,
    complete,
    failure,
    plannedExecutions: phase.executions,
    attemptedExecutions,
    completedExecutions: trials.length,
    finalSourceHash,
    trials,
    aggregate,
    budget,
    predecessor: safePredecessor,
    scoringVersion: 'adaptive-scoring-v2',
    cumulativeAccounting: {
      priorChargedUsd: predecessor.chargedUsd,
      currentChargedUsd: (budget as { chargedUsd: string }).chargedUsd,
      totalChargedUsd: new Decimal(predecessor.chargedUsd)
        .plus((budget as { chargedUsd: string }).chargedUsd)
        .toString(),
      priorAttempts: predecessor.attempts,
      currentAttempts: (budget as { attempts: number }).attempts,
      totalAttempts: predecessor.attempts + (budget as { attempts: number }).attempts,
      totalCeilingUsd: PROTOCOL.totalCeilingUsd,
      unusedDevelopmentTransferred: false,
    },
    initialFingerprint: fixture?.initialFingerprint ?? null,
    finalFingerprint,
    finishedAt: new Date().toISOString(),
    limitations: [
      'Synthetic internally authored questions; no production accuracy guarantee.',
      'Direct service evaluation, not Express admission or browser/hosting validation.',
      'Current standard-rate estimates plus unknown reservations, not an invoice or account balance.',
    ],
  });
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
      console.error(JSON.stringify({ error: errorCode(error) }));
      process.exitCode = 1;
    });
  else {
    console.error('Use inspect or run. The run command requires the exact authorized manual CI context.');
    process.exitCode = 2;
  }
}
