import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  sourceBinding as inheritedSourceBinding,
  verifyCommittedSource,
  sha256,
  requireCondition,
  MODEL,
  MAX_REQUEST_BYTES,
  MAX_OUTPUT_TOKENS,
  RATES,
} from '../conversation-acceptance/protocol';
import { Decimal } from '../../shared/money';
import { cases, clock, totalTurns } from './specification';
export {
  verifyCommittedSource,
  sha256,
  requireCondition,
  MODEL,
  MAX_REQUEST_BYTES,
  MAX_OUTPUT_TOKENS,
  RATES,
};
export function sourceBinding(root = process.cwd()) {
  const files = { ...inheritedSourceBinding(root).files };
  const visit = (relative: string) => {
    const full = join(root, relative),
      stat = lstatSync(full);
    requireCondition(!stat.isSymbolicLink(), 'SOURCE_SYMLINK');
    if (stat.isDirectory()) for (const name of readdirSync(full).sort()) visit(`${relative}/${name}`);
    else {
      requireCondition(stat.isFile(), 'SOURCE_FILE');
      files[relative] = sha256(readFileSync(full));
    }
  };
  for (const path of [
    'scripts/flexible-analytics-evaluation',
    'tests/flexible-analytics-evaluation.test.ts',
    '.github/workflows/flexible-analytics-evaluation.yml',
  ])
    visit(path);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { hash: sha256(JSON.stringify(sorted)), files: sorted };
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const approvalSchema = z.strictObject({
  version: z.literal('flexible-analytics-approval-v1'),
  authorization: z.literal('explicit_user_approval_recorded_by_operator'),
  cohort: z.string().regex(/^flexible-[a-z0-9-]{8,64}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceHash: hash,
  keySha256: hash,
  artifactKeySha256: hash,
  databaseName: z.literal('daybook_flexible_live'),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  model: z.literal(MODEL),
  route: z.literal('composable'),
  businessDate: z.literal(clock),
  maxRequests: z.literal(totalTurns),
  maxAttempts: z.literal(totalTurns * 2),
  maxRequestBytes: z.literal(MAX_REQUEST_BYTES),
  maxOutputTokens: z.literal(MAX_OUTPUT_TOKENS),
  ceilingUsd: z
    .string()
    .regex(/^0\.\d{1,6}$/)
    .refine((v) => new Decimal(v).gt(0) && new Decimal(v).lte('0.30')),
  inputUsdPerMillion: z.literal(RATES.input),
  outputUsdPerMillion: z.literal(RATES.outputIncludingThinking),
  reservationBasis: z.enum(['utf8_bytes_plus_2048', 'gemini_count_tokens_plus_2048']),
  caseIds: z
    .array(z.string())
    .refine(
      (v) => JSON.stringify(v) === JSON.stringify(cases.map((c) => c.id)),
      'All 22 cases in frozen order are required.',
    ),
});
export function validateApproval(
  raw: string,
  expectedHash: string,
  expectedSource: string,
  apiKey: string,
  now = Date.now(),
) {
  requireCondition(Buffer.byteLength(raw) <= 8192 && sha256(raw) === expectedHash, 'APPROVAL_HASH');
  const permit = approvalSchema.parse(JSON.parse(raw));
  requireCondition(permit.sourceHash === expectedSource, 'SOURCE_DRIFT');
  requireCondition(
    apiKey.length > 0 &&
      apiKey.length <= 4096 &&
      !/[\r\n\0]/.test(apiKey) &&
      sha256(apiKey) === permit.keySha256,
    'KEY_BINDING',
  );
  const from = Date.parse(permit.approvedAt),
    to = Date.parse(permit.expiresAt);
  requireCondition(from <= now && now < to && to - from <= 48 * 3600000, 'APPROVAL_TIME');
  return permit;
}
export function databaseTarget(ownerUrl: string, runtimeUrl: string, name: string) {
  const owner = new URL(ownerUrl),
    runtime = new URL(runtimeUrl);
  requireCondition(
    name === 'daybook_flexible_live' &&
      ['postgres:', 'postgresql:'].includes(owner.protocol) &&
      ['postgres:', 'postgresql:'].includes(runtime.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(owner.hostname) &&
      owner.hostname === runtime.hostname &&
      owner.port === runtime.port &&
      owner.pathname === `/${name}` &&
      runtime.pathname === owner.pathname &&
      !!owner.username &&
      !!runtime.username &&
      owner.username !== runtime.username &&
      !owner.search &&
      !runtime.search &&
      !owner.hash &&
      !runtime.hash,
    'DISPOSABLE_DATABASE_REQUIRED',
  );
}
export function preparation(root = process.cwd()) {
  return {
    status: 'NOT_APPROVED_NOT_EXECUTED',
    cases: cases.length,
    requests: totalTurns,
    maxAttempts: totalTurns * 2,
    proposedCeilingUsd: '0.30',
    model: MODEL,
    source: sourceBinding(root),
    businessDate: clock,
    caseIds: cases.map((c) => c.id),
    semanticReview: 'required',
    cohortType: 'development; independent authoring, developer-visible before execution',
    noSpend: true,
    existing31CaseSuite: 'separate unchanged protocol; separate approval and results',
  };
}
