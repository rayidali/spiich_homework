import 'dotenv/config';
import { readFileSync, mkdirSync } from 'node:fs';
import { ResearchDatabase } from '../../research/database';
import { atomicJson, httpTransport } from '../../research/io';
import { runSecuritySuite } from '../../research/security';

const privateState: unknown = JSON.parse(readFileSync('.tools/research/database-private.json', 'utf8'));
const readerUrl = (privateState as { readerUrl?: unknown }).readerUrl;
if (typeof readerUrl !== 'string') throw new Error('RESEARCH_READER_NOT_CONFIGURED');
const database = new ResearchDatabase(readerUrl, httpTransport());
const report = await runSecuritySuite(database);
mkdirSync('docs/evidence', { recursive: true });
atomicJson('docs/evidence/research-security.json', report);
console.log(
  JSON.stringify({
    protocol: report.protocol,
    counts: report.counts,
    hardGateFailures: report.hardGateFailures,
    before: report.before,
    after: report.after,
    livePromptBehaviorAssessed: false,
  }),
);
if (report.hardGateFailures || report.controls.some((control) => control.status !== 'PASS'))
  process.exitCode = 1;
