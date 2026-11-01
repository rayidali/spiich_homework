import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cases } from './conversation-acceptance/cases';
import {
  approvalSchema,
  FOCUSED_CASE_IDS,
  focusedPreparation,
  preparation,
  selectedCasesForApproval,
  sha256,
  validateApproval,
} from '../scripts/conversation-acceptance/protocol';
import { validateWorkflowPermit } from '../scripts/conversation-acceptance/workflow';

const synthetic = vi.hoisted(() => ({
  source: { hash: 'b'.repeat(64), files: {} },
  before: { hash: 'c'.repeat(64) },
  chat: vi.fn(),
  close: vi.fn(),
  poolEnd: vi.fn(),
}));
vi.mock('../scripts/conversation-acceptance/protocol', async (original) => ({
  ...(await original<typeof import('../scripts/conversation-acceptance/protocol')>()),
  sourceBinding: vi.fn(() => synthetic.source),
  verifyCommittedSource: vi.fn(),
}));
vi.mock('../scripts/conversation-acceptance/database', () => ({
  seedDatabase: vi.fn(async () => ({
    org: '00000000-0000-4000-8000-000000000001',
    chart: [],
    before: synthetic.before,
    fingerprint: async () => synthetic.before,
    close: synthetic.close,
  })),
}));
vi.mock('../server/ai', () => ({ financialChat: synthetic.chat }));
vi.mock('../server/db', () => ({ pool: { end: synthetic.poolEnd } }));
vi.mock('../server/config', () => ({
  config: {
    get aiProvider() {
      return process.env.AI_PROVIDER;
    },
    get aiModel() {
      return process.env.AI_MODEL;
    },
    get aiKey() {
      return process.env.GEMINI_API_KEY;
    },
    get databaseUrl() {
      return process.env.DATABASE_URL;
    },
  },
}));
import { execute, main } from '../scripts/conversation-acceptance/cli';

const key = 'synthetic-focused-key-not-valid';
const now = Date.parse('2026-11-01T13:00:00Z');
const directories: string[] = [];
function permitV1() {
  return {
    version: 'conversation-acceptance-approval-v1',
    authorization: 'explicit_user_approval_recorded_by_operator',
    cohort: `conversation-focused-test-${randomUUID()}`,
    sourceCommit: 'a'.repeat(40),
    sourceHash: synthetic.source.hash,
    keySha256: sha256(key),
    artifactKeySha256: sha256('d'.repeat(64)),
    databaseName: 'daybook_conversation_live',
    approvedAt: '2026-11-01T12:00:00Z',
    expiresAt: '2026-11-02T12:00:00Z',
    model: 'gemini-3.5-flash-lite',
    route: 'composable',
    businessDate: '2026-11-01',
    maxRequests: 35,
    maxAttempts: 70,
    maxRequestBytes: 262144,
    maxOutputTokens: 4000,
    ceilingUsd: '0.20',
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
  };
}
function permitV2(ids: string[] = [...FOCUSED_CASE_IDS]) {
  const turns = ids.reduce((sum, id) => sum + (cases.find((c) => c.id === id)?.turns.length ?? 0), 0);
  return {
    ...permitV1(),
    version: 'conversation-acceptance-approval-v2',
    caseIds: ids,
    maxRequests: turns,
    maxAttempts: turns * 2,
    ceilingUsd: '0.09',
  };
}
function approved(value: unknown) {
  const raw = JSON.stringify(value);
  return validateApproval(raw, sha256(raw), synthetic.source.hash, key, now);
}
beforeEach(() => {
  vi.clearAllMocks();
  synthetic.chat.mockResolvedValue({ answer: 'Scripted response, not measured model output.', evidence: [] });
  synthetic.close.mockResolvedValue(undefined);
  synthetic.poolEnd.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Focused v2 approval remains separate from full v1 execution', () => {
  it('preserves the full35-turn v1 contract and rejects adding a selection to it', () => {
    const full = approved(permitV1());
    expect(selectedCasesForApproval(full)).toEqual(cases);
    expect(selectedCasesForApproval(full).reduce((sum, c) => sum + c.turns.length, 0)).toBe(35);
    expect(full).toMatchObject({ maxRequests: 35, maxAttempts: 70 });
    expect(full).not.toHaveProperty('caseIds');
    expect(() => approved({ ...permitV1(), caseIds: ['C02'] })).toThrow();
  });
  it.each([[], ['C02', 'C02'], ['C99'], ['C02', 'C03', 'unknown'], ['c02']].map((ids) => ({ ids })))(
    'rejects empty, duplicate or unknown selection %j',
    ({ ids }) => {
      expect(() => approved(permitV2(ids))).toThrow();
    },
  );
  it('preserves explicit case order and all turns of a selected multi-turn case', () => {
    const ids = ['C30', 'C01', 'C02'];
    const value = approved(permitV2(ids));
    const selected = selectedCasesForApproval(value);
    expect(selected.map((c) => c.id)).toEqual(ids);
    expect(selected[1]).toEqual(cases.find((c) => c.id === 'C01'));
    expect(value.maxRequests).toBe(selected.reduce((sum, c) => sum + c.turns.length, 0));
    expect(value.maxAttempts).toBe(value.maxRequests * 2);
  });
  it.each([
    { maxRequests: 9 },
    { maxRequests: 11 },
    { maxRequests: 36 },
    { maxAttempts: 19 },
    { maxAttempts: 21 },
    { maxAttempts: 71 },
    { ceilingUsd: '0.21' },
    { model: 'another-model' },
    { route: 'adaptive' },
    { maxRequestBytes: 262145 },
    { maxOutputTokens: 4001 },
    { inputUsdPerMillion: '0' },
    { authorization: 'NOT_APPROVED' },
    { originalAnswers: ['do not substitute these'] },
  ])('rejects selection/count/budget/binding widening %j', (change) => {
    expect(() => approved({ ...permitV2(), ...change })).toThrow();
  });
  it('binds selection to exact approval bytes, source, key and validity', () => {
    const raw = JSON.stringify(permitV2());
    expect(() => validateApproval(raw, '0'.repeat(64), synthetic.source.hash, key, now)).toThrow(
      'APPROVAL_HASH',
    );
    expect(() => validateApproval(raw, sha256(raw), 'e'.repeat(64), key, now)).toThrow('SOURCE_DRIFT');
    expect(() => validateApproval(raw, sha256(raw), synthetic.source.hash, 'other-key', now)).toThrow(
      'KEY_BINDING',
    );
    expect(() => validateApproval(raw, sha256(raw), synthetic.source.hash, key, now + 3 * 86400000)).toThrow(
      'APPROVAL_TIME',
    );
    const changed = JSON.parse(raw);
    changed.caseIds.reverse();
    expect(() =>
      validateApproval(JSON.stringify(changed), sha256(raw), synthetic.source.hash, key, now),
    ).toThrow('APPROVAL_HASH');
  });
  it('validates v2 through the existing workflow permit boundary without installing secrets or dispatching', () => {
    const value = permitV2();
    const raw = JSON.stringify(value);
    const binding = {
      runId: '123',
      cohort: value.cohort,
      sourceCommit: value.sourceCommit,
      sourceHash: value.sourceHash,
      approvalHash: sha256(raw),
      runName: `conversation-acceptance/${value.cohort}`,
    };
    expect(validateWorkflowPermit(raw, binding, now)).toEqual(approvalSchema.parse(value));
    expect(() => validateWorkflowPermit(raw, { ...binding, cohort: 'conversation-other-test' }, now)).toThrow(
      'PERMIT_WORKFLOW_MISMATCH',
    );
  });
  it('prints a ten-turn20-attempt9-cent proposal with no approval, key or network access', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'));
    const full = preparation();
    const focused = focusedPreparation();
    expect(full).toMatchObject({
      version: 'conversation-acceptance-preparation-v1',
      cases: 31,
      requests: 35,
      maxAttempts: 70,
      proposedCeilingUsd: '0.20',
    });
    expect(full).not.toHaveProperty('caseIds');
    expect(focused).toMatchObject({
      version: 'conversation-focused-acceptance-preparation-v2',
      approvalVersion: 'conversation-acceptance-approval-v2',
      status: 'NOT_APPROVED_NOT_EXECUTED',
      caseIds: [...FOCUSED_CASE_IDS],
      cases: 10,
      requests: 10,
      maxAttempts: 20,
      proposedCeilingUsd: '0.09',
      noSpend: true,
    });
    expect(focused.source.files).toHaveProperty('tests/conversation-focused-acceptance.test.ts');
    expect(focused).not.toHaveProperty('keySha256');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['prepare-focused']);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual(focused);
    expect(network).not.toHaveBeenCalled();
  });
});

describe('Actual CLI orchestration with fake database/application, no provider inference', () => {
  it.each(['v1', 'v2'] as const)(
    'executes exactly the %s permit selection and retains the appropriate closure shape',
    async (version) => {
      const value = version === 'v1' ? permitV1() : permitV2(['C30', 'C02', 'C01']);
      value.approvedAt = new Date(Date.now() - 60000).toISOString();
      value.expiresAt = new Date(Date.now() + 3600000).toISOString();
      const raw = JSON.stringify(value);
      const approvalDirectory = mkdtempSync(join(tmpdir(), 'daybook-focused-permit-test-'));
      directories.push(approvalDirectory);
      const outputDirectory = join(process.cwd(), '.tools/conversation-acceptance-runs', value.cohort);
      directories.push(outputDirectory);
      const approvalPath = join(approvalDirectory, 'approval.json');
      writeFileSync(approvalPath, raw, { flag: 'wx', mode: 0o600 });
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('GEMINI_API_KEY', key);
      vi.stubEnv(
        'CONVERSATION_OWNER_DATABASE_URL',
        `postgres://owner:synthetic@localhost:5432/${value.databaseName}`,
      );
      vi.stubEnv(
        'CONVERSATION_DATABASE_URL',
        `postgres://spiich_app:synthetic@localhost:5432/${value.databaseName}`,
      );
      for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AI_PROVIDER', 'AI_MODEL'])
        vi.stubEnv(name, 'synthetic-before-run');
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('No provider call permitted'));
      const result = await execute(approvalPath, sha256(raw));
      const selection = selectedCasesForApproval(approvalSchema.parse(value));
      const expectedUsers = selection.flatMap((c) => c.turns.map((turn) => turn.user));
      expect(synthetic.chat.mock.calls.map(([, messages]) => messages.at(-1).content)).toEqual(expectedUsers);
      expect(result).toMatchObject({
        failure: null,
        result: {
          plannedTurns: value.maxRequests,
          recordedTurns: value.maxRequests,
          executionComplete: true,
        },
      });
      const closure = JSON.parse(readFileSync(join(outputDirectory, 'closure.json'), 'utf8'));
      expect(closure).toMatchObject({
        version: `conversation-acceptance-run-${version}`,
        status: 'EXECUTION_COMPLETE_REVIEW_PENDING',
        semanticReview: 'pending',
        overallPass: false,
        budget: { state: 'closed', attempts: 0, chargedUsd: '0' },
      });
      if (version === 'v2') expect(closure.caseIds).toEqual(['C30', 'C02', 'C01']);
      else expect(closure).not.toHaveProperty('caseIds');
      expect(synthetic.close).toHaveBeenCalledOnce();
      expect(synthetic.poolEnd).toHaveBeenCalledOnce();
      expect(network).not.toHaveBeenCalled();
    },
  );
});
