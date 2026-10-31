import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pool } from '../../server/db';
import { sourceFingerprint } from '../../scripts/chat-evaluation/controller';
import { hash } from '../../scripts/chat-evaluation/io';
import { replay } from '../../scripts/chat-evaluation/replay';
import type {
  EvaluationCase,
  Fixture,
  RecordedCall,
  RecordedOutcome,
} from '../../scripts/chat-evaluation/types';
import type { FinancialQuery } from '../../server/financial-analysis';
const fixture = JSON.parse(readFileSync('tests/chat-evaluation/fixtures/ledger.json', 'utf8')) as Fixture;
const cases = JSON.parse(readFileSync('tests/chat-evaluation/fixtures/development.json', 'utf8'))
  .cases as EvaluationCase[];
const plan = (overrides: Partial<FinancialQuery>): FinancialQuery => ({
  id: 'q',
  metric: 'net_expense',
  aggregation: 'sum',
  from: '2026-05-01',
  to: '2026-05-31',
  status: 'POSTED',
  groupBy: 'total',
  accountCodes: [],
  cooccurringAccountCodes: [],
  counterparty: { mode: 'any', value: '' },
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
  order: 'label_asc',
  limit: 50,
  currencyMode: 'base',
  currency: null,
  ...overrides,
});
const analysis = (p: FinancialQuery): RecordedCall => ({
  name: 'financial_analysis',
  args: { queries: [p] },
});
const calls: RecordedCall[] = [
  { name: 'expense_by_account', args: { accountCode: '5020', from: '2026-04-01', to: '2026-04-30' } },
  analysis(plan({ accountCodes: ['5020'], counterparty: { mode: 'exact', value: 'Nebula Apps' } })),
  analysis(plan({ from: '2026-04-01', to: '2026-06-30', accountCodes: ['5020'], groupBy: 'month' })),
  analysis(plan({ accountCodes: ['5020'], aggregation: 'average_per_entry' })),
  analysis(plan({ accountCodes: ['5041'] })),
  {
    name: 'request_details',
    args: { reason: 'missing_period', subject: 'expenses', accountCodes: ['5010'], limitation: 'none' },
  },
  {
    name: 'request_details',
    args: { reason: 'off_topic', subject: 'analysis', accountCodes: [], limitation: 'none' },
  },
  {
    name: 'request_details',
    args: { reason: 'unsupported_action', subject: 'analysis', accountCodes: [], limitation: 'none' },
  },
];
// Only CI's disposable service is permitted. This test never calls a model.
describe.skipIf(process.env.GITHUB_ACTIONS !== 'true')(
  'Recorded chat-plan replay in disposable PostgreSQL',
  () => {
    afterAll(async () => {
      await pool.end();
    });
    it('seeds exact generated amounts/reversals and verifies eight development plans without mutating the fixture', async () => {
      const source = sourceFingerprint().hash;
      const outcomes: RecordedOutcome[] = cases.map((c, i) => ({
        attemptId: `offline-${i}`,
        slot: `development/composable/${c.id}`,
        route: 'composable',
        phase: 'development',
        caseId: c.id,
        sourceHash: source,
        requestHash: hash(JSON.stringify(calls[i])),
        httpStatus: 200,
        curlExit: 0,
        networkSeconds: 0,
        elapsedMs: 0,
        responseHash: null,
        status: 'valid_plan',
        call: calls[i],
        usage: null,
      }));
      const result = await replay({
        version: 'daybook-chat-replay-v1',
        sourceHash: source,
        fixture,
        fixtureHash: hash(JSON.stringify(fixture)),
        cases,
        outcomes,
      });
      expect(result.unchanged).toBe(true);
      expect(result.before).toBe(result.after);
      expect(result.temporaryOrganizations).toBe(2);
      expect(
        result.results.map((r) => ({ id: r.score.caseId, result: r.score.outcome, reason: r.score.reason })),
      ).toEqual(
        cases.map((c) => ({
          id: c.id,
          result: 'pass',
          reason:
            c.expected.behavior === 'answer' ? 'EXACT_SCOPE_AND_DATABASE_FACTS' : 'STRUCTURED_BOUNDARY_MATCH',
        })),
      );
    }, 60000);
  },
);
