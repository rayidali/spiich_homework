import { expect, it } from 'vitest';
import { Decimal } from '../../shared/money';
import {
  PROTOCOL,
  sha256,
  validatePermit,
  validateRunEnvironment,
  validateDevelopmentSummary,
} from '../../scripts/completion-repair-evaluation/protocol';
import { PROTOCOL as inherited } from '../../scripts/completeness-evaluation/protocol';
import { finalizeRunIntegrity } from '../../scripts/completion-repair-evaluation/run-integrity';

const now = Date.parse('2026-11-01T12:00:00Z');
const expected = {
  approvalSha256: '',
  sourceCommit: 'a'.repeat(40),
  sourceHash: 'b'.repeat(64),
  freezeSha256: 'c'.repeat(64),
};
function permit() {
  return {
    version: 'completion-repair-private-approval-v1',
    cohort: PROTOCOL.cohort,
    sourceCommit: expected.sourceCommit,
    sourceHash: expected.sourceHash,
    freezeSha256: expected.freezeSha256,
    keySha256: 'd'.repeat(64),
    artifactKeySha256: 'e'.repeat(64),
    nonce: 'f'.repeat(32),
    approvedAt: '2026-11-01T11:00:00Z',
    expiresAt: '2026-11-02T11:00:00Z',
    ceilings: { development: '0.14', holdout: '0.48', total: '0.62' },
    attempts: { development: 32, holdout: 128, total: 160 },
    priorChargedUsd: '0.1717792',
    approvedOverallCeilingUsd: '0.90',
    authorization: 'explicit_user_approval_recorded_by_operator',
  };
}
function check(value: unknown, at = now) {
  const raw = JSON.stringify(value);
  return validatePermit(raw, { ...expected, approvalSha256: sha256(raw) }, at);
}
it('preserves inherited questions/route counts and the entire adoption screen with a distinct cohort', () => {
  expect(PROTOCOL.cohort).not.toBe(inherited.cohort);
  expect(PROTOCOL.routes).toEqual(inherited.routes);
  expect(PROTOCOL.adoption).toEqual(inherited.adoption);
  expect(PROTOCOL.phases.development.executions).toBe(12);
  expect(PROTOCOL.phases.holdout.executions).toBe(48);
  expect(
    new Decimal(PROTOCOL.priorChargedUsd)
      .plus(PROTOCOL.totalCeilingUsd)
      .plus(PROTOCOL.hostedAcceptanceReserveUsd)
      .lte(PROTOCOL.approvedOverallCeilingUsd),
  ).toBe(true);
  expect(check(permit()).ceilings.total).toBe('0.62');
});
it.each([
  { version: 'completeness-private-approval-v1' },
  { cohort: inherited.cohort },
  { priorChargedUsd: '0' },
  { artifactKeySha256: '' },
  { ceilings: { development: '0.20', holdout: '0.70', total: '0.90' } },
  { expiresAt: '2026-11-10T11:00:00Z' },
  { sourceCommit: '0'.repeat(40) },
])('rejects stale, unbound or expanded permits %j', (change) =>
  expect(() => check({ ...permit(), ...change })).toThrow(),
);
it('rejects expiry and the prior cohort dispatch', () => {
  expect(() => check(permit(), Date.parse('2026-11-03T12:00:00Z'))).toThrow();
  expect(() =>
    validateRunEnvironment({
      COMPLETENESS_PHASE: 'development',
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: PROTOCOL.repository,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1',
      NODE_ENV: 'test',
      COMPLETENESS_COHORT: inherited.cohort,
      GITHUB_SHA: expected.sourceCommit,
      COMPLETENESS_SOURCE_COMMIT: expected.sourceCommit,
      COMPLETENESS_SOURCE_HASH: expected.sourceHash,
      COMPLETENESS_APPROVAL_SHA256: 'f'.repeat(64),
      GITHUB_RUN_ID: '123',
    }),
  ).toThrow();
});
const fingerprint = {
  sha256: 'f'.repeat(64),
  organizations: 2,
  accounts: 48,
  entries: 51,
  lines: 104,
  scope: 'full_org_account_entry_line_rows',
};
const closed = {
  state: 'closed' as const,
  attempts: 12,
  knownUsd: '0.05',
  unknownReservedUsd: '0.03',
  chargedUsd: '0.08',
  haltReason: null,
  pending: 0,
  activeTrial: null,
};
it('admits a fully observed phase with retained unknown reservations, never pending or missing cells', () => {
  const input = {
    phase: 'development' as const,
    failure: null,
    plannedExecutions: 12,
    completedExecutions: 12,
    sourceHash: expected.sourceHash,
    finalSourceHash: expected.sourceHash,
    initialFingerprint: fingerprint,
    finalFingerprint: fingerprint,
    budget: closed,
  };
  expect(finalizeRunIntegrity(input)).toEqual({ complete: true, failure: null });
  for (const change of [
    { pending: 1 },
    { chargedUsd: '0.05' },
    { haltReason: 'BUDGET_EXHAUSTED' },
    { knownUsd: '0.15', chargedUsd: '0.18' },
  ])
    expect(finalizeRunIntegrity({ ...input, budget: { ...closed, ...change } }).complete).toBe(false);
  expect(finalizeRunIntegrity({ ...input, completedExecutions: 11 }).complete).toBe(false);
  const summary = {
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    phase: 'development',
    runId: '123',
    sourceCommit: expected.sourceCommit,
    sourceHash: expected.sourceHash,
    finalSourceHash: expected.sourceHash,
    approvalSha256: 'e'.repeat(64),
    complete: true,
    failure: null,
    plannedExecutions: 12,
    completedExecutions: 12,
    initialFingerprint: fingerprint,
    finalFingerprint: fingerprint,
    budget: closed,
  };
  expect(
    validateDevelopmentSummary(summary, {
      runId: '123',
      sourceCommit: expected.sourceCommit,
      sourceHash: expected.sourceHash,
      approvalSha256: 'e'.repeat(64),
    }).budget.chargedUsd,
  ).toBe('0.08');
});
