import { Decimal } from '../../shared/money';
import { totals, type ChatLedger } from './budget';
import type { RecordedOutcome } from './types';
import type { replay } from './replay';
export type ReplayResult = Awaited<ReturnType<typeof replay>>;
/** Raw needs_review outcomes remain unresolved; a separate signed rubric record must never overwrite them. */
export function comparisonReport(
  ledger: ChatLedger,
  executed: ReplayResult,
  phase: 'development' | 'holdout',
) {
  const rows = executed.results.filter((r) => r.slot.startsWith(phase + '/'));
  const planned = phase === 'holdout' ? 20 : 8;
  const routes = (['authored', 'composable'] as const).map((route) => {
    const attempts = ledger.records.filter((r) => r.slot.startsWith(`${phase}/${route}/`));
    const selected = rows.filter((r) => r.route === route),
      common = selected.filter((r) => r.score.commonCapability),
      answerable = selected.filter((r) => r.score.answerable);
    const known = attempts
      .filter((r) => r.state === 'known')
      .reduce((s, r) => s.plus(r.chargedUsd), new Decimal(0));
    const unknown = attempts
      .filter((r) => r.state !== 'known')
      .reduce((s, r) => s.plus(r.chargedUsd), new Decimal(0));
    const latencies = attempts
      .map((r) => (r.outcome as RecordedOutcome | null)?.networkSeconds)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    return {
      route,
      planned,
      consumed: attempts.length,
      executed: selected.length,
      passed: selected.filter((r) => r.score.outcome === 'pass').length,
      failed: selected.filter((r) => r.score.outcome === 'fail').length,
      needsReview: selected.filter((r) => r.score.outcome === 'needs_review').length,
      missing: planned - selected.length,
      common: { passed: common.filter((r) => r.score.outcome === 'pass').length, observed: common.length },
      answerable: {
        passed: answerable.filter((r) => r.score.outcome === 'pass').length,
        observed: answerable.length,
        planned: executed.caseMetadata.filter((c) => c.split === phase && c.answerable).length,
      },
      knownUsd: known.toFixed(12),
      unknownReservedUsd: unknown.toFixed(12),
      chargedUsd: known.plus(unknown).toFixed(12),
      networkMedianSeconds: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    };
  });
  const paired = rows
    .filter((r) => r.route === 'authored')
    .map((a) => {
      const b = rows.find((b) => b.route === 'composable' && b.score.caseId === a.score.caseId);
      return b
        ? {
            caseId: a.score.caseId,
            commonCapability: a.score.commonCapability,
            authored: a.score.outcome,
            composable: b.score.outcome,
          }
        : null;
    })
    .filter(Boolean);
  return {
    version: 'daybook-chat-comparison-report-v1',
    phase,
    sourceHash: executed.sourceHash,
    complete: routes.every((r) => r.executed === planned && r.consumed === planned),
    adjudicationComplete: routes.every((r) => r.needsReview === 0),
    fixtureUnchanged: executed.unchanged,
    routes,
    paired,
    cumulative: totals(ledger),
    limitations: [
      'Synthetic small sample; no production accuracy guarantee.',
      'Routes differ in available tools, instructions and chart metadata; this is a package comparison, not a causal ablation.',
      'Network and replay execution timing are separate; CI queue delay is not interactive latency.',
      'Reported-use costs and conservative unknown reservations are estimates, not invoices.',
      'Unresolved rubric reviews are not counted as passes.',
      'Only the trusted operator can enforce one actual curl execution per claimed config; the controller prevents a second claim, not arbitrary manual replay.',
    ],
  };
}
