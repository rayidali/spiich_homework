import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROTOCOL,
  assertUnusedPhase,
  binding,
  hasValidatedFinancialPlan,
  operationallyComplete,
  schedule,
  validatePermit,
  verifySmokeArtifact,
} from '../scripts/compact-completion-evaluation';
import { jsonFile, sealArtifacts, writeEvidence } from '../scripts/completeness-evaluation/artifacts';
import { PROTOCOL as inherited, sha256 } from '../scripts/completeness-evaluation/protocol';
import type { CompletenessCase } from '../scripts/completeness-evaluation/types';

const hash = 'a'.repeat(64),
  commit = 'b'.repeat(40);
const expected = {
  runId: '1234',
  sourceCommit: commit,
  sourceHash: hash,
  approvalSha256: hash,
  keySha256: 'c'.repeat(64),
};
const fingerprint = {
  accounts: 20,
  entries: 70,
  lines: 140,
  organizations: 2,
  scope: 'full_org_account_entry_line_rows',
  sha256: hash,
};
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function permit() {
  return {
    version: 'compact-completion-private-approval-v1',
    cohort: PROTOCOL.cohort,
    sourceCommit: commit,
    sourceHash: hash,
    keySha256: hash,
    artifactKeySha256: hash,
    nonce: 'd'.repeat(32),
    approvedAt: '2026-11-01T00:00:00Z',
    expiresAt: '2026-11-02T00:00:00Z',
    priorChargedUsd: '0.2983252',
    approvedOverallCeilingUsd: '0.90',
    ceilings: { development: '0.07', holdout: '0.42', total: '0.49' },
    attempts: { development: 9, holdout: 128, total: 137 },
    authorization: 'explicit_user_approval_recorded_by_operator',
  };
}
function validCompletion(): Parameters<typeof operationallyComplete>[0] {
  return {
    phase: 'development',
    failure: null,
    trials: [
      { validatedFinancialPlan: true },
      { validatedFinancialPlan: false },
      { validatedFinancialPlan: false },
    ],
    budget: {
      state: 'closed',
      attempts: 3,
      knownUsd: '0.002',
      unknownReservedUsd: '0.02',
      chargedUsd: '0.022',
      pending: 0,
      activeTrial: null,
      haltReason: null,
    },
    sourceHash: hash,
    finalSourceHash: hash,
    initialFingerprint: fingerprint,
    finalFingerprint: fingerprint,
  };
}
function syntheticArtifact() {
  const path = mkdtempSync(join(tmpdir(), 'compact-completion-'));
  directories.push(path);
  const cells = ['D01', 'D02', 'D03'].map((caseId, index) => {
    const score = {
      caseId,
      split: 'development',
      classification: index === 0 ? 'partial_answer' : 'execution_error',
    };
    const base = join(path, 'trials', `${caseId}-complete`);
    writeEvidence(join(base, 'before.json'), fingerprint);
    writeEvidence(join(base, 'after.json'), fingerprint);
    writeEvidence(join(base, 'score.json'), score);
    writeEvidence(join(base, 'outcome.json'), {
      caseId,
      route: 'complete',
      outcome:
        index === 0
          ? { response: { query: { name: 'financial_analysis' } } }
          : { error: { code: 'AI_INVALID_RESPONSE' } },
    });
    return {
      caseId,
      route: 'complete',
      durationMs: 1,
      attempts: 1,
      validatedFinancialPlan: index === 0,
      score,
    };
  });
  writeEvidence(join(path, 'transport/manifest.json'), {
    version: 'completion-repair-evaluation-v1',
    model: PROTOCOL.model,
    expectedKeySha256: expected.keySha256,
    ceilingUsd: '0.07',
    maxAttempts: 9,
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    maxRequestBytes: 256 * 1024,
    maxResponseBytes: 256 * 1024,
    maxOutputTokens: 4000,
  });
  writeEvidence(join(path, 'transport/ledger.json'), {
    version: 'completion-repair-evaluation-v1',
    state: 'closed',
    haltReason: null,
    manifestSha256: sha256(readFileSync(join(path, 'transport/manifest.json'))),
    trials: Object.fromEntries(
      cells.map((cell) => [
        `complete/${cell.caseId}`,
        { state: 'finished', caseId: cell.caseId, route: 'complete', maxAttempts: 3 },
      ]),
    ),
    records: cells.map((cell, i) => ({
      id: `000${i + 1}`,
      trial: `complete/${cell.caseId}`,
      state: i === 2 ? 'unknown' : 'known',
      costUsd: i === 2 ? null : '0.001',
      reservedUsd: '0.02',
    })),
  });
  writeEvidence(join(path, 'summary.json'), {
    ...validCompletion(),
    ...expected,
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    complete: true,
    trials: cells,
    plannedExecutions: 3,
    completedExecutions: 3,
  });
  function change(relative: string, update: (value: Record<string, any>) => void) {
    const file = join(path, relative),
      value = jsonFile(file) as Record<string, any>;
    update(value);
    writeEvidence(file, value, false);
  }
  function seal() {
    rmSync(join(path, 'artifact-manifest.json'), { force: true });
    return sealArtifacts(path);
  }
  seal();
  return { path, change, seal };
}

describe('Compact comparison permit, schedule and smoke gate', () => {
  it('carries all predecessor charges with fixed separate caps and requires the new exact permit', () => {
    const raw = JSON.stringify(permit()),
      bound = { ...expected, approvalSha256: sha256(raw) };
    expect(validatePermit(raw, bound, Date.parse('2026-11-01T01:00:00Z'))).toEqual(permit());
    expect(PROTOCOL.priorChargedUsd).toBe('0.2983252');
    expect(PROTOCOL.phases).toEqual({
      development: { executions: 3, maxAttempts: 9, ceilingUsd: '0.07' },
      holdout: { executions: 48, maxAttempts: 128, ceilingUsd: '0.42' },
    });
    for (const patch of [
      { priorChargedUsd: '0' },
      { ceilings: { development: '0.08', holdout: '0.41', total: '0.49' } },
      { version: 'completion-repair-private-approval-v1' },
      { unauthorizedExtra: true },
    ]) {
      const changed = JSON.stringify({ ...permit(), ...patch });
      expect(() =>
        validatePermit(
          changed,
          { ...expected, approvalSha256: sha256(changed) },
          Date.parse('2026-11-01T01:00:00Z'),
        ),
      ).toThrow();
    }
    expect(() =>
      validatePermit(raw, { ...bound, sourceCommit: 'e'.repeat(40) }, Date.parse('2026-11-01T01:00:00Z')),
    ).toThrow('APPROVAL_SOURCE');
    expect(() => validatePermit(raw, bound, Date.parse('2026-11-02T00:00:00Z'))).toThrow('APPROVAL_TIME');
  });
  it('allows only manual main attempt one and the correct phase predecessor', () => {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: PROTOCOL.repository,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1',
      NODE_ENV: 'test',
      COMPACT_COHORT: PROTOCOL.cohort,
      COMPACT_PHASE: 'development',
      GITHUB_SHA: commit,
      COMPACT_SOURCE_COMMIT: commit,
      COMPACT_SOURCE_HASH: hash,
      COMPACT_APPROVAL_SHA256: hash,
      GITHUB_RUN_ID: '1234',
    };
    expect(binding(env).phase).toBe('development');
    for (const patch of [
      { GITHUB_RUN_ATTEMPT: '2' },
      { GITHUB_EVENT_NAME: 'push' },
      { GITHUB_REF: 'refs/heads/other' },
      { COMPACT_DEVELOPMENT_RUN: '5678' },
      { COMPACT_PHASE: 'holdout' },
    ])
      expect(() => binding({ ...env, ...patch })).toThrow();
    expect(binding({ ...env, COMPACT_PHASE: 'holdout', COMPACT_DEVELOPMENT_RUN: '5678' }).phase).toBe(
      'holdout',
    );
  });
  it('consumes a phase even when a prior dispatch failed', () => {
    const runs = [
      { id: 1234, display_title: `compact-completion-evaluation/${PROTOCOL.cohort}/development` },
    ];
    expect(() => assertUnusedPhase(runs, '1234', 'development')).not.toThrow();
    expect(() => assertUnusedPhase(runs, '5678', 'development')).toThrow('PHASE_USED');
    expect(() => assertUnusedPhase(runs, '5678', 'holdout')).not.toThrow();
  });
  it('selects exactly the three named complete smoke cells without reading held-out fixtures', () => {
    const cases = ['D04', 'D03', 'D01', 'D02'].map((id) => ({
      id,
      split: 'development',
    })) as CompletenessCase[];
    expect(schedule(cases, 'development').map(({ item, route }) => [item.id, route])).toEqual([
      ['D01', 'complete'],
      ['D02', 'complete'],
      ['D03', 'complete'],
    ]);
    expect(() =>
      schedule(
        cases.filter((c) => c.id !== 'D02'),
        'development',
      ),
    ).toThrow('SMOKE_CASES');
    const synthetic = inherited.families.flatMap((family, f) =>
      Array.from({ length: 4 }, (_, i) => ({ id: `S${f}${i}`, split: 'holdout', family })),
    ) as CompletenessCase[];
    const held = schedule(synthetic, 'holdout');
    expect(held).toHaveLength(48);
    for (const item of synthetic)
      expect(
        held
          .filter((c) => c.item.id === item.id)
          .map((c) => c.route)
          .sort(),
      ).toEqual(['adaptive', 'complete', 'composable']);
  });
  it('allows preserved failed cells and unknown charges after one validated financial plan', () => {
    expect(operationallyComplete(validCompletion())).toBe(true);
    expect(hasValidatedFinancialPlan({ query: { name: 'inspect_financial_data' } })).toBe(true);
    for (const response of [
      null,
      { answer: 'complete' },
      { query: { name: 'request_details' } },
      { query: { name: 'plan_complete_answer' } },
    ])
      expect(hasValidatedFinancialPlan(response)).toBe(false);
  });
  it.each([
    'missing-cell',
    'no-valid-plan',
    'pending',
    'active',
    'halt',
    'lost-unknown',
    'over-budget',
    'too-many-attempts',
    'source-drift',
    'book-drift',
    'partial-fingerprint',
  ])('rejects %s before holdout', (failure) => {
    const value = structuredClone(validCompletion());
    if (failure === 'missing-cell') value.trials.pop();
    if (failure === 'no-valid-plan') value.trials.forEach((v) => (v.validatedFinancialPlan = false));
    if (failure === 'pending') value.budget.pending = 1;
    if (failure === 'active') value.budget.activeTrial = 'complete/D03';
    if (failure === 'halt') value.budget.haltReason = 'BUDGET_EXHAUSTED';
    if (failure === 'lost-unknown') value.budget.chargedUsd = '0.002';
    if (failure === 'over-budget')
      Object.assign(value.budget, { chargedUsd: '0.072', unknownReservedUsd: '0.07' });
    if (failure === 'too-many-attempts') value.budget.attempts = 10;
    if (failure === 'source-drift') value.finalSourceHash = 'e'.repeat(64);
    if (failure === 'book-drift') value.finalFingerprint = { ...fingerprint, entries: 71 };
    if (failure === 'partial-fingerprint')
      value.initialFingerprint = value.finalFingerprint = { sha256: hash };
    expect(operationallyComplete(value)).toBe(false);
  });
});

describe('Authenticated smoke predecessor accounting and provenance', () => {
  it('accepts three preserved cells with one valid plan and full unknown reservation', () => {
    const artifact = syntheticArtifact();
    expect(verifySmokeArtifact(artifact.path, expected)).toMatchObject({
      runId: '1234',
      chargedUsd: '0.022',
      attempts: 3,
    });
  });
  it.each(['cost', 'trial', 'source', 'flag', 'book', 'manifest'])(
    'rejects an inconsistent %s even with a fresh local file manifest',
    (failure) => {
      const artifact = syntheticArtifact();
      if (failure === 'cost')
        artifact.change('transport/ledger.json', (v) => (v.records[2].reservedUsd = '0.001'));
      if (failure === 'trial')
        artifact.change('transport/ledger.json', (v) => (v.records[2].trial = 'complete/D04'));
      if (failure === 'source') artifact.change('summary.json', (v) => (v.sourceHash = 'e'.repeat(64)));
      if (failure === 'flag')
        artifact.change(
          'trials/D01-complete/outcome.json',
          (v) => (v.outcome.response.query.name = 'request_details'),
        );
      if (failure === 'book') artifact.change('trials/D03-complete/after.json', (v) => v.entries++);
      if (failure === 'manifest') artifact.change('transport/manifest.json', (v) => (v.maxAttempts = 10));
      artifact.seal();
      expect(() => verifySmokeArtifact(artifact.path, expected)).toThrow();
    },
  );
  it('keeps the artifact key preflight before provider access and uploads ciphertext only', () => {
    const workflow = readFileSync('.github/workflows/compact-completion-evaluation.yml', 'utf8');
    expect(workflow.indexOf('scripts/compact-completion-evaluation.ts preflight')).toBeLessThan(
      workflow.indexOf('GEMINI_API_KEY: ${{ secrets.COMPACT_COMPLETION_GEMINI_KEY }}'),
    );
    expect(workflow).toContain('path: .tools/compact-completion-encrypted/');
    expect(workflow).not.toContain('path: .tools/compact-completion-output');
    expect(workflow).toContain('COMPACT_PRIVATE_APPROVAL: ${{ secrets.COMPACT_COMPLETION_APPROVAL }}');
  });
});
