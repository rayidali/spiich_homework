import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Decimal } from '../../shared/money';
import { clock } from '../../tests/conversation-acceptance/book';

export const MODEL = 'gemini-3.5-flash-lite';
export const MAX_REQUESTS = 35;
export const MAX_ATTEMPTS = 70;
export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_OUTPUT_TOKENS = 4000;
export const RATES = { input: '0.30', outputIncludingThinking: '2.50' } as const;
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`CONVERSATION_ACCEPTANCE_${code}`);
}
export function safeCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : '';
  return /^(?:CONVERSATION_ACCEPTANCE|COMPLETENESS_EVALUATION)_[A-Z_]+$/.test(candidate)
    ? candidate
    : 'CONVERSATION_ACCEPTANCE_EXECUTION_FAILED';
}

/** Includes current product code and new runner, not a historical study's freeze. */
export function sourceBinding(root = process.cwd()) {
  const files: Record<string, string> = {};
  function visit(relative: string) {
    const full = join(root, relative);
    const stat = lstatSync(full);
    requireCondition(!stat.isSymbolicLink(), 'SOURCE_SYMLINK');
    if (stat.isDirectory()) {
      for (const name of readdirSync(full).sort()) visit(`${relative}/${name}`);
    } else {
      requireCondition(stat.isFile(), 'SOURCE_FILE');
      files[relative] = sha256(readFileSync(full));
    }
  }
  for (const path of [
    'server',
    'shared',
    'db/migrations',
    'scripts/conversation-acceptance',
    'tests/conversation-acceptance',
    'tests/conversation-acceptance-runner.test.ts',
    'tests/conversation-acceptance-scoring.test.ts',
    'tests/conversation-acceptance-workflow.test.ts',
    '.github/workflows/conversation-acceptance.yml',
    'scripts/completion-repair-evaluation/transport.ts',
    'scripts/completion-repair-evaluation/encrypted-artifact.ts',
    'scripts/completion-repair-evaluation/protocol.ts',
    'scripts/completeness-evaluation/protocol.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
  ])
    visit(path);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { hash: sha256(JSON.stringify(sorted)), files: sorted };
}
export function verifyCommittedSource(
  root: string,
  commit: string,
  source: ReturnType<typeof sourceBinding>,
) {
  requireCondition(/^[a-f0-9]{40}$/.test(commit), 'COMMIT');
  for (const [path, expected] of Object.entries(source.files)) {
    let bytes: Buffer;
    try {
      bytes = execFileSync('git', ['show', `${commit}:${path}`], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      throw new Error('CONVERSATION_ACCEPTANCE_COMMITTED_SOURCE_MISSING');
    }
    requireCondition(sha256(bytes) === expected, 'COMMITTED_SOURCE_MISMATCH');
  }
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const approvalSchema = z.strictObject({
  version: z.literal('conversation-acceptance-approval-v1'),
  authorization: z.literal('explicit_user_approval_recorded_by_operator'),
  cohort: z.string().regex(/^conversation-[a-z0-9-]{8,64}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceHash: hash,
  keySha256: hash,
  artifactKeySha256: hash,
  databaseName: z.string().regex(/^daybook_conversation_[a-z0-9_]{1,32}$/),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  model: z.literal(MODEL),
  route: z.literal('composable'),
  businessDate: z.literal(clock),
  maxRequests: z.literal(MAX_REQUESTS),
  maxAttempts: z.literal(MAX_ATTEMPTS),
  maxRequestBytes: z.literal(MAX_REQUEST_BYTES),
  maxOutputTokens: z.literal(MAX_OUTPUT_TOKENS),
  ceilingUsd: z
    .string()
    .regex(/^0\.(?:0[1-9]\d*|1\d*|20*)$/)
    .refine((v) => new Decimal(v).gt(0) && new Decimal(v).lte('0.20')),
  inputUsdPerMillion: z.literal(RATES.input),
  outputUsdPerMillion: z.literal(RATES.outputIncludingThinking),
});
export type Approval = z.infer<typeof approvalSchema>;

export function validateApproval(
  raw: string,
  expectedHash: string,
  expectedSource: string,
  apiKey: string,
  now = Date.now(),
) {
  requireCondition(Buffer.byteLength(raw) <= 8192 && sha256(raw) === expectedHash, 'APPROVAL_HASH');
  const approval = approvalSchema.parse(JSON.parse(raw));
  requireCondition(approval.sourceHash === expectedSource, 'SOURCE_DRIFT');
  requireCondition(
    apiKey.length > 0 &&
      apiKey.length <= 4096 &&
      !/[\r\n\0]/.test(apiKey) &&
      sha256(apiKey) === approval.keySha256,
    'KEY_BINDING',
  );
  const from = Date.parse(approval.approvedAt),
    to = Date.parse(approval.expiresAt);
  requireCondition(from <= now && now < to && to - from <= 48 * 3600000, 'APPROVAL_TIME');
  return approval;
}

export function databaseTarget(ownerUrl: string, runtimeUrl: string, expectedName: string) {
  let owner: URL, runtime: URL;
  try {
    owner = new URL(ownerUrl);
    runtime = new URL(runtimeUrl);
  } catch {
    throw new Error('CONVERSATION_ACCEPTANCE_DATABASE_URL');
  }
  requireCondition(
    ['postgres:', 'postgresql:'].includes(owner.protocol) &&
      ['postgres:', 'postgresql:'].includes(runtime.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]', 'postgres'].includes(owner.hostname) &&
      owner.hostname === runtime.hostname &&
      owner.port === runtime.port &&
      owner.pathname === `/${expectedName}` &&
      runtime.pathname === owner.pathname &&
      /^daybook_conversation_[a-z0-9_]{1,32}$/.test(expectedName) &&
      owner.username !== runtime.username &&
      !!owner.username &&
      !!runtime.username &&
      !owner.search &&
      !runtime.search &&
      !owner.hash &&
      !runtime.hash,
    'DISPOSABLE_DATABASE_REQUIRED',
  );
  return { databaseName: expectedName };
}

export function reservationUsd(requestBytes: number) {
  requireCondition(
    Number.isSafeInteger(requestBytes) && requestBytes >= 0 && requestBytes <= MAX_REQUEST_BYTES,
    'REQUEST_BYTES',
  );
  return new Decimal(requestBytes + 2048)
    .times(RATES.input)
    .plus(new Decimal(MAX_OUTPUT_TOKENS).times(RATES.outputIncludingThinking))
    .div(1e6)
    .toFixed();
}

export function preparation(root = process.cwd()) {
  return {
    version: 'conversation-acceptance-preparation-v1',
    status: 'NOT_APPROVED_NOT_EXECUTED',
    source: sourceBinding(root),
    businessDate: clock,
    cases: 31,
    requests: MAX_REQUESTS,
    model: MODEL,
    route: 'composable',
    maxAttempts: MAX_ATTEMPTS,
    proposedCeilingUsd: '0.20',
    maxRequestBytes: MAX_REQUEST_BYTES,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    rates: RATES,
    maximumSingleAttemptReservationUsd: reservationUsd(MAX_REQUEST_BYTES),
    reservationBasis:
      'Actual UTF-8 request bytes plus2048 framing tokens, output cap4000 including thinking. Conservative accounting estimate, not invoice guarantee.',
    noSpend: true,
  };
}
