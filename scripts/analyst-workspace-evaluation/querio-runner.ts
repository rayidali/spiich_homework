import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createQuerioService } from '../../server/querio-service';
import { createQuerioClient, type QuerioRequest, type QuerioSettings } from '../../server/querio-client';
import type { AnalystConversation } from '../../shared/analyst';
import { hash, readReferences, requireFixture } from './references';
import { createFileAnalystStore } from './querio-file-store';
import { extractQuerioObservations, type QuerioObservation } from './querio-observations';

export const PAIRED_QUERIO_CASES = Object.freeze(['A01', 'A05', 'A06', 'A07', 'A11', 'A18']);
export type QuerioComparisonPermit = {
  approved: boolean;
  approvalReference: string;
  scopeId: string;
  sourceCommit: string;
  datasource: string;
  workspaceId: string;
  modelId: string;
  businessDate: '2026-11-03';
  /** Fresh caller-supplied estimate; the API does not verify this balance. */
  includedCreditHeadroom: number;
  totalTurnReservation: 120;
  perTurnReservation: 15;
  stopAtObservedResponses: 12;
};
type FixtureAudit = {
  fingerprintBefore: string;
  fingerprintAfter: string;
  factChecks: number;
  referenceHashes: Record<string, string>;
};
type Turn = {
  caseId: string;
  number: number;
  prompt: string;
  conversationId: string;
  messageId: string;
  reservationId: string;
  submitted: boolean;
  baselineHistoryAvailable: boolean;
  agentId?: string;
  runId?: string;
  runStatus?: string;
  observations: QuerioObservation[];
  finalHistoryAvailable: boolean;
  stopRequested: boolean;
  historyFailures: number;
};
export type QuerioComparisonOptions = {
  root?: string;
  outputDirectory: string;
  settings: QuerioSettings;
  permit: QuerioComparisonPermit;
  /** Read-only checks of the already populated fixture. Never seed/reset during execution. */
  verifyFixture(): Promise<FixtureAudit>;
  /** Defaults to createQuerioClient(settings) with native fetch; tests inject a no-network transport. */
  request?: QuerioRequest;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
  progress?: (value: { caseId: string; turn: number; status: string; observedResponses: number }) => void;
};
const active = (state: AnalystConversation) => ['starting', 'running'].includes(state.status);
const terminalRun = new Set(['completed', 'failed', 'cancelled', 'canceled']);
const safeCode = (error: unknown) =>
  typeof (error as { code?: unknown })?.code === 'string' &&
  /^[A-Z][A-Z0-9_]{1,79}$/.test(String((error as { code: string }).code))
    ? (error as { code: string }).code
    : 'QUERIO_COMPARISON_OPERATION_FAILED';

/** No top-level execution. A caller must supply a fresh reviewed, source-bound permit. */
export async function runQuerioComparison(options: QuerioComparisonOptions) {
  const root = resolve(options.root ?? process.cwd()),
    output = resolve(options.outputDirectory),
    permit = options.permit;
  requireFixture(
    permit.approved === true && permit.approvalReference.length > 5 && permit.scopeId.length > 5,
    'EXPLICIT_QUERIO_COMPARISON_APPROVAL_REQUIRED',
  );
  requireFixture(/^[a-f0-9]{40}$/.test(permit.sourceCommit), 'EXACT_SOURCE_REQUIRED');
  requireFixture(output.startsWith(resolve(root, '.tools') + sep), 'PRIVATE_OUTPUT_REQUIRED');
  requireFixture(
    permit.datasource === options.settings.datasource &&
      permit.workspaceId === options.settings.workspaceId &&
      permit.modelId === options.settings.model &&
      permit.datasource === 'daybook-acceptance-20261104',
    'PAIRED_DATASOURCE_MODEL_REQUIRED',
  );
  requireFixture(
    Number.isSafeInteger(permit.includedCreditHeadroom) &&
      permit.includedCreditHeadroom >= permit.totalTurnReservation &&
      permit.totalTurnReservation === 120 &&
      permit.perTurnReservation === 15 &&
      permit.stopAtObservedResponses === 12 &&
      permit.businessDate === '2026-11-03',
    'CREDIT_AND_DATE_PERMIT_CHANGED',
  );
  const refs = readReferences(root),
    referenceDirectory = resolve(root, 'tests/analyst-workspace-acceptance');
  const specification = JSON.parse(readFileSync(resolve(referenceDirectory, 'cases.json'), 'utf8')) as {
    cases: { id: string; turns: { prompt: string; chartRequired: boolean }[] }[];
  };
  const cases = PAIRED_QUERIO_CASES.map((id) => {
    const item = specification.cases.find((value) => value.id === id);
    requireFixture(item, 'FROZEN_CASE_MISSING');
    return {
      id,
      turns: item.turns.map((turn) => ({ prompt: turn.prompt, chartRequired: Boolean(turn.chartRequired) })),
    };
  });
  requireFixture(
    cases.flatMap((item) => item.turns).length === 8 &&
      cases.flatMap((item) => item.turns).filter((turn) => turn.chartRequired).length === 2 &&
      refs.fixture.business_date === permit.businessDate,
    'FROZEN_SUBSET_CHANGED',
  );
  const before = await options.verifyFixture();
  requireFixture(
    before.factChecks === 38 &&
      before.fingerprintBefore === before.fingerprintAfter &&
      JSON.stringify(before.referenceHashes) === JSON.stringify(refs.hashes),
    'FIXTURE_NOT_VERIFIED',
  );
  const context = `${readFileSync(resolve(referenceDirectory, 'shared-context.md'), 'utf8')}\nFixed evaluation business date: ${refs.fixture.business_date}. Treat this as today in the organization's timezone.\n`;
  const instructions = `${context}\nUse only the selected datasource ${permit.datasource}. Its eight querio_fixture views have the same accounting columns as native analytics views and are fixed to this business. Investigate with read-only SQL and exact SQL NUMERIC or Decimal calculations. Retain executed tables and requested charts in the saved notebook. Answer the actual question first. Do not edit workspace files. Saved notebook cells may need rerunning after a new session; do not assume live Python variables survived. Never claim a graph exists unless it is saved.\n`;
  const claimsDirectory = resolve(root, '.tools/querio-comparison/permit-claims');
  mkdirSync(claimsDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(claimsDirectory, `${hash(permit.scopeId)}.json`),
    JSON.stringify({ output, claimedAt: new Date().toISOString(), automaticReplay: false }),
    { mode: 0o600, flag: 'wx' },
  );
  mkdirSync(output, { mode: 0o700 }); // Exclusive run directory; restart cannot overwrite or automatically resume.
  const save = (name: string, value: unknown) =>
    writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  save('cohort-lock.json', { pid: process.pid, createdAt: new Date().toISOString(), automaticResume: false });
  const store = createFileAnalystStore(
    resolve(output, 'state'),
    () => options.now?.().getTime() ?? Date.now(),
  );
  const now = options.now ?? (() => new Date()),
    wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseRequest = options.request ?? createQuerioClient(options.settings);
  let sequence = 0,
    reserved = 0,
    current: Turn | null = null,
    haltReason: string | null = null;
  const observations = new Map<string, QuerioObservation>();
  const seenHistory = new Set<string>();
  const outcomes: {
    caseId: string;
    turn: number;
    status: string;
    errorCode: string | null;
    artifact: string | null;
    chartRequired: boolean;
  }[] = [];
  const sourceHashes = Object.fromEntries(
    [
      'server/querio-service.ts',
      'server/querio-client.ts',
      'server/querio-output.ts',
      'package.json',
      'package-lock.json',
      'scripts/analyst-workspace-evaluation/querio-runner.ts',
      'scripts/analyst-workspace-evaluation/querio-file-store.ts',
      'scripts/analyst-workspace-evaluation/querio-observations.ts',
      'scripts/analyst-workspace-evaluation/references.ts',
      'scripts/analyst-workspace-evaluation/database.ts',
      'scripts/analyst-workspace-evaluation/oracle-query.ts',
    ].map((path) => [path, hash(readFileSync(resolve(root, path)))]),
  );
  const binding = {
    sourceHashes,
    sourceCommit: permit.sourceCommit,
    modelId: permit.modelId,
    datasource: permit.datasource,
    workspaceId: permit.workspaceId,
    organizationId: refs.fixture.organization_id,
    businessDate: permit.businessDate,
    caseIds: PAIRED_QUERIO_CASES,
    referenceHashes: refs.hashes,
    sharedContextSha256: hash(context),
    instructionsSha256: hash(instructions),
    permit,
  };
  save('binding.json', binding);
  save('context.json', { context, instructions });
  function ingestHistory(agentId: string, raw: unknown) {
    const capture = extractQuerioObservations(agentId, raw);
    if (!current || !capture.available) return capture.available;
    for (const item of capture.observations) {
      // A reopened agent can have a different remote ID while restoring the
      // same notebook entries. Baseline history is context, not fresh usage.
      const id = `${current.conversationId}:${item.id.slice(agentId.length + 1)}`;
      if (seenHistory.has(id)) continue;
      seenHistory.add(id);
      if (current.submitted) {
        const observed = { ...item, id };
        observations.set(id, observed);
        current.observations.push(observed);
      }
    }
    return true;
  }
  const auditRequest: QuerioRequest = async (method, path, body) => {
    const number = String(++sequence).padStart(5, '0');
    save(`http-${number}-request.json`, {
      method,
      path,
      body: body ?? null,
      at: new Date().toISOString(),
      caseId: current?.caseId,
      turn: current?.number,
    });
    try {
      const response = await baseRequest(method, path, body);
      save(`http-${number}-response.json`, { response, at: new Date().toISOString() });
      return response;
    } catch (error) {
      save(`http-${number}-failure.json`, { code: safeCode(error), at: new Date().toISOString() });
      throw error;
    }
  };
  async function captureHistory(agentId: string) {
    if (!current) return;
    const historyUnavailable = async () => {
      if (!current) return;
      current.historyFailures++;
      current.finalHistoryAvailable = false;
      if (current.submitted && !terminalRun.has(current.runStatus ?? '') && !current.stopRequested) {
        current.stopRequested = true;
        save(`stop-${current.caseId}-${current.number}.json`, {
          reason: 'USAGE_OBSERVATION_UNAVAILABLE',
          hardUpstreamLimit: false,
        });
        await store.requestClose(refs.fixture.organization_id, current.conversationId, 'querio');
      }
    };
    try {
      const raw = await auditRequest('GET', `/agent-sessions/${agentId}`);
      if (!ingestHistory(agentId, raw)) {
        await historyUnavailable();
        return;
      }
      if (current.runStatus && terminalRun.has(current.runStatus))
        current.finalHistoryAvailable = current.observations.length > 0;
      if (
        current.submitted &&
        !terminalRun.has(current.runStatus ?? '') &&
        current.observations.length >= permit.stopAtObservedResponses &&
        !current.stopRequested
      ) {
        current.stopRequested = true;
        save(`stop-${current.caseId}-${current.number}.json`, {
          reason: 'OBSERVED_RESPONSE_THRESHOLD',
          count: current.observations.length,
          hardUpstreamLimit: false,
        });
        await store.requestClose(refs.fixture.organization_id, current.conversationId, 'querio');
      }
    } catch {
      await historyUnavailable();
    }
  }
  const request: QuerioRequest = async (method, path, body) => {
    if (method === 'POST' && /^\/agent-sessions\/[^/]+\/events$/.test(path)) {
      requireFixture(current && !current.submitted && !haltReason, 'NO_AUTOMATIC_MESSAGE_REPLAY');
      requireFixture(current.baselineHistoryAvailable, 'QUERIO_BASELINE_HISTORY_UNAVAILABLE');
      const message = body as { type?: unknown; data?: { text?: unknown } };
      requireFixture(
        message.type === 'message' && message.data?.text === current.prompt,
        'FROZEN_PROMPT_CHANGED',
      );
      requireFixture(
        reserved + permit.perTurnReservation <= permit.totalTurnReservation &&
          observations.size + permit.perTurnReservation < permit.includedCreditHeadroom,
        'INCLUDED_CREDIT_RESERVATION_EXHAUSTED',
      );
      reserved += permit.perTurnReservation;
      current.submitted = true;
      save(`reservation-${current.caseId}-${current.number}.json`, {
        reservationId: current.reservationId,
        credits: permit.perTurnReservation,
        totalReserved: reserved,
        observedPriorResponses: observations.size,
        at: new Date().toISOString(),
        billingClaim: 'Not an invoice or upstream-enforced cap. Unknown outcomes retain this reservation.',
      });
    }
    if (method === 'DELETE' && /^\/agent-sessions\/[^/]+$/.test(path))
      await captureHistory(path.split('/').at(-1)!);
    const response = await auditRequest(method, path, body);
    if (current && method === 'GET' && /^\/agent-sessions\/[^/]+$/.test(path) && !current.submitted)
      current.baselineHistoryAvailable = ingestHistory(path.split('/').at(-1)!, response);
    if (current && method === 'POST' && path === '/agent-sessions' && typeof response.id === 'string')
      current.agentId = response.id;
    if (
      current &&
      method === 'POST' &&
      /^\/agent-sessions\/[^/]+\/events$/.test(path) &&
      typeof response.runId === 'string'
    )
      current.runId = response.runId;
    if (current && method === 'GET' && /^\/runs\/[^/]+$/.test(path)) {
      current.runStatus = typeof response.status === 'string' ? response.status : undefined;
      if (current.agentId) await captureHistory(current.agentId);
    }
    return response;
  };
  const service = createQuerioService({
    store,
    settings: () => options.settings,
    request,
    now,
    instructions,
    sourceLabel: 'Acorn Studio acceptance workspace',
  });
  const startedAt = new Date().toISOString();
  let after: FixtureAudit | null = null;
  try {
    for (const entry of cases) {
      const conversationId = randomUUID();
      let created = false,
        caseFailed = false;
      try {
        if (!haltReason) {
          await service.create(refs.fixture.organization_id, conversationId);
          created = true;
        }
        for (const [index, turn] of entry.turns.entries()) {
          if (caseFailed || haltReason) {
            outcomes.push({
              caseId: entry.id,
              turn: index + 1,
              status: 'not_run_after_failure',
              errorCode: haltReason,
              artifact: null,
              chartRequired: turn.chartRequired,
            });
            continue;
          }
          current = {
            caseId: entry.id,
            number: index + 1,
            prompt: turn.prompt,
            conversationId,
            messageId: randomUUID(),
            reservationId: randomUUID(),
            submitted: false,
            baselineHistoryAvailable: false,
            observations: [],
            finalHistoryAvailable: false,
            stopRequested: false,
            historyFailures: 0,
          };
          let state: AnalystConversation | null = null,
            errorCode: string | null = null;
          const start = Date.now();
          try {
            state = await service.send(
              refs.fixture.organization_id,
              conversationId,
              current.messageId,
              turn.prompt,
            );
            let polls = 0;
            while (active(state) && polls < 200 && Date.now() - start < 360000) {
              options.progress?.({
                caseId: entry.id,
                turn: index + 1,
                status: state.phase ?? state.status,
                observedResponses: current.observations.length,
              });
              await wait(1200);
              state = await service.refresh(refs.fixture.organization_id, conversationId);
              polls++;
            }
            if (active(state)) {
              errorCode = 'QUERIO_COMPARISON_DEADLINE';
              await store.requestClose(refs.fixture.organization_id, conversationId, 'querio');
            }
          } catch (error) {
            errorCode = safeCode(error);
          }
          state = await service.get(refs.fixture.organization_id, conversationId).catch(() => state);
          const runtime = (await store.read(refs.fixture.organization_id, conversationId, 'querio')).runtime;
          if (
            current.submitted &&
            (!current.finalHistoryAvailable || !current.runStatus || !terminalRun.has(current.runStatus))
          )
            haltReason = 'QUERIO_USAGE_OR_RUN_OUTCOME_UNKNOWN';
          if (current.observations.length > permit.perTurnReservation)
            haltReason = 'QUERIO_OBSERVED_RESERVATION_OVERRUN';
          const artifact = `${entry.id.toLowerCase()}-turn-${index + 1}.json`;
          save(artifact, {
            ...binding,
            ...current,
            state,
            runtime,
            errorCode,
            elapsedMs: Date.now() - start,
            observedResponseCount: current.observations.length,
            usageMeaning:
              'Observed unique assistant history entries and reported token fields; not a billed-credit count or dollar invoice.',
          });
          const status = errorCode ? 'runner_error' : (state?.status ?? 'unavailable');
          outcomes.push({
            caseId: entry.id,
            turn: index + 1,
            status,
            errorCode,
            artifact,
            chartRequired: turn.chartRequired,
          });
          caseFailed = status !== 'completed';
        }
      } catch (error) {
        haltReason = safeCode(error);
        save(`${entry.id.toLowerCase()}-failure.json`, {
          caseId: entry.id,
          conversationId,
          errorCode: haltReason,
        });
        for (const [index, turn] of entry.turns.entries())
          if (!outcomes.some((value) => value.caseId === entry.id && value.turn === index + 1))
            outcomes.push({
              caseId: entry.id,
              turn: index + 1,
              status: 'not_run_after_failure',
              errorCode: haltReason,
              artifact: null,
              chartRequired: turn.chartRequired,
            });
      } finally {
        if (created) {
          const beforeCloseRuntime = (
            await store.read(refs.fixture.organization_id, conversationId, 'querio')
          ).runtime;
          // close() can abandon an uncertain setup marker without discovering the
          // accepted remote resource's ID. Local closed is not proof of its cleanup.
          const uncertainSetup = ['environment', 'notebook', 'session', 'agent'].includes(
            String(beforeCloseRuntime.pendingMutation),
          );
          let closed = await service.close(refs.fixture.organization_id, conversationId).catch(() => null);
          for (let i = 0; closed && active(closed) && i < 30; i++) {
            await wait(1000);
            closed = await service.refresh(refs.fixture.organization_id, conversationId).catch(() => null);
          }
          const runtime = (await store.read(refs.fixture.organization_id, conversationId, 'querio')).runtime;
          save(`${entry.id.toLowerCase()}-closure.json`, {
            conversationId,
            status: closed?.status ?? 'unconfirmed',
            uncertainSetup,
            beforeCloseRuntime,
            runtime,
          });
          if (
            uncertainSetup ||
            closed?.status !== 'closed' ||
            runtime.environmentId ||
            runtime.agentId ||
            runtime.sessionId ||
            runtime.pendingMutation
          )
            haltReason = 'QUERIO_RESOURCE_CLOSURE_UNCONFIRMED';
        }
        current = null;
      }
    }
  } finally {
    try {
      after = await options.verifyFixture();
    } catch (error) {
      haltReason ??= safeCode(error);
    }
    save('capture-summary.json', {
      ...binding,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcomes,
      haltReason,
      totalReservedCredits: reserved,
      observedAssistantResponses: [...observations.values()],
      observedResponseCount: observations.size,
      fingerprintBefore: before.fingerprintBefore,
      fingerprintAfter: after?.fingerprintAfter ?? null,
      scoring:
        'UNREVIEWED. Completion is not correctness. Actual UI chart delivery requires separate browser evidence.',
      billing:
        'No verified invoice.120 total turn reservations; cancellation requested at12 observed responses/turn. Querio exposes no enforced per-run credit cap; in-flight work may exceed the observation threshold.',
    });
  }
  requireFixture(after?.fingerprintAfter === before.fingerprintBefore, 'EVALUATION_CHANGED_BOOKS');
  requireFixture(
    Object.entries(sourceHashes).every(
      ([path, expected]) => hash(readFileSync(resolve(root, path))) === expected,
    ),
    'EVALUATION_SOURCE_CHANGED',
  );
  return {
    outputDirectory: output,
    completedTurns: outcomes.filter((value) => value.status === 'completed').length,
    observedResponses: observations.size,
    reservedCredits: reserved,
    haltReason,
    accuracyScore: null,
  };
}
