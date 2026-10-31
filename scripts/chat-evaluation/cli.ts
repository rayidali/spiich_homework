import 'dotenv/config';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  claim,
  complete,
  freezeHoldout,
  initializeRun,
  openRun,
  prepare,
  safeRunPath,
  sourceFingerprint,
} from './controller';
import { totals } from './budget';
import { exclusiveJson, hash, readJson } from './io';
import { replay, type ReplayBundle } from './replay';
import type { ChatRoute, EvaluationCase, Phase, RecordedOutcome } from './types';
const args = process.argv.slice(2),
  [command, runId, ...rest] = args;
async function main() {
  if (command === '--help' || !command) {
    console.log(
      JSON.stringify({
        commands: [
          'init RUN_ID FIXTURE_DIR',
          'prepare RUN_ID setup|development|holdout authored|composable CASE_ID',
          'claim RUN_ID ATTEMPT_ID',
          'complete RUN_ID ATTEMPT_ID FOOTER_FILE CURL_EXIT',
          'status RUN_ID',
          'freeze RUN_ID',
          'export RUN_ID development|holdout',
          'close RUN_ID',
          'replay BUNDLE_FILE OUTPUT_FILE',
        ],
        network:
          'None. Execute the returned ordinary curl command separately, exactly once, then complete with its full footer and exit code.',
      }),
    );
    return;
  }
  if (command === 'replay') {
    if (!runId || !rest[0]) throw Error('CHAT_CLI_ARGUMENTS');
    const result = await replay(readJson<ReplayBundle>(runId));
    exclusiveJson(rest[0], result);
    console.log(
      JSON.stringify({ results: result.results.length, unchanged: result.unchanged, output: rest[0] }),
    );
    return;
  }
  if (!runId || !/^[a-z][a-z0-9-]{1,70}$/.test(runId)) throw Error('CHAT_RUN_ID');
  const base = resolve('.tools/chat-query-evaluation/runs'),
    path = safeRunPath(join(base, runId));
  if (command === 'init') {
    if (!rest[0]) throw Error('CHAT_CLI_ARGUMENTS');
    mkdirSync(base, { recursive: true, mode: 0o700 });
    initializeRun(base, runId, rest[0], process.env.GEMINI_API_KEY?.trim() ?? '');
    console.log(JSON.stringify({ runId, state: 'initialized', providerCalls: 0 }));
    return;
  }
  if (command === 'prepare') {
    if (rest.length !== 3) throw Error('CHAT_CLI_ARGUMENTS');
    console.log(JSON.stringify(prepare(path, rest[0] as Phase, rest[1] as ChatRoute, rest[2])));
    return;
  }
  if (command === 'claim') {
    if (rest.length !== 1) throw Error('CHAT_CLI_ARGUMENTS');
    console.log(JSON.stringify(claim(path, rest[0], process.env.GEMINI_API_KEY?.trim() ?? '')));
    return;
  }
  if (command === 'complete') {
    if (rest.length !== 3) throw Error('CHAT_CLI_ARGUMENTS');
    const footerPath = resolve(rest[1]);
    if (!footerPath.startsWith(join(path, 'attempts', rest[0]) + '/')) throw Error('CHAT_FOOTER_PATH');
    const bytes = readFileSync(footerPath);
    if (bytes.length > 256) throw Error('CHAT_COMPLETION_INVALID');
    const r = complete(path, rest[0], bytes.toString(), Number(rest[2]));
    console.log(
      JSON.stringify({
        id: rest[0],
        status: r.outcome.status,
        httpStatus: r.outcome.httpStatus,
        errorCode: r.outcome.errorCode,
        totals: r.totals,
        haltReason: r.haltReason,
      }),
    );
    return;
  }
  const { budget, manifest, fixture } = openRun(path);
  if (command === 'status') {
    const l = budget.read();
    console.log(
      JSON.stringify({
        runId,
        state: l.state,
        haltReason: l.haltReason,
        holdoutSource: l.holdoutSource,
        totals: totals(l),
        pending: l.records
          .filter((r) => r.state === 'pending')
          .map((r) => ({ id: r.id, slot: r.slot, claimed: !!r.claimedAt })),
        phases: Object.fromEntries(
          ['setup', 'development', 'holdout'].map((p) => [
            p,
            l.records.filter((r) => r.slot.startsWith(p + '/')).length,
          ]),
        ),
      }),
    );
    return;
  }
  if (command === 'freeze') {
    console.log(JSON.stringify({ holdoutSource: freezeHoldout(path) }));
    return;
  }
  if (command === 'close') {
    budget.close();
    console.log(JSON.stringify({ runId, state: 'closed', totals: totals(budget.read()) }));
    return;
  }
  if (command === 'export') {
    const phase = rest[0];
    if (phase !== 'development' && phase !== 'holdout') throw Error('CHAT_PHASE');
    const ledger = budget.read(),
      source = sourceFingerprint();
    const records = ledger.records.filter((r) => r.slot.startsWith(phase + '/'));
    if (records.some((r) => r.state === 'pending') || !records.length) throw Error('CHAT_EXPORT_INCOMPLETE');
    if (phase === 'holdout' && (records.length !== 40 || ledger.holdoutSource !== source.hash))
      throw Error('CHAT_HOLDOUT_EXPORT_NOT_COMPLETE');
    const selected = records.filter((r) => r.sourceHash === source.hash);
    if (!selected.length) throw Error('CHAT_EXPORT_SOURCE_MISMATCH');
    const cases = readJson<{ cases: EvaluationCase[] }>(join(manifest.fixtureDir, phase, 'cases.json')).cases;
    const bundle: ReplayBundle = {
      version: 'daybook-chat-replay-v1',
      sourceHash: source.hash,
      fixture,
      fixtureHash: hash(JSON.stringify(fixture)),
      cases,
      outcomes: selected.map((r) => r.outcome as RecordedOutcome),
    };
    const output = join(path, `${phase}-replay-${source.hash.slice(0, 12)}.json`);
    exclusiveJson(output, bundle);
    console.log(
      JSON.stringify({
        output,
        outcomes: selected.length,
        retainedOtherRevisionRecords: records.length - selected.length,
        sourceHash: source.hash,
        providerCalls: 0,
      }),
    );
    return;
  }
  throw Error('CHAT_CLI_COMMAND');
}
main().catch((error) => {
  const code =
    error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'CHAT_CONTROLLER_FAILED';
  console.error(JSON.stringify({ error: code, providerCallsByCli: 0 }));
  process.exitCode = 1;
});
