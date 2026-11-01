import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertDisposableFixtureDatabase,
  seedFixtures,
  type FixtureDatabaseOptions,
} from '../../scripts/adaptive-evaluation/fixtures';

// Opt in only in the dedicated manual evaluation workflow, before provider work.
// A new database is created, migrated and left for disposable-service teardown.
// This file never resets, truncates or drops an existing workspace/database.
const enabled = process.env.ADAPTIVE_EVALUATION_DB_TEST === '1';
let fixture: Awaited<ReturnType<typeof seedFixtures>> | undefined;
let runtime: pg.Client | undefined;
let options: FixtureDatabaseOptions;

describe.skipIf(!enabled)('Adaptive evaluation fixtures in an isolated real PostgreSQL database', () => {
  beforeAll(async () => {
    if (!process.env.MIGRATION_DATABASE_URL || !process.env.DATABASE_URL)
      throw new Error('Explicit disposable fixture database URLs are required.');
    const base: FixtureDatabaseOptions = {
      ownerUrl: process.env.MIGRATION_DATABASE_URL,
      runtimeUrl: process.env.DATABASE_URL,
      confirmation: 'CREATE_ISOLATED_ADAPTIVE_FIXTURE',
    };
    assertDisposableFixtureDatabase(base);
    const databaseName = `daybook_adaptive_eval_test_${randomBytes(8).toString('hex')}`;
    const ownerUrl = new URL(base.ownerUrl),
      runtimeUrl = new URL(base.runtimeUrl);
    ownerUrl.pathname = `/${databaseName}`;
    runtimeUrl.pathname = `/${databaseName}`;
    options = { ...base, ownerUrl: ownerUrl.href, runtimeUrl: runtimeUrl.href };
    assertDisposableFixtureDatabase(options);
    const creator = new pg.Client({ connectionString: base.ownerUrl });
    await creator.connect();
    try {
      // The identifier is a fixed prefix plus generated hexadecimal, never input.
      await creator.query(`CREATE DATABASE "${databaseName}"`);
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

  it('stores every fixed line and reference and has a repeatable full accounting fingerprint', async () => {
    expect(fixture!.storedLineChecks).toBe(86);
    expect(fixture!.referenceChecks).toBeGreaterThan(75);
    expect(fixture!.initialFingerprint).toMatchObject({
      organizations: 2,
      accounts: 46,
      entries: 41,
      lines: 86,
      scope: 'full_org_account_entry_line_rows',
    });
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
    const balance = (
      await runtime!.query<{ status: string; count: string; net: string }>(
        `SELECT e.status,count(DISTINCT e.id)::text AS count,sum(l.base_debit-l.base_credit)::text AS net
       FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
       WHERE e.organization_id=ANY($1::uuid[]) GROUP BY e.status ORDER BY e.status`,
        [[fixture!.orgId, fixture!.foreignOrgId]],
      )
    ).rows;
    expect(balance).toEqual([
      { status: 'DRAFT', count: '1', net: '0.00' },
      { status: 'POSTED', count: '40', net: '0.00' },
    ]);
  });

  it('reproduces the handwritten supplies and counterparty contrasts through actual SQL', async () => {
    const result = (
      await runtime!.query<{ month: string; counterparty: string; net: string }>(
        `SELECT to_char(e.date,'YYYY-MM') AS month,e.counterparty,sum(l.base_debit-l.base_credit)::text AS net
       FROM journal_entries e JOIN journal_lines l ON l.organization_id=e.organization_id AND l.entry_id=e.id
       JOIN accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
       WHERE e.organization_id=$1 AND e.status='POSTED' AND a.code='5030'
       AND e.date BETWEEN '2026-05-01' AND '2026-06-30'
       GROUP BY 1,e.counterparty ORDER BY 1,e.counterparty`,
        [fixture!.orgId],
      )
    ).rows;
    result.sort((a, b) => {
      const left = `${a.month}\0${a.counterparty}`,
        right = `${b.month}\0${b.counterparty}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    expect(result).toEqual([
      { month: '2026-05', counterparty: 'Acme', net: '325.00' },
      { month: '2026-05', counterparty: 'Mix Co', net: '40.00' },
      { month: '2026-05', counterparty: 'Paper Ferry', net: '310.00' },
      { month: '2026-06', counterparty: 'Acme', net: '122.00' },
      { month: '2026-06', counterparty: 'Books & Co', net: '27.50' },
      { month: '2026-06', counterparty: 'Paper Ferry', net: '45.00' },
      { month: '2026-06', counterparty: 'acme', net: '615.00' },
    ]);
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
  });

  it('reconciles opening cash plus movements and keeps native EUR different from stored base', async () => {
    const result = (
      await runtime!.query<{ period: string; net: string }>(
        `SELECT to_char(e.date,'YYYY-MM') AS period,sum(l.base_debit-l.base_credit)::text AS net
       FROM journal_entries e JOIN journal_lines l ON l.organization_id=e.organization_id AND l.entry_id=e.id
       JOIN accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
       WHERE e.organization_id=$1 AND e.status='POSTED' AND a.type='ASSET' AND a.is_cash AND NOT a.is_group
       AND e.date<='2026-06-30' GROUP BY 1 ORDER BY 1`,
        [fixture!.orgId],
      )
    ).rows;
    expect(result).toEqual([
      { period: '2026-04', net: '12240.00' },
      { period: '2026-05', net: '2135.00' },
      { period: '2026-06', net: '-839.50' },
    ]);
    const euro = (
      await runtime!.query<{ native: string; base: string }>(
        `SELECT round(sum(l.debit-l.credit),2)::text AS native,sum(l.base_debit-l.base_credit)::text AS base
       FROM journal_entries e JOIN journal_lines l ON l.organization_id=e.organization_id AND l.entry_id=e.id
       JOIN accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
       WHERE e.organization_id=$1 AND e.status='POSTED' AND a.code='1020' AND e.date<='2026-06-30'`,
        [fixture!.orgId],
      )
    ).rows[0];
    expect(euro).toEqual({ native: '306.00', base: '375.00' });
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
  });

  it('refuses reseeding a nonempty database and leaves every accounting row unchanged', async () => {
    await expect(seedFixtures(options)).rejects.toThrow('FIXTURE_DATABASE_NOT_EMPTY');
    expect(await fixture!.fingerprint()).toEqual(fixture!.initialFingerprint);
  });
});
