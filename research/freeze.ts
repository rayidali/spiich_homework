import { createHash } from 'node:crypto';
import type { ReviewCase } from './reference';
import {
  reviewInputHash,
  selectJevThreshold,
  VERIFIER_METHODS,
  visibleReviewInput,
  type ThresholdSelection,
  type VerifierRecord,
} from './validator-study';

export interface CalibrationArtifact extends ThresholdSelection {
  runId: string;
  frozenAt: string;
  /** Original development runner's narrow source hash, retained as provenance. */
  sourceHash: string;
  developmentInputHash: string;
  developmentResultsHash: string;
}
export interface VerifierFreezeBinding {
  version: 'daybook-verifier-freeze-v1';
  runId: string;
  boundAt: string;
  amendmentReason: string;
  developmentFrozenAt: string;
  legacySourceHash: string;
  frozenSourceHash: string;
  referenceCasesHash: string;
  calibrationHash: string;
  developmentInputHash: string;
  developmentResultsHash: string;
  threshold: number;
  feasible: boolean;
  developmentCases: number;
  holdoutCases: number;
}
export interface FreezeInputs {
  calibration: CalibrationArtifact;
  /** sourceManifest().hash after all runtime/protocol amendments, before holdout. */
  sourceHash: string;
  referenceCases: ReviewCase[];
  /** Original append-only development records, in their original order. */
  developmentRecords: VerifierRecord[];
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const stableHash = (value: unknown) => hash(canonical(value));
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const fail = () => {
  throw new Error('RESEARCH_VERIFIER_FREEZE_MISMATCH');
};

/** Pure provenance binding: no reads, writes, calls, or access to holdout outcomes.
 * Labels are hashed to detect later changes; only development labels tune a threshold.
 * Retains the historical calibration artifact rather than rewriting its source hash.
 */
export function freezeVerifierCalibration(
  inputs: FreezeInputs,
  amendment: { boundAt: string; reason: string },
): VerifierFreezeBinding {
  const { calibration, sourceHash, referenceCases, developmentRecords } = inputs;
  if (
    !validHash(sourceHash) ||
    !validHash(calibration.sourceHash) ||
    !/^[a-zA-Z0-9_-]{1,60}$/.test(calibration.runId) ||
    !Number.isFinite(Date.parse(amendment.boundAt)) ||
    !Number.isFinite(Date.parse(calibration.frozenAt)) ||
    Date.parse(amendment.boundAt) < Date.parse(calibration.frozenAt) ||
    amendment.reason.trim().length < 10 ||
    amendment.reason.length > 2000
  )
    fail();
  const development = referenceCases.filter((item) => item.split === 'development');
  const holdout = referenceCases.filter((item) => item.split === 'holdout');
  if (
    !development.length ||
    !holdout.length ||
    new Set(referenceCases.map((item) => item.id)).size !== referenceCases.length
  )
    fail();
  const groups = new Set(development.map((item) => item.sourceGroupId));
  if (holdout.some((item) => groups.has(item.sourceGroupId))) fail();
  const cases = new Map(development.map((item) => [item.id, item]));
  const recordKeys = new Set<string>();
  for (const record of developmentRecords) {
    const item = cases.get(record.caseId);
    if (
      !item ||
      record.split !== 'development' ||
      record.sourceGroupId !== item.sourceGroupId ||
      !VERIFIER_METHODS.includes(record.method) ||
      record.inputHash !== reviewInputHash(visibleReviewInput(item)) ||
      recordKeys.has(`${record.method}:${record.caseId}`)
    )
      fail();
    recordKeys.add(`${record.method}:${record.caseId}`);
  }
  if (developmentRecords.length !== development.length * VERIFIER_METHODS.length) fail();
  const developmentInputHash = hash(
    development.map((item) => ({ id: item.id, input: visibleReviewInput(item) })),
  );
  const developmentResultsHash = hash(developmentRecords);
  if (
    calibration.developmentInputHash !== developmentInputHash ||
    calibration.developmentResultsHash !== developmentResultsHash
  )
    fail();
  const selected = selectJevThreshold(developmentRecords, development);
  // Reproduce the published selection rule using only the preserved development set.
  const recordedSelection = Object.fromEntries(
    Object.keys(selected).map((key) => [key, calibration[key as keyof CalibrationArtifact]]),
  );
  if (stableHash(selected) !== stableHash(recordedSelection)) fail();
  return {
    version: 'daybook-verifier-freeze-v1',
    runId: calibration.runId,
    boundAt: amendment.boundAt,
    amendmentReason: amendment.reason,
    developmentFrozenAt: calibration.frozenAt,
    legacySourceHash: calibration.sourceHash,
    frozenSourceHash: sourceHash,
    referenceCasesHash: stableHash(referenceCases),
    calibrationHash: stableHash(calibration),
    developmentInputHash,
    developmentResultsHash,
    threshold: selected.threshold,
    feasible: selected.feasible,
    developmentCases: development.length,
    holdoutCases: holdout.length,
  };
}

/** Run before any holdout request. Missing/stale calibration must never become0.8. */
export function validateVerifierFreeze(
  binding: VerifierFreezeBinding | null | undefined,
  inputs: FreezeInputs,
): number {
  if (!binding) throw new Error('RESEARCH_HOLDOUT_REQUIRES_VERIFIER_FREEZE');
  const expected = freezeVerifierCalibration(inputs, {
    boundAt: binding.boundAt,
    reason: binding.amendmentReason,
  });
  if (stableHash(binding) !== stableHash(expected)) fail();
  return expected.threshold;
}
