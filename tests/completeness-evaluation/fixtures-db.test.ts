import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertDisposableFixtureDatabase,
  seedFixtures,
  type FixtureDatabaseOptions,
} from '../../scripts/completeness-evaluation/fixtures';

// Only the dedicated disposable evaluation workflow opts in. The freshly
// created database is left for service teardown: no reset/drop of any database.
const enabled = process.env.COMPLETENESS_EVALUATION_DB_TEST === '1';
let fixture: Awaited<ReturnType<typeof seedFixtures>> | undefined;
let runtime: pg.Client | undefined;
let options: FixtureDatabaseOptions;

describe.skipIf(!enabled)('Fresh completeness fixture in isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!process.env.MIGRATION_DATABASE_URL || !process.env.DATABASE_URL)
      throw new Error('Explicit isolated fixture database URLs are required.');
    const base: FixtureDatabaseOptions = {
      ownerUrl: process.env.MIGRATION_DATABASE_URL,
      runtimeUrl: process.env.DATABASE_URL,
      confirmation: 'CREATE_ISOLATED_COMPLETENESS_FIXTURE',
    };
    assertDisposableFixtureDatabase(base);
    const name = `daybook_completeness_eval_test_${randomBytes(8).toString('hex')}`;
    const owner = new URL(base.ownerUrl),
      app = new URL(base.runtimeUrl);
    owner.pathname = `/${name}`;
    app.pathname = `/${name}`;
    options = { ...base, ownerUrl: owner.href, runtimeUrl: app.href };
    assertDisposableFixtureDatabase(options);
    const creator = new pg.Client({ connectionString: base.ownerUrl });
    await creator.connect();
    try {
      // The only interpolated identifier is the fixed prefix and generated hex.
      await creator.query(`CREATE DATABASE "${name}"`);
    } finally {
      await creator.end();
    }
    const { migrate } = await import('../../scripts/migrate');
    await migrate(options.ownerUrl);
    fixture = await seedFixtures(options);
    runtime = new pg.Client({ connectionString: options.runtimeUrl });
    await runtime.connect();
  });
  afterAll(async () => {
    await runtime?.end();
    await fixture?.close();
  });

  it('stores all fixed rows and passes deferred posting and reversal constraints', async () => {
    expect(fixture!.storedLineChecks).toBe(104);
    expect(fixture!.referenceChecks).toBe(14);
    expect(fixture!.workedChecks).toBe(41);
    expect(fixture!.initialFingerprint).toMatchObject({
      organizations: 2,
      accounts: 48,
      entries: 51,
      lines: 104,
      scope: 'full_org_account_entry_line_rows',
    });
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
    const rows = (
      await runtime!.query<{ status: string; count: string; net: string }>(
        `SELECT e.status,count(DISTINCT e.id)::text AS count,sum(l.base_debit-l.base_credit)::text AS net
       FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
       WHERE e.organization_id=ANY($1::uuid[]) GROUP BY e.status ORDER BY e.status`,
        [[fixture!.orgId, fixture!.foreignOrgId]],
      )
    ).rows;
    expect(rows).toEqual([
      { status: 'DRAFT', count: '1', net: '0.00' },
      { status: 'POSTED', count: '50', net: '0.00' },
    ]);
  });

  it('independently reproduces conversation and raw counterparty contrasts with handwritten SQL', async () => {
    const rows = (
      await runtime!.query<{ month: string; counterparty: string; net: string }>(
        `SELECT to_char(e.date,'YYYY-MM') AS month,e.counterparty,sum(l.base_debit-l.base_credit)::text AS net
       FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE e.organization_id=$1 AND e.status='POSTED' AND a.code='5030'
       AND e.date BETWEEN '2026-07-01' AND '2026-09-30'
       GROUP BY 1,e.counterparty`,
        [fixture!.orgId],
      )
    ).rows;
    rows.sort((a, b) => (`${a.month}\0${a.counterparty}` < `${b.month}\0${b.counterparty}` ? -1 : 1));
    expect(rows).toEqual([
      { month: '2026-07', counterparty: 'Harbor Repair', net: '180.00' },
      { month: '2026-07', counterparty: 'Mixed shipment', net: '60.00' },
      { month: '2026-07', counterparty: 'Wheelhouse', net: '400.00' },
      { month: '2026-07', counterparty: 'harbor repair', net: '90.00' },
      { month: '2026-08', counterparty: 'Harbor Repair', net: '260.00' },
      { month: '2026-08', counterparty: 'Mixed shipment', net: '35.00' },
      { month: '2026-08', counterparty: 'Wheelhouse', net: '165.00' },
      { month: '2026-08', counterparty: 'harbor repair', net: '410.00' },
      { month: '2026-09', counterparty: 'Harbor Repair', net: '110.00' },
      { month: '2026-09', counterparty: 'Wheelhouse', net: '220.00' },
      { month: '2026-09', counterparty: 'harbor repair', net: '75.00' },
    ]);
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
  });

  it('reconciles cash movements, saved FX and separate noncash balances', async () => {
    const movements = (
      await runtime!.query<{ month: string; net: string }>(
        `SELECT to_char(e.date,'YYYY-MM') AS month,sum(l.base_debit-l.base_credit)::text AS net
       FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE e.organization_id=$1 AND e.status='POSTED' AND a.type='ASSET' AND a.is_cash AND NOT a.is_group
       AND e.date<='2026-09-30' GROUP BY 1 ORDER BY 1`,
        [fixture!.orgId],
      )
    ).rows;
    expect(movements).toEqual([
      { month: '2026-06', net: '18000.00' },
      { month: '2026-07', net: '319.00' },
      { month: '2026-08', net: '1635.00' },
      { month: '2026-09', net: '-1065.00' },
    ]);
    const balances = (
      await runtime!.query<{ code: string; native: string; base: string }>(
        `SELECT a.code,round(sum(l.debit-l.credit),2)::text AS native,sum(l.base_debit-l.base_credit)::text AS base
       FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE e.organization_id=$1 AND e.status='POSTED' AND a.code IN ('1020','1030','1100','1200')
       AND e.date<='2026-09-30' GROUP BY a.code ORDER BY a.code`,
        [fixture!.orgId],
      )
    ).rows;
    expect(balances).toEqual([
      { code: '1020', native: '300.00', base: '369.00' },
      { code: '1030', native: '70.00', base: '70.00' },
      { code: '1100', native: '5400.00', base: '5400.00' },
      { code: '1200', native: '3500.00', base: '3500.00' },
    ]);
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
  });

  it('refuses reseeding the nonempty database without changing the accounting fingerprint', async () => {
    await expect(seedFixtures(options)).rejects.toThrow('FIXTURE_DATABASE_NOT_EMPTY');
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
  });
});
