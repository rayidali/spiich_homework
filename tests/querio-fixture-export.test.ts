import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { entries, entryLines } from '../scripts/flexible-analytics-evaluation/fixture';
import { exportQuerioFixture, querioFixtureRecords } from '../scripts/querio-evaluation/fixture-export';

const options = {
  databaseName: 'daybook_querio_20261103',
  readerRole: 'daybook_querio_reader_20261103',
};
const cents = (amount: string) => BigInt(amount.replace('.', ''));

describe('Isolated Querio fixture SQL export', () => {
  it('exports the same 48 journal entries and 96 exact balanced lines as the native fixture', () => {
    const data = querioFixtureRecords();
    expect(data.organizations).toHaveLength(2);
    expect(data.accounts).toHaveLength(12);
    expect(data.entries).toHaveLength(48);
    expect(data.lines).toHaveLength(96);
    for (const [index, journal] of data.entries.entries()) {
      const source = entries[index];
      expect(journal).toMatchObject({
        date: source.date,
        status: source.status,
        counterparty: source.counterparty,
      });
      const stored = data.lines.filter((line) => line.entry_id === journal.id);
      expect(stored).toHaveLength(2);
      expect(stored.reduce((sum, line) => sum + cents(line.debit) - cents(line.credit), 0n)).toBe(0n);
      expect(
        stored.map((line) => ({
          account: data.accounts.find((account) => account.id === line.account_id)!.code,
          debit: line.debit,
          credit: line.credit,
        })),
      ).toEqual(entryLines(source));
      expect(stored.every((line) => line.organization_id === journal.organization_id)).toBe(true);
    }
  });

  it('keeps the other-workspace and draft sentinels separate while preserving signed refunds and future entries', () => {
    const data = querioFixtureRecords();
    const primary = data.organizations.find((row) => row.workspace === 'primary')!.id;
    const visible = data.entries.filter((row) => row.organization_id === primary);
    expect(visible).toHaveLength(47);
    expect(visible.filter((row) => row.status === 'DRAFT')).toHaveLength(1);
    const posted2025 = new Set(
      visible
        .filter((row) => row.status === 'POSTED' && row.date >= '2025-01-01' && row.date <= '2025-12-31')
        .map((row) => row.id),
    );
    const expenseAccounts = new Set(
      data.accounts.filter((row) => row.type === 'EXPENSE').map((row) => row.id),
    );
    const expenseLines = data.lines.filter(
      (row) => posted2025.has(row.entry_id) && expenseAccounts.has(row.account_id),
    );
    expect(expenseLines.reduce((sum, row) => sum + cents(row.debit) - cents(row.credit), 0n)).toBe(205000n);
    expect(expenseLines.some((row) => cents(row.credit) > 0n)).toBe(true);
    expect(visible.some((row) => row.date === '2026-11-04' && row.status === 'POSTED')).toBe(true);
  });

  it('reproduces deterministic opaque IDs, hashes and SQL without connecting or reading environment credentials', () => {
    const first = exportQuerioFixture(options);
    const second = exportQuerioFixture(options);
    expect(first).toEqual(second);
    const data = querioFixtureRecords();
    const ids = [...data.organizations, ...data.accounts, ...data.entries, ...data.lines].map(
      (row) => row.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      ids.every((id) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/.test(id)),
    ).toBe(true);
    expect(first.manifest.fixtureSha256).toBe(
      createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    );
    expect(first.manifest.sqlSha256).toBe(createHash('sha256').update(first.sql).digest('hex'));
  });

  it.each([
    'postgres',
    'neondb',
    'public',
    'daybook_querio;DROP ROLE owner',
    'daybook_querio"',
    'daybook_querio\\',
    'daybook_querio\0',
    'daybook_querio_Uppercase',
    'daybook_querio__duplicate',
    `daybook_querio_${'a'.repeat(64)}`,
  ])('rejects an unsafe or non-isolated database identifier: %j', (databaseName) => {
    expect(() => exportQuerioFixture({ databaseName })).toThrow(/identifiers/);
  });

  it('validates every configurable SQL identifier and refuses conflicting names', () => {
    for (const field of ['readerRole', 'schema', 'storageSchema'])
      expect(() => exportQuerioFixture({ ...options, [field]: 'public;SELECT 1' })).toThrow(/identifiers/);
    expect(() =>
      exportQuerioFixture({
        ...options,
        schema: 'daybook_querio_same',
        storageSchema: 'daybook_querio_same',
      }),
    ).toThrow(/distinct/);
  });

  it('places the exact database and empty-database guards before all role/schema/data mutations', () => {
    const { sql } = exportQuerioFixture(options);
    expect(sql).toContain("IF current_database() <> 'daybook_querio_20261103'");
    expect(sql).toContain('Querio fixture requires a fresh empty database');
    expect(sql.indexOf('$fixture_guard$;')).toBeLessThan(sql.indexOf('CREATE ROLE'));
    expect(sql).toContain('BEGIN;');
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|IF NOT EXISTS)\b/);
    expect(sql).toContain('CREATE SCHEMA "daybook_querio_storage";');
  });

  it('uses exact native and generated base numeric amounts with same-organization foreign keys', () => {
    const { sql } = exportQuerioFixture(options);
    expect(sql).toContain('debit numeric NOT NULL, credit numeric NOT NULL');
    expect(sql).toContain('base_debit numeric GENERATED ALWAYS AS (round(debit * exchange_rate, 2)) STORED');
    expect(sql).toContain(
      'base_credit numeric GENERATED ALWAYS AS (round(credit * exchange_rate, 2)) STORED',
    );
    expect(sql).toContain('FOREIGN KEY (organization_id, entry_id)');
    expect(sql).toContain('FOREIGN KEY (organization_id, account_id)');
    expect(sql).toContain("RAISE EXCEPTION 'Unbalanced fixture entry'");
    expect(sql).not.toMatch(/\b(?:float|double precision|real)\b/i);
  });

  it('grants SELECT on four scoped views only, with no backing-table privileges or credentials', () => {
    const { sql, manifest } = exportQuerioFixture(options);
    const grants = sql.split('\n').filter((line) => line.startsWith('GRANT '));
    expect(grants).toHaveLength(3);
    expect(grants.every((line) => !line.includes('daybook_querio_storage'))).toBe(true);
    expect(grants.join('\n')).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|TEMP|ALL)\b/);
    expect(sql).toContain('NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS');
    expect(sql).toContain('SET default_transaction_read_only = on');
    expect(sql).toContain('REVOKE ALL ON DATABASE "daybook_querio_20261103" FROM PUBLIC;');
    expect(
      sql
        .split('\n')
        .filter((line) => !line.startsWith('--'))
        .join('\n'),
    ).not.toMatch(/\bPASSWORD\b/i);
    expect(manifest.counts).toEqual({
      organizations: 2,
      accounts: 12,
      entries: 48,
      lines: 96,
      readerAccounts: 6,
      readerEntries: 47,
      readerLines: 94,
    });
  });

  it('restricts views to the primary business while retaining draft status for explicit selection', () => {
    const { sql } = exportQuerioFixture(options);
    const data = querioFixtureRecords();
    const primary = data.organizations.find((row) => row.workspace === 'primary')!.id;
    const views = sql.slice(sql.indexOf('CREATE VIEW'));
    expect(views).toContain(`WHERE e.organization_id = '${primary}'::uuid`);
    expect(views).toContain(`WHERE organization_id = '${primary}'::uuid`);
    expect(views.match(/security_barrier = true/g)).toHaveLength(2);
    expect(views).toContain('e.counterparty, e.status');
    expect(views).not.toContain("AND e.status = 'POSTED'");
  });

  it('provides date scaffolding and business definitions without expected answer leakage', () => {
    const { sql, context } = exportQuerioFixture(options);
    expect(sql).toContain("DATE '2026-11-03' AS business_date");
    expect(sql).toContain('FROM generate_series(0, 35)');
    expect(context).toContain('zero denominator yields NULL/unavailable');
    expect(context).toContain('left join');
    expect(context).toContain('not all assets');
    expect(context).toContain('filter status = POSTED');
    expect(`${sql}\n${context}`).not.toContain('2050.00');
    expect(`${sql}\n${context}`).not.toContain('58.54');
    expect(`${sql}\n${context}`).not.toContain('49.81');
    expect(context).not.toMatch(/F\d{2}|oracle|gold|expected answer/i);
  });

  it('exports separate operator-only read queries for scope, privileges, balance, totals and unchanged-data fingerprints', () => {
    const result = exportQuerioFixture(options);
    const checks = result.verificationSql;
    expect(Object.keys(checks)).toEqual([
      'ownerInventory',
      'ownerBalances',
      'readerIdentity',
      'readerInventory',
      'readerTotals',
    ]);
    for (const query of Object.values(checks)) {
      expect(query).not.toMatch(
        /(?:^|;)\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE)\b/i,
      );
      expect(query).not.toContain('2050.00');
    }
    expect(checks.ownerInventory).toContain('ORDER BY id');
    expect(checks.ownerInventory).toContain('AS fixture_fingerprint');
    expect(checks.readerIdentity).toContain('can_access_storage');
    expect(checks.readerIdentity).toContain('can_write_ledger');
    expect(checks.readerTotals).toContain("l.status='POSTED'");
    expect(result.context).not.toContain(checks.readerTotals);
  });
});
