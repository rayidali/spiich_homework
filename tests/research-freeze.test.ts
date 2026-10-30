import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  freezeVerifierCalibration,
  validateVerifierFreeze,
  type CalibrationArtifact,
  type FreezeInputs,
} from '../research/freeze';
import { reviewCases } from '../research/reference';
import { JEV_CHECKS, type JevReviewProbabilities } from '../research/providers';
import {
  deterministicReview,
  reviewInputHash,
  selectJevThreshold,
  visibleReviewInput,
  VERIFIER_METHODS,
  type VerifierRecord,
} from '../research/validator-study';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(): FreezeInputs {
  const cases = [
    ...reviewCases.filter((item) => item.split === 'development').slice(0, 2),
    ...reviewCases.filter((item) => item.split === 'holdout').slice(0, 2),
  ];
  const development = cases.filter((item) => item.split === 'development');
  const records: VerifierRecord[] = development.flatMap((item) =>
    VERIFIER_METHODS.map((method) => ({
      id: `calibration:development:${method}:${item.id}`,
      caseId: item.id,
      sourceGroupId: item.sourceGroupId,
      split: item.split,
      method,
      inputHash: reviewInputHash(visibleReviewInput(item)),
      threshold: method === 'jev' ? 0.8 : null,
      status: 'ok',
      decision: item.expected,
      reasons: [],
      evidenceIds: [],
      durationMs: 1,
      ...(method === 'deterministic' ? deterministicReview(visibleReviewInput(item)) : {}),
      ...(method === 'jev'
        ? {
            probabilities: Object.fromEntries(
              JEV_CHECKS.map((check) => [check, item.expected === 'PASS' ? 0.1 : 0.8]),
            ) as JevReviewProbabilities,
          }
        : {}),
    })),
  );
  const calibration: CalibrationArtifact = {
    ...selectJevThreshold(records, development),
    runId: 'calibration',
    frozenAt: '2026-10-30T20:00:00.000Z',
    sourceHash: 'a'.repeat(64),
    developmentInputHash: hash(development.map((item) => ({ id: item.id, input: visibleReviewInput(item) }))),
    developmentResultsHash: hash(records),
  };
  return { calibration, sourceHash: 'b'.repeat(64), referenceCases: cases, developmentRecords: records };
}
const amendment = {
  boundAt: '2026-10-30T20:01:00.000Z',
  reason:
    'Bind complete source and label provenance after adding request pacing; preserve original development outcomes.',
};

describe('pre-holdout verifier provenance freeze', () => {
  it('binds full source, labels, original calibration and outcomes while preserving the historical source hash', () => {
    const input = fixture();
    const binding = freezeVerifierCalibration(input, amendment);
    expect(binding).toMatchObject({
      legacySourceHash: 'a'.repeat(64),
      frozenSourceHash: 'b'.repeat(64),
      threshold: 0.8,
      developmentCases: 2,
      holdoutCases: 2,
    });
    expect(validateVerifierFreeze(binding, input)).toBe(0.8);
    expect(input.calibration.sourceHash).toBe('a'.repeat(64));
  });

  it('rejects missing bindings instead of supplying an uncalibrated default', () => {
    expect(() => validateVerifierFreeze(null, fixture())).toThrow(
      'RESEARCH_HOLDOUT_REQUIRES_VERIFIER_FREEZE',
    );
  });

  it('rejects changed runtime source, reference labels, or calibration thresholds', () => {
    const input = fixture(),
      binding = freezeVerifierCalibration(input, amendment);
    expect(() => validateVerifierFreeze(binding, { ...input, sourceHash: 'c'.repeat(64) })).toThrow(
      /MISMATCH/,
    );
    const relabeled = structuredClone(input);
    relabeled.referenceCases.find((item) => item.split === 'holdout')!.expected = 'BLOCK';
    expect(() => validateVerifierFreeze(binding, relabeled)).toThrow(/MISMATCH/);
    expect(() => validateVerifierFreeze({ ...binding, threshold: 0.99 }, input)).toThrow(/MISMATCH/);
    expect(() =>
      freezeVerifierCalibration(
        { ...input, calibration: { ...input.calibration, threshold: 0.99 } },
        amendment,
      ),
    ).toThrow(/MISMATCH/);
  });

  it('requires all original outcomes, rejects changed or injected records, and never receives holdout results', () => {
    const input = fixture();
    expect(() =>
      freezeVerifierCalibration(
        { ...input, developmentRecords: input.developmentRecords.slice(1) },
        amendment,
      ),
    ).toThrow(/MISMATCH/);
    const changed = structuredClone(input);
    changed.developmentRecords[0].decision = 'BLOCK';
    expect(() => freezeVerifierCalibration(changed, amendment)).toThrow(/MISMATCH/);
    const holdout = structuredClone(input);
    holdout.developmentRecords[0].split = 'holdout';
    expect(() => freezeVerifierCalibration(holdout, amendment)).toThrow(/MISMATCH/);
  });

  it('detects changed visible inputs and split leakage even before binding', () => {
    const changed = fixture();
    changed.referenceCases[0] = structuredClone(changed.referenceCases[0]);
    changed.referenceCases[0].candidate.summary = 'A changed candidate.';
    expect(() => freezeVerifierCalibration(changed, amendment)).toThrow(/MISMATCH/);
    const leaked = structuredClone(fixture());
    leaked.referenceCases[2].sourceGroupId = leaked.referenceCases[0].sourceGroupId;
    expect(() => freezeVerifierCalibration(leaked, amendment)).toThrow(/MISMATCH/);
  });

  it('records an explicit, chronologically valid amendment rather than rewriting past calibration', () => {
    const input = fixture();
    expect(() => freezeVerifierCalibration(input, { ...amendment, boundAt: '2026-10-29T20:00:00Z' })).toThrow(
      /MISMATCH/,
    );
    expect(() => freezeVerifierCalibration(input, { ...amendment, reason: '' })).toThrow(/MISMATCH/);
  });
});
