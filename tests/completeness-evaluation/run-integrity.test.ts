import { describe, expect, it } from 'vitest';
import {
  finalizeRunIntegrity,
  type FinalizeRunIntegrityInput,
} from '../../scripts/completeness-evaluation/run-integrity';
import { analyzeCompleteness } from '../../scripts/completeness-evaluation/analysis';
import type { CompletenessScore } from '../../scripts/completeness-evaluation/types';
const fp = () => ({
  sha256: 'a'.repeat(64),
  organizations: 2,
  accounts: 48,
  entries: 51,
  lines: 104,
  scope: 'full_org_account_entry_line_rows',
});
function input(): FinalizeRunIntegrityInput {
  return {
    phase: 'holdout',
    failure: null,
    plannedExecutions: 48,
    completedExecutions: 48,
    sourceHash: 'b'.repeat(64),
    finalSourceHash: 'b'.repeat(64),
    initialFingerprint: fp(),
    finalFingerprint: fp(),
    budget: {
      state: 'closed',
      attempts: 61,
      knownUsd: '0.2345678',
      unknownReservedUsd: '0',
      chargedUsd: '0.2345678',
      haltReason: null,
      pending: 0,
      activeTrial: null,
    },
  };
}
describe('final completeness run integrity', () => {
  it('accepts exact closed, reconciled holdout and development phases without modifying the input', () => {
    const value = input(),
      before = structuredClone(value);
    expect(finalizeRunIntegrity(value)).toEqual({ complete: true, failure: null });
    expect(value).toEqual(before);
    Object.assign(value, { phase: 'development', plannedExecutions: 12, completedExecutions: 12 });
    Object.assign(value.budget!, { attempts: 32, knownUsd: '0.20', chargedUsd: '0.200000000000' });
    expect(finalizeRunIntegrity(value)).toEqual({ complete: true, failure: null });
  });
  it('preserves the first failure even when all scores exist and later checks are also invalid', () => {
    const value = input();
    value.failure = 'COMPLETENESS_INFRASTRUCTURE_FAILED';
    value.finalFingerprint = null;
    value.budget = undefined;
    expect(finalizeRunIntegrity(value)).toEqual({
      complete: false,
      failure: 'COMPLETENESS_INFRASTRUCTURE_FAILED',
    });
  });
  it.each([0, 47, 49, 48.5, NaN])('rejects incomplete or invalid observed count %s', (count) => {
    const value = input();
    value.completedExecutions = count;
    expect(finalizeRunIntegrity(value)).toEqual({
      complete: false,
      failure: 'COMPLETENESS_EXECUTIONS_INCOMPLETE',
    });
  });
  it('does not accept a caller shrinking the planned denominator to match its partial run', () => {
    const value = input();
    value.completedExecutions = value.plannedExecutions = 47;
    expect(finalizeRunIntegrity(value).complete).toBe(false);
  });
  it.each([null, undefined, '', 'b'.repeat(63), 'B'.repeat(64)])(
    'rejects absent or malformed final source %s',
    (source) => {
      const value = input();
      value.finalSourceHash = source as string | null;
      expect(finalizeRunIntegrity(value)).toEqual({
        complete: false,
        failure: 'COMPLETENESS_FINAL_SOURCE_INVALID',
      });
    },
  );
  it('rejects a different valid final source hash', () => {
    const value = input();
    value.finalSourceHash = 'c'.repeat(64);
    expect(finalizeRunIntegrity(value).failure).toBe('COMPLETENESS_SOURCE_DRIFT');
  });
  it.each([
    null,
    undefined,
    {},
    { sha256: 'a'.repeat(64) },
    { ...fp(), scope: 'totals_only' },
    { ...fp(), entries: -1 },
    { ...fp(), lines: undefined },
    { ...fp(), extra: true },
  ])('refuses an absent, partial or weaker fingerprint', (fingerprint) => {
    const value = input();
    value.initialFingerprint = fingerprint;
    value.finalFingerprint = structuredClone(fingerprint);
    expect(finalizeRunIntegrity(value)).toEqual({
      complete: false,
      failure: 'COMPLETENESS_FINAL_FINGERPRINT_INVALID',
    });
  });
  it.each(['sha256', 'organizations', 'accounts', 'entries', 'lines'] as const)(
    'compares the complete fingerprint including %s',
    (key) => {
      const value = input(),
        changed = fp();
      if (key === 'sha256') changed[key] = 'c'.repeat(64);
      else changed[key]++;
      value.finalFingerprint = changed;
      expect(finalizeRunIntegrity(value).failure).toBe('COMPLETENESS_BOOKS_CHANGED');
    },
  );
  it('compares fingerprint fields independent of object property order', () => {
    const value = input();
    value.finalFingerprint = Object.fromEntries(Object.entries(fp()).reverse());
    expect(finalizeRunIntegrity(value).complete).toBe(true);
  });
  it.each([
    { state: 'open' },
    { pending: 1 },
    { activeTrial: 'complete/H16' },
    { haltReason: 'USAGE_UNKNOWN' },
    { unknownReservedUsd: '0.01', chargedUsd: '0.2445678' },
    { knownUsd: '-0.1' },
    { knownUsd: 'NaN' },
    { chargedUsd: 'Infinity' },
    { chargedUsd: '2e-1' },
    { chargedUsd: '0.234567800001' },
    { attempts: -1 },
    { attempts: 1.5 },
    { attempts: 0 },
  ])('refuses unfinished, unpriced or contradictory accounting %j', (patch) => {
    const value = input();
    Object.assign(value.budget!, patch);
    expect(finalizeRunIntegrity(value)).toEqual({
      complete: false,
      failure: 'COMPLETENESS_FINAL_ACCOUNTING_INVALID',
    });
  });
  it.each(['development', 'holdout'] as const)(
    'enforces %s phase caps without transferring unused allowance',
    (phase) => {
      const value = input(),
        max = phase === 'development' ? 32 : 128,
        cap = phase === 'development' ? '0.20' : '0.70';
      Object.assign(value, {
        phase,
        plannedExecutions: phase === 'development' ? 12 : 48,
        completedExecutions: phase === 'development' ? 12 : 48,
      });
      Object.assign(value.budget!, { attempts: max, knownUsd: cap, chargedUsd: cap });
      expect(finalizeRunIntegrity(value).complete).toBe(true);
      value.budget!.attempts++;
      expect(finalizeRunIntegrity(value).failure).toBe('COMPLETENESS_PHASE_BUDGET_EXCEEDED');
      Object.assign(value.budget!, {
        attempts: max,
        knownUsd: phase === 'development' ? '0.200000000001' : '0.700000000001',
        chargedUsd: phase === 'development' ? '0.200000000001' : '0.700000000001',
      });
      expect(finalizeRunIntegrity(value).failure).toBe('COMPLETENESS_PHASE_BUDGET_EXCEEDED');
    },
  );
  it('rejects missing budget or missing prior-failure state rather than assuming success', () => {
    const value = input();
    value.budget = undefined;
    expect(finalizeRunIntegrity(value).failure).toBe('COMPLETENESS_FINAL_ACCOUNTING_INVALID');
    const other = input();
    other.failure = undefined as unknown as null;
    expect(finalizeRunIntegrity(other).failure).toBe('COMPLETENESS_EXISTING_FAILURE_INVALID');
  });
  it('blocks report admission even when all 48 scores would otherwise qualify both candidates', () => {
    const families = ['common', 'discovery', 'arithmetic', 'boundary'];
    const cases = Array.from({ length: 16 }, (_, i) => ({
      id: `Q${i}`,
      family: families[Math.floor(i / 4)],
    }));
    const observations = cases.flatMap((c) =>
      (['composable', 'adaptive', 'complete'] as const).map((route) => {
        const passed = route !== 'composable' || ['common', 'boundary'].includes(c.family);
        const score: CompletenessScore = {
          caseId: c.id,
          split: 'holdout',
          family: c.family,
          classification: passed ? 'structured-correct' : 'partial-answer',
          passed,
          reasons: [],
          requiredClaims: 0,
          matchedClaims: [],
          matchedTables: [],
          focusCorrect: passed,
          primaryMatched: [],
          verifiedExtraClaims: 0,
          unverifiableExtraClaims: 0,
          wrongFinancialClaims: [],
          hardBoundaryViolations: [],
          modelCompletionIgnored: true,
          wordingReview: 'not_model_judged',
        };
        return { caseId: c.id, route, score };
      }),
    );
    expect(analyzeCompleteness({ cases, observations }).eligibleCandidates).toEqual(['adaptive', 'complete']);
    const value = input();
    value.finalSourceHash = 'c'.repeat(64);
    const integrity = finalizeRunIntegrity(value);
    const eligibleReport = integrity.complete ? analyzeCompleteness({ cases, observations }) : null;
    expect(eligibleReport).toBeNull();
    expect(integrity.failure).toBe('COMPLETENESS_SOURCE_DRIFT');
  });
});
