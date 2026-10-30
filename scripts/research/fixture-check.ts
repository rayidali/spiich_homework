import 'dotenv/config';
import { mkdirSync, readFileSync } from 'node:fs';
import { ResearchDatabase } from '../../research/database';
import { atomicJson, httpTransport } from '../../research/io';
import { checkStoredFixture } from '../../research/fixture-check';

const state = JSON.parse(readFileSync('.tools/research/database-private.json', 'utf8')) as {
  readerUrl?: unknown;
};
if (typeof state.readerUrl !== 'string') throw new Error('RESEARCH_READER_NOT_CONFIGURED');
const report = await checkStoredFixture(new ResearchDatabase(state.readerUrl, httpTransport()));
mkdirSync('docs/evidence', { recursive: true });
atomicJson('docs/evidence/research-fixture-check.json', report);
console.log(
  JSON.stringify({
    passed: report.passed,
    contentMatches: report.contentMatches,
    embeddingsComplete: report.embeddingsComplete,
    expected: report.expected,
    observed: report.observed,
    failures: report.failures,
    snapshotSha256: report.snapshotSha256,
  }),
);
if (!report.passed) process.exitCode = 1;
