import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkResearchDatabase } from '../scripts/research/database-check';
import type { ResearchDatabase, QueryResult } from '../research/database';
import type { planWithWren } from '../research/wren/client';
import { getReference } from '../research/reference';

const rows = (values: Record<string, unknown>[]): QueryResult => ({
  fields: [],
  rows: values,
  rowCount: values.length,
});
function fixture(
  options: { demo?: 'absent' | 'readable' | 'network'; baseAbsent?: boolean; changed?: boolean } = {},
) {
  const value = getReference('financial-01').facts[0].value;
  const fingerprint = vi
    .fn()
    .mockResolvedValueOnce('before')
    .mockResolvedValueOnce(options.changed ? 'after' : 'before');
  const execute = vi.fn(async (sql: string) => {
    if (sql === 'SELECT planned_wren_value') return rows([{ value }]);
    if (sql.startsWith('SELECT DISTINCT organization_id'))
      return rows([{ organization_id: '11111111-1111-4111-8111-111111111111' }]);
    if (sql.includes('public.journal_entries')) {
      if (options.demo === 'readable') return rows([{ count: '1' }]);
      if (options.demo === 'absent') throw new Error('RESEARCH_DATABASE_ERROR:42P01');
      if (options.demo === 'network') throw new Error('Network failed while checking 42501');
    }
    if (options.baseAbsent && sql === 'SELECT count(*) FROM research.ledger')
      throw new Error('RESEARCH_DATABASE_ERROR:42P01');
    throw new Error('RESEARCH_DATABASE_ERROR:42501');
  });
  const db = {
    fingerprint,
    execute,
    batch: vi.fn().mockResolvedValue([rows([{ value }])]),
  } as unknown as ResearchDatabase;
  const planner = vi.fn().mockResolvedValue({
    plannedSql: 'SELECT planned_wren_value',
    engineVersion: '0.8.2',
    manifestSha256: 'a'.repeat(64),
  }) as unknown as typeof planWithWren;
  return { db, planner };
}
afterEach(() => vi.unstubAllEnvs());

describe('research database portability evidence', () => {
  it('records an absent demo table separately without crediting a privilege pass', async () => {
    vi.stubEnv('RESEARCH_DB_TRANSPORT', 'postgres');
    const { db, planner } = fixture({ demo: 'absent' });
    const report = await checkResearchDatabase(db, planner);
    expect(report.passed).toBe(true);
    expect(report.checks.filter((check) => check.status === 'PASS')).toHaveLength(7);
    expect(report.checks.find((check) => check.name === 'demo ledger absent')).toMatchObject({
      passed: null,
      status: 'NOT_APPLICABLE',
      details: { code: '42P01' },
    });
    expect(report.databaseTransport).toBe('postgres');
    expect(report.isolation).toContain('native PostgreSQL');
    expect(report.isolation).not.toContain('Neon');
  });

  it('still credits a real demo-table permission denial', async () => {
    vi.stubEnv('RESEARCH_DB_TRANSPORT', 'neon-http');
    const { db, planner } = fixture();
    const report = await checkResearchDatabase(db, planner);
    expect(report.checks.find((check) => check.name === 'demo ledger denied')).toMatchObject({
      passed: true,
      status: 'PASS',
      details: { code: '42501' },
    });
    expect(report.isolation).toContain('Neon HTTP');
  });

  it('fails when an expected research base table is absent', async () => {
    const { db, planner } = fixture({ baseAbsent: true });
    const report = await checkResearchDatabase(db, planner);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'research base table denied')).toMatchObject({
      passed: false,
      status: 'FAIL',
      details: { code: '42P01' },
    });
  });

  it.each(['readable', 'network'] as const)(
    'does not count a %s demo query as a permission denial',
    async (demo) => {
      const { db, planner } = fixture({ demo });
      const report = await checkResearchDatabase(db, planner);
      expect(report.passed).toBe(false);
      expect(report.checks.find((check) => check.name === 'demo ledger denied')?.status).toBe('FAIL');
    },
  );

  it('fails if the complete research fingerprint changes', async () => {
    const { db, planner } = fixture({ changed: true });
    const report = await checkResearchDatabase(db, planner);
    expect(report.passed).toBe(false);
    expect(report.checks.at(-1)).toMatchObject({
      name: 'complete research fingerprint unchanged',
      status: 'FAIL',
    });
  });
});
