import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { sourceManifest } from '../../research/manifest';
import { reviewCases } from '../../research/reference';
import { atomicJson } from '../../research/io';
import {
  freezeVerifierCalibration,
  validateVerifierFreeze,
  type CalibrationArtifact,
} from '../../research/freeze';

const calibration = JSON.parse(
  readFileSync('.tools/research/verifier-config.json', 'utf8'),
) as CalibrationArtifact;
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(calibration.runId)) throw new Error('INVALID_CALIBRATION_RUN_ID');
const directory = `docs/evidence/research-verifiers/${calibration.runId}`;
if (existsSync(`${directory}/holdout.jsonl`)) throw new Error('CANNOT_REFREEZE_AFTER_HOLDOUT');
const developmentRecords = readFileSync(`${directory}/development.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const inputs = {
  calibration,
  sourceHash: sourceManifest().hash,
  referenceCases: reviewCases,
  developmentRecords,
};
const path = '.tools/research/verifier-freeze.json';
const binding = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : freezeVerifierCalibration(inputs, {
      boundAt: new Date().toISOString(),
      reason:
        'Bind preserved development calibration to the complete source and labeled reference hashes after pre-holdout pacing, deadline, provenance, reporting and portability amendments. No reviewer prompt or threshold was retuned on held-out outcomes.',
    });
validateVerifierFreeze(binding, inputs);
atomicJson(path, binding);
atomicJson(`${directory}/verifier-freeze.json`, binding);
console.log(
  JSON.stringify({ frozen: true, threshold: binding.threshold, sourceHash: binding.frozenSourceHash }),
);
