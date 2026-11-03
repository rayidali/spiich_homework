import { describe, expect, it, vi } from 'vitest';
import {
  cases,
  totalTurns,
  oracle,
  type ExpectedRow,
} from '../scripts/flexible-analytics-evaluation/specification';
import { entries, entryLines } from '../scripts/flexible-analytics-evaluation/fixture';
import { assess, replaySource } from '../scripts/flexible-analytics-evaluation/scoring';
import {
  approvalSchema,
  validateApproval,
  databaseTarget,
  sha256,
  MODEL,
  MAX_REQUEST_BYTES,
  MAX_OUTPUT_TOKENS,
  RATES,
} from '../scripts/flexible-analytics-evaluation/protocol';
import { workflowBinding, history } from '../scripts/flexible-analytics-evaluation/workflow';
import { runConversations } from '../scripts/conversation-acceptance/runner';
import type { AnalysisFacts, FinancialQuery } from '../server/financial-analysis';
import type { EvaluationTransportSummary } from '../scripts/completion-repair-evaluation/transport';
const org = 'independent-fixture';
function fact(id: string, accountCodes: string[] = [], monthly = false): AnalysisFacts {
  const plan: FinancialQuery = {
    id,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2025-01-01',
    to: '2025-12-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: monthly ? 'month' : 'total',
    accountCodes,
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
  };
  const rows = monthly
    ? oracle.monthly2025.map((r, i) => ({
        rowId: `month:${r.month}`,
        label: r.month,
        value: String(accountCodes.length ? r.rent : r.expenses),
        entryCount: '1',
        from: `${r.month}-01`,
        to: `${r.month}-${new Date(Date.UTC(2025, i + 1, 0)).getUTCDate()}`,
      }))
    : [
        {
          rowId: 'total',
          label: id,
          value: accountCodes.length ? '1200' : '2050',
          entryCount: '1',
          from: plan.from,
          to: plan.to,
        },
      ];
  return {
    queryId: id,
    metric: plan.metric,
    aggregation: 'sum',
    grain: plan.groupBy,
    unit: 'USD',
    currency: null,
    truncated: false,
    rows,
    scope: {
      organizationId: org,
      plan,
      resolvedAccountIds: [],
      cooccurringAccountIds: [],
      amountBasis: 'stored base amounts',
      statusMeaning: 'posted',
    },
  };
}
function response(expected: ExpectedRow[], facts = [fact('rent', ['5010']), fact('expenses')]) {
  const code = 'return sourceCheckedAnalysis();',
    codeHash = sha256(code);
  const rows = expected.map((e, i) => ({
    label: e.label,
    value:
      e.value === null
        ? 'Not available — denominator is zero'
        : e.unit === 'ratio'
          ? `${e.value}%`
          : e.unit === 'USD'
            ? `$${e.value}`
            : e.value,
    exact:
      e.value === null
        ? null
        : e.numerator !== undefined
          ? { numerator: e.numerator, denominator: e.denominator! }
          : { numerator: String(Math.round(Number(e.value) * 100)), denominator: '100' },
    unit: e.unit,
    source: 'posted',
    references: facts.map((f) => ({ queryId: f.queryId, rowId: f.rows[i]?.rowId ?? f.rows[0].rowId })),
    ...(e.value === null ? { reason: 'zero_denominator' } : {}),
  }));
  return {
    answer: 'Calculated results.',
    facts,
    program: {
      code,
      codeHash,
      tables: [{ title: 'Required results', rows }],
      operationCount: rows.length,
      interpretationVerified: false,
    },
    evidence: [
      {
        title: 'Required results',
        period: '2025-01-01 → 2025-12-31',
        source: 'posted',
        rows: rows.map((r, rowIndex) => ({
          label: r.label,
          value: r.value,
          factRef: { kind: 'program_result', programHash: codeHash, tableIndex: 0, rowIndex },
        })),
        href: '/reports',
      },
      ...facts.map((f) => ({
        title: f.queryId,
        period: '2025',
        source: 'posted',
        rows: f.rows.map((r) => ({
          label: r.label,
          value: `$${r.value}`,
          factRef: { kind: 'query_row', queryId: f.queryId, rowId: r.rowId },
        })),
        href: '/reports',
      })),
    ],
  };
}
const permit = () => ({
  version: 'flexible-analytics-approval-v1',
  authorization: 'explicit_user_approval_recorded_by_operator',
  cohort: 'flexible-offline-fixture',
  sourceCommit: 'a'.repeat(40),
  sourceHash: 'b'.repeat(64),
  keySha256: sha256('offline-test-key'),
  artifactKeySha256: 'c'.repeat(64),
  databaseName: 'daybook_flexible_live',
  approvedAt: '2026-11-03T10:00:00Z',
  expiresAt: '2026-11-04T10:00:00Z',
  model: MODEL,
  route: 'composable',
  businessDate: '2026-11-03',
  maxRequests: 26,
  maxAttempts: 52,
  maxRequestBytes: MAX_REQUEST_BYTES,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  ceilingUsd: '0.30',
  inputUsdPerMillion: RATES.input,
  outputUsdPerMillion: RATES.outputIncludingThinking,
  reservationBasis: 'gemini_count_tokens_plus_2048',
  caseIds: cases.map((c) => c.id),
});
describe('Independent flexible analysis acceptance preparation', () => {
  it('preserves all 22 authored cases and 26 turns without narrowing hard cases', () => {
    expect(cases).toHaveLength(22);
    expect(totalTurns).toBe(26);
    expect(cases.filter((c) => c.turns.length > 1).map((c) => c.id)).toEqual(['F01', 'F16', 'F17']);
    expect(cases[3].oracleRows[0].map((r) => r.value)).toEqual(['49.81', '9']);
    expect(cases[20].oracleRows[0]).toHaveLength(4);
  });
  it('materializes balanced independent postings and keeps sentinels separate', () => {
    for (const e of entries) {
      const lines = entryLines(e);
      expect(
        lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100), 0),
      ).toBe(0);
    }
    const primary = entries.filter(
      (e) =>
        e.workspace === 'primary' &&
        e.status === 'POSTED' &&
        e.date >= '2025-01-01' &&
        e.date <= '2025-12-31',
    );
    expect(primary.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amountCents, 0)).toBe(205000);
    expect(primary.filter((e) => e.kind === 'revenue').reduce((s, e) => s + e.amountCents, 0)).toBe(600000);
    expect(entries.some((e) => e.status === 'DRAFT' && e.amountCents === 999900)).toBe(true);
    expect(entries.some((e) => e.workspace === 'other' && e.amountCents === 888800)).toBe(true);
  });
  it('independently verifies annual ratio, displayed precision, source amounts, and leaves meaning pending', () => {
    const result = assess(cases[2], 0, response(cases[2].oracleRows[0]), org);
    expect(result).toMatchObject({
      numericStatus: 'verified',
      sourceChecks: 2,
      matchedOutputs: 1,
      semanticReview: 'pending',
      overallPass: false,
    });
  });
  it('verifies all twelve monthly ratios and their source periods including three undefined rows', () => {
    const result = assess(
      cases[1],
      0,
      response(cases[1].oracleRows[0], [fact('rent', ['5010'], true), fact('expenses', [], true)]),
      org,
    );
    expect(result).toMatchObject({ numericStatus: 'verified', sourceChecks: 24, matchedOutputs: 12 });
  });
  it('rejects a wrong denominator even if the source operands are individually correct', () => {
    const r = response(cases[2].oracleRows[0]);
    r.program.tables[0].rows[0].exact = { numerator: '1', denominator: '5' };
    r.program.tables[0].rows[0].value = '20.00%';
    r.evidence[0].rows[0].value = '20.00%';
    expect(assess(cases[2], 0, r, org).numericStatus).toBe('failed');
  });
  it('rejects omitted months', () => {
    const r = response(cases[1].oracleRows[0].slice(1), [
      fact('rent', ['5010'], true),
      fact('expenses', [], true),
    ]);
    expect(assess(cases[1], 0, r, org).numericStatus).toBe('failed');
  });
  it('rejects zero percent substituted for zero denominator', () => {
    const r = response(cases[1].oracleRows[0], [fact('rent', ['5010'], true), fact('expenses', [], true)]);
    r.program.tables[0].rows[0].exact = { numerator: '0', denominator: '1' };
    r.program.tables[0].rows[0].value = '0.00%';
    r.evidence[0].rows[0].value = '0.00%';
    expect(assess(cases[1], 0, r, org).numericStatus).toBe('failed');
  });
  it('rejects correct amounts from wrong period, status, organization, or counterparty', () => {
    for (const mutate of [
      (r: ReturnType<typeof response>) => {
        r.facts[0].scope.plan.from = '2024-01-01';
      },
      (r: ReturnType<typeof response>) => {
        r.facts[0].scope.plan.status = 'DRAFT';
      },
      (r: ReturnType<typeof response>) => {
        r.facts[0].scope.organizationId = 'other';
      },
      (r: ReturnType<typeof response>) => {
        r.facts[0].scope.plan.counterparty = { mode: 'exact', value: 'Alpha' };
      },
    ]) {
      const r = response(cases[2].oracleRows[0]);
      mutate(r);
      expect(assess(cases[2], 0, r, org).numericStatus).toBe('failed');
    }
  });
  it('does not accept operand tables as the requested ratio', () => {
    const r = response(cases[2].oracleRows[0]);
    r.evidence.shift();
    expect(assess(cases[2], 0, r, org).numericStatus).toBe('failed');
  });
  it('rejects source drift and UI values that do not bind to program metadata', () => {
    const r = response(cases[2].oracleRows[0]);
    r.facts[0].rows[0].value = '1201';
    r.evidence[0].rows[0].value = '99.00%';
    const a = assess(cases[2], 0, r, org);
    expect(a).toMatchObject({ numericStatus: 'failed' });
    expect(a.failures).toContain('VISIBLE_PROGRAM_BINDING_MISMATCH');
  });
  it('replays signed refunds independently and returns no approval for unsupported source types', () => {
    const f = fact('expenses', [], true);
    expect(replaySource(f, f.rows[5])).toBe('-100.00');
    f.scope.plan.metric = 'account_balance';
    expect(replaySource(f, f.rows[5])).toBeNull();
  });
  it('keeps definite failures visible when some source evidence still needs independent review', () => {
    const r = response(cases[2].oracleRows[0]);
    r.facts[0].scope.plan.metric = 'account_balance';
    expect(assess(cases[2], 0, r, org)).toMatchObject({
      numericStatus: 'needs_review',
      failures: [],
      unassessed: ['SOURCE_PLAN_REQUIRES_REVIEW'],
      semanticReview: 'pending',
      overallPass: false,
    });
    r.evidence[0].rows[0].value = '99.00%';
    const result = assess(cases[2], 0, r, org);
    expect(result).toMatchObject({
      numericStatus: 'failed',
      unassessed: ['SOURCE_PLAN_REQUIRES_REVIEW'],
      semanticReview: 'pending',
      overallPass: false,
    });
    expect(result.failures).toContain('VISIBLE_PROGRAM_BINDING_MISMATCH');
  });
  it('keeps ambiguous clarification meaning pending and never grades prose by regex as a pass', () => {
    expect(assess(cases[0], 0, { answer: 'Which year and percentage denominator?' }, org)).toMatchObject({
      numericStatus: 'not_applicable',
      semanticReview: 'pending',
      overallPass: false,
    });
  });
  it('requires exact all-case permit, key, source, bounded time and 30-cent ceiling', () => {
    const p = permit(),
      raw = JSON.stringify(p);
    expect(
      validateApproval(raw, sha256(raw), p.sourceHash, 'offline-test-key', Date.parse('2026-11-03T11:00:00Z'))
        .maxRequests,
    ).toBe(26);
    for (const changes of [
      { ceilingUsd: '0.31' },
      { caseIds: p.caseIds.slice(1) },
      { maxAttempts: 53 },
      { maxRequests: 25 },
    ])
      expect(approvalSchema.safeParse({ ...p, ...changes }).success).toBe(false);
    expect(() =>
      validateApproval(raw, sha256(raw), p.sourceHash, 'different-key', Date.parse('2026-11-03T11:00:00Z')),
    ).toThrow();
    expect(() =>
      validateApproval(
        raw,
        sha256(raw),
        'f'.repeat(64),
        'offline-test-key',
        Date.parse('2026-11-03T11:00:00Z'),
      ),
    ).toThrow();
    expect(() =>
      validateApproval(
        raw,
        sha256(raw),
        p.sourceHash,
        'offline-test-key',
        Date.parse('2026-11-05T11:00:00Z'),
      ),
    ).toThrow();
  });
  it('allows only dedicated loopback database and distinct runtime identity', () => {
    expect(() =>
      databaseTarget(
        'postgres://owner:p@127.0.0.1:5432/daybook_flexible_live',
        'postgres://runtime:p@127.0.0.1:5432/daybook_flexible_live',
        'daybook_flexible_live',
      ),
    ).not.toThrow();
    for (const host of ['production.example.com', 'db', 'postgres'])
      expect(() =>
        databaseTarget(
          `postgres://owner:p@${host}/daybook_flexible_live`,
          `postgres://runtime:p@${host}/daybook_flexible_live`,
          'daybook_flexible_live',
        ),
      ).toThrow();
    expect(() =>
      databaseTarget(
        'postgres://owner:p@localhost/daybook_flexible_live',
        'postgres://owner:p@localhost/daybook_flexible_live',
        'daybook_flexible_live',
      ),
    ).toThrow();
  });
  it('refuses non-CI execution and reruns before provider access', () => {
    expect(() => workflowBinding({})).toThrow();
    const env = {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: 'rayidali/spiich_homework',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW_REF:
        'rayidali/spiich_homework/.github/workflows/flexible-analytics-evaluation.yml@refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: '123',
      FLEXIBLE_SOURCE_COMMIT: 'a'.repeat(40),
      GITHUB_SHA: 'a'.repeat(40),
      FLEXIBLE_SOURCE_HASH: 'b'.repeat(64),
      FLEXIBLE_APPROVAL_SHA256: 'c'.repeat(64),
      FLEXIBLE_COHORT: 'flexible-offline-fixture',
    };
    expect(workflowBinding(env).runName).toBe('flexible-analytics/flexible-offline-fixture');
    expect(() => workflowBinding({ ...env, GITHUB_RUN_ATTEMPT: '2' })).toThrow();
  });
  it('requires complete matching workflow history; uses only fake fetch offline', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ total_count: 0, workflow_runs: [] })),
    ) as unknown as typeof globalThis.fetch;
    expect(await history(fetch, 'offline-token')).toEqual([]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('flexible-analytics-evaluation.yml');
    const truncated = async () => new Response(JSON.stringify({ total_count: 1, workflow_runs: [] }));
    await expect(history(truncated, 'offline-token')).rejects.toThrow('HISTORY_TRUNCATED');
  });
  it('uses actual assistant clarification and follow-up replies, retains each attempt and fingerprint check', async () => {
    const sent: unknown[] = [],
      written: unknown[] = [];
    const summary: EvaluationTransportSummary = {
      state: 'open',
      attempts: 0,
      knownUsd: '0',
      unknownReservedUsd: '0',
      chargedUsd: '0',
      haltReason: null,
      pending: 0,
      activeTrial: null,
    };
    const afterTurn = vi.fn();
    let turn = 0;
    const result = await runConversations({
      selectedCases: [cases[0]],
      transport: { beginTrial: () => {}, endTrial: () => {}, summary: () => summary },
      chat: async (messages) => {
        sent.push(messages);
        return {
          answer: [
            'Which year and denominator?',
            'Which denominator do you mean?',
            'Calculated actual result.',
          ][turn++],
        };
      },
      assess: () => ({ semanticReview: 'pending' }),
      beforeTurn: () => {},
      afterTurn,
      write: (o) => written.push(o),
    });
    expect(result).toMatchObject({ requests: 3, executionComplete: true, modelAccuracyEstablished: false });
    expect(sent[2]).toEqual([
      { role: 'user', content: cases[0].turns[0].user },
      { role: 'assistant', content: 'Which year and denominator?' },
      { role: 'user', content: 'this year' },
      { role: 'assistant', content: 'Which denominator do you mean?' },
      { role: 'user', content: cases[0].turns[2].user },
    ]);
    expect(written).toHaveLength(3);
    expect(afterTurn).toHaveBeenCalledTimes(3);
  });
});
