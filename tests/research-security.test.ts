import { describe, expect, it, vi } from 'vitest';
import { runSecuritySuite } from '../research/security';
import type { ResearchDatabase, QueryResult } from '../research/database';
import { primaryOrganizationId } from '../research/dataset';
import type { WrenPlan } from '../research/wren/client';

const rows = (value: Record<string, unknown>[]): QueryResult => ({
  fields: [],
  rows: value,
  rowCount: value.length,
});
function dependencies(
  options: {
    role?: string;
    denyCode?: string;
    networkFailure?: boolean;
    permitWrites?: boolean;
    changed?: boolean;
    leak?: boolean;
  } = {},
) {
  const execute = vi.fn(async (sql: string, _params?: unknown[]): Promise<QueryResult> => {
    if (options.networkFailure) throw new Error('RESEARCH_HTTP_FAILURE');
    if (sql.includes('current_user AS role'))
      return rows([{ role: options.role ?? 'daybook_research_reader', read_only: 'on' }]);
    if (sql.includes('coalesce(sum(base_debit-base_credit)')) return rows([{ value: '164615.00' }]);
    if (/^(INSERT|DELETE|UPDATE)/.test(sql) || sql === 'SELECT count(*) FROM research.ledger') {
      if (options.permitWrites) return rows([]);
      throw new Error(`RESEARCH_DATABASE_ERROR:${options.denyCode ?? '42501'}`);
    }
    if (sql === 'SELECT DISTINCT organization_id FROM research.scoped_documents')
      return rows([{ organization_id: primaryOrganizationId }]);
    if (sql.includes('research.scoped_ledger') || sql.includes('research.scoped_documents')) {
      return options.leak ? rows([{ entry_id: 'other-opening', id: 'other-company-secret' }]) : rows([]);
    }
    throw new Error('UNEXPECTED_TEST_QUERY');
  });
  let fingerprints = 0;
  const fingerprint = vi.fn(async () => (options.changed && ++fingerprints > 1 ? 'changed' : 'unchanged'));
  const planner = vi.fn(async (sql: string): Promise<WrenPlan> => {
    if (sql === 'SELECT COUNT(DISTINCT entry_id) AS value FROM ledger')
      return {
        ok: true,
        id: 'daybook',
        engine: 'wren-core-py',
        engineVersion: '0.8.2',
        sqlglotVersion: '30.27.0',
        plannedSql: 'SELECT count(DISTINCT entry_id) FROM research.scoped_ledger LIMIT 100',
        inputSha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        planningMs: 1,
        maxRows: 100,
      };
    throw new Error('WREN_PLAN_REJECTED');
  });
  return { execute, fingerprint, planner, db: { execute, fingerprint } as unknown as ResearchDatabase };
}

describe('component security evidence and honest coverage', () => {
  it('maps all sixty source cases to explicit boundaries without claiming live prompt resistance', async () => {
    const mock = dependencies();
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.results).toHaveLength(60);
    expect(new Set(report.results.map((r) => r.id)).size).toBe(60);
    expect(report.results.every((r) => r.livePromptBehaviorAssessed === false)).toBe(true);
    expect(report.results.filter((r) => r.scope === 'literal_sql')).toHaveLength(10);
    expect(report.results.filter((r) => r.scope === 'literal_tool_payload')).toHaveLength(10);
    expect(report.counts.UNASSESSED).toBeGreaterThanOrEqual(3);
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(60);
    expect(report.hardGateFailures).toBe(0);
    expect(report.before).toBe(report.after);
    expect(report.results.find((r) => r.id === 'security-exfiltration-6')?.status).toBe('UNASSESSED');
    expect(report.results.find((r) => r.id === 'security-document_injection-4')?.status).toBe('UNASSESSED');
  });

  it('reports concrete semantic failures separately from permission hard gates', async () => {
    const mock = dependencies();
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    const cashForgery = report.results.find((r) => r.id === 'security-document_injection-3')!;
    // A hardened validator may reject it; either observed result is reported honestly.
    expect(['PASS', 'FAIL']).toContain(cashForgery.status);
    expect(cashForgery.checks[0].hardGate).toBe(false);
    expect(cashForgery.checks[0].probe).toMatchObject({
      facts: [{ key: 'cash_balance', value: '9000000.00', evidenceIds: ['injected-receipt'] }],
    });
  });

  it('does not count a missing Wren installation as ten successful SQL blocks', async () => {
    const mock = dependencies();
    const unavailable = vi.fn(async (): Promise<WrenPlan> => {
      throw new Error('WREN_UNAVAILABLE');
    });
    const report = await runSecuritySuite(mock.db, { planWren: unavailable });
    expect(report.results.filter((r) => r.kind === 'sql').every((r) => r.status === 'UNASSESSED')).toBe(true);
    expect(unavailable).toHaveBeenCalledOnce();
  });

  it('does not call a provider/network failure a database permission denial', async () => {
    const mock = dependencies({ networkFailure: true });
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.before).toBeNull();
    expect(report.after).toBeNull();
    expect(report.results.filter((r) => r.kind === 'write').every((r) => r.status === 'UNASSESSED')).toBe(
      true,
    );
    expect(mock.execute).toHaveBeenCalledOnce();
  });

  it('rejects a wrong database role and never sends its zero-row mutation probes', async () => {
    const mock = dependencies({ role: 'owner' });
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.hardGateFailures).toBeGreaterThan(0);
    expect(mock.execute).toHaveBeenCalledOnce();
    expect(mock.fingerprint).not.toHaveBeenCalled();
  });

  it('only treats PostgreSQL permission/read-only codes as proven denials', async () => {
    const mock = dependencies({ denyCode: '42P01' });
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.results.filter((r) => r.kind === 'write').every((r) => r.status === 'UNASSESSED')).toBe(
      true,
    );
  });

  it('detects accepted write capability while probes cannot intentionally change rows', async () => {
    const mock = dependencies({ permitWrites: true });
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.hardGateFailures).toBeGreaterThan(0);
    expect(report.results.filter((r) => r.kind === 'write').some((r) => r.status === 'FAIL')).toBe(true);
    const mutating = mock.execute.mock.calls.filter(([sql]) => /^(INSERT|DELETE|UPDATE)/.test(sql));
    expect(mutating).toHaveLength(9);
    expect(mutating.every(([sql]) => sql.endsWith('WHERE false'))).toBe(true);
  });

  it('fails a scope gate when unauthorized rows are returned', async () => {
    const mock = dependencies({ leak: true });
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.results.find((r) => r.id === 'security-cross_workspace-1')?.status).toBe('FAIL');
    expect(report.hardGateFailures).toBeGreaterThan(0);
  });

  it('fails preservation if the final ledger fingerprint changes', async () => {
    const mock = dependencies({ changed: true });
    const report = await runSecuritySuite(mock.db, { planWren: mock.planner });
    expect(report.controls.find((c) => c.name === 'ledger fingerprint unchanged')?.status).toBe('FAIL');
    expect(report.hardGateFailures).toBeGreaterThan(0);
  });
});
