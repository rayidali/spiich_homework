import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { StudyBudget } from '../../research/budget';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { GeminiStartPacer } from '../../research/pacing';
import {
  createQuotaRecoveryPermit,
  quotaProbeRequest,
  type QuotaRecoveryPermit,
} from '../../research/recovery';

// No default execution mode: preparing a permit never contacts the provider.
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!['prepare', 'execute'].includes(mode) || args.length % 2 !== 0)
    throw new Error('RESEARCH_RECOVERY_ARGUMENTS');
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--authorization', '--quota-evidence', '--permit', '--receipt'].includes(args[i]) ||
      options.has(args[i])
    )
      throw new Error('RESEARCH_RECOVERY_ARGUMENTS');
    options.set(args[i], args[i + 1]);
  }
  for (const key of ['--authorization', '--quota-evidence', '--permit'])
    if (!options.get(key)) throw new Error('RESEARCH_RECOVERY_ARGUMENTS');
  const privateRoot = `${resolve('.tools/research')}/`;
  const permitPath = resolve(options.get('--permit')!);
  const authorizationPath = resolve(options.get('--authorization')!);
  if (![permitPath, authorizationPath].every((path) => path.startsWith(privateRoot)))
    throw new Error('RESEARCH_RECOVERY_PRIVATE_ARTIFACT_REQUIRED');
  if (existsSync('.tools/research/runner.lock') || existsSync('.tools/research/usage.json.lock'))
    throw new Error('RESEARCH_RECOVERY_RUNNER_ACTIVE');
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const budget = new StudyBudget('.tools/research/usage.json');
  const request = quotaProbeRequest(process.env.GEMINI_API_KEY ?? '');
  const quotaEvidence = read(options.get('--quota-evidence')!);
  const authorization = read(authorizationPath);
  if (mode === 'prepare') {
    if (options.has('--receipt') || existsSync(permitPath)) throw new Error('RESEARCH_RECOVERY_ARGUMENTS');
    const permit = createQuotaRecoveryPermit({
      records: budget.records,
      request,
      quotaEvidence,
      authorization,
      limits: budget.limits,
    });
    mkdirSync(dirname(permitPath), { recursive: true, mode: 0o700 });
    atomicJson(permitPath, permit);
    console.log(
      JSON.stringify({
        prepared: true,
        providerCalls: 0,
        notBefore: permit.authorization.notBefore,
        expiresAt: permit.authorization.expiresAt,
      }),
    );
    return;
  }
  const receiptPath = options.get('--receipt');
  if (!receiptPath || existsSync(receiptPath)) throw new Error('RESEARCH_RECOVERY_RECEIPT_REQUIRED');
  const permit = read(permitPath) as QuotaRecoveryPermit;
  const pacer = new GeminiStartPacer();
  const receipt = await budget.recoverQuota({
    permit,
    request,
    quotaEvidence,
    authorization,
    transport: pacer.wrap(providerTransport(httpTransport())),
  });
  mkdirSync(dirname(receiptPath), { recursive: true });
  atomicJson(receiptPath, receipt);
  console.log(JSON.stringify({ outcome: receipt.outcome, status: receipt.status, resumedStudy: false }));
  if (receipt.outcome !== 'RECOVERED') process.exitCode = 1;
}
main().catch((error: unknown) => {
  const message =
    error instanceof Error && /^RESEARCH_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'RESEARCH_RECOVERY_FAILED';
  console.error(JSON.stringify({ error: message, resumedStudy: false }));
  process.exitCode = 1;
});
