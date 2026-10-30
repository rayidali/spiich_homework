import { readFileSync } from 'node:fs';
import { reviewCases } from './reference';
import { validateVerifierFreeze, type CalibrationArtifact } from './freeze';

/** Load the public development evidence and private pointer; no keys or provider input. */
export function requireFrozenVerifier(calibration: CalibrationArtifact, sourceHash: string): number {
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(calibration.runId)) throw new Error('INVALID_CALIBRATION_RUN_ID');
  const developmentRecords = readFileSync(
    `docs/evidence/research-verifiers/${calibration.runId}/development.jsonl`,
    'utf8',
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const binding = JSON.parse(readFileSync('.tools/research/verifier-freeze.json', 'utf8'));
  return validateVerifierFreeze(binding, {
    calibration,
    sourceHash,
    referenceCases: reviewCases,
    developmentRecords,
  });
}
