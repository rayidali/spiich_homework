import { describe, expect, it } from 'vitest';
import { expectedRows } from '../scripts/analyst-workspace-evaluation/database';
import {
  assertTarget,
  lineId,
  readReferences,
  sameValue,
} from '../scripts/analyst-workspace-evaluation/references';

const database = 'daybook_analyst_acceptance_guard';
const local = `postgresql://test:fixture-password@127.0.0.1:5432/${database}`;

describe('Disposable analyst fixture safety', () => {
  it.each([
    [
      'remote database',
      `postgresql://test:secret@live.example/${database}`,
      database,
      'NONLOCAL_DATABASE_REFUSED',
    ],
    ['application database', 'postgresql://test:secret@localhost/spiich', 'spiich', 'UNSAFE_DATABASE_NAME'],
    ['wrong database', 'postgresql://test:secret@localhost/neondb', database, 'DATABASE_NAME_MISMATCH'],
    ['URL host override', `${local}?host=live.example`, database, 'DATABASE_URL_OPTIONS_NOT_ALLOWED'],
    ['URL socket override', `${local}?host=/tmp`, database, 'DATABASE_URL_OPTIONS_NOT_ALLOWED'],
    ['fragment', `${local}#anything`, database, 'DATABASE_URL_OPTIONS_NOT_ALLOWED'],
    ['unsupported protocol', local.replace('postgresql:', 'https:'), database, 'INVALID_DATABASE_PROTOCOL'],
    ['missing role', `postgresql://localhost/${database}`, database, 'DATABASE_ROLE_REQUIRED'],
    [
      'compose outside tests',
      `postgresql://test:secret@db:5432/${database}`,
      database,
      'NONLOCAL_DATABASE_REFUSED',
    ],
  ])('refuses %s before opening a connection', (_label, url, name, code) => {
    expect(() => assertTarget(url, name, {})).toThrow(code);
    try {
      assertTarget(url, name, {});
    } catch (error) {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('fixture-password');
    }
  });

  it('accepts only explicit disposable local/CI targets and gives each database a distinct reader', () => {
    const first = assertTarget(local, database, {});
    expect(first.database).toBe(database);
    expect(first.readerRole).toMatch(/^analyst_fixture_reader_[0-9a-f]{12}$/);
    expect(assertTarget(`postgresql://test:secret@db:5432/${database}`, database, { CI: 'true' })).toEqual(
      first,
    );
    expect(assertTarget(`postgresql://test:secret@[::1]/${database}`, database, {})).toEqual(first);
    const other = `${database}_other`;
    expect(assertTarget(local.replace(database, other), other, {}).readerRole).not.toBe(first.readerRole);
  });

  it('compares decimal precision beyond safe JavaScript integers without weakening cents or array order', () => {
    expect(sameValue('9007199254740993.100000', '9007199254740993.1')).toBe(true);
    expect(sameValue('9007199254740993.10', '9007199254740992.10')).toBe(false);
    expect(sameValue('23.01', '23.00')).toBe(false);
    expect(sameValue({ usd: '-0.000', EUR: '1.0' }, { EUR: '1', usd: '0' })).toBe(true);
    expect(sameValue(['1', '2'], ['2', '1'])).toBe(false);
    expect(sameValue(null, '0')).toBe(false);
    expect(sameValue('1', 1)).toBe(false);
  });

  it('preserves the independently checked fixture, exact money and organization provenance', () => {
    const refs = readReferences();
    const rows = expectedRows(refs);
    expect(Object.keys(refs.facts)).toHaveLength(38);
    expect(refs.facts['cash.total'].value).toBe('23427.65');
    expect(refs.facts['spend.total'].value).toBe('16030.35');
    expect(rows.journal_entries).toHaveLength(59);
    expect(rows.journal_lines).toHaveLength(118);
    expect(new Set(rows.journal_lines.map((line) => line.id)).size).toBe(118);
    for (const entry of refs.fixture.entries) {
      const stored = rows.journal_entries.find((row) => row.id === entry.id);
      expect(stored).toMatchObject({
        organization_id: entry.organization_id,
        reference: entry.key,
        number: String(entry.number),
        status: entry.status,
        recurring_template_id: entry.recurring_template_id,
        reverses_entry_id: entry.reverses_entry_id,
      });
      for (const line of entry.lines) {
        const id = lineId(entry.id, line.position);
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(rows.journal_lines.find((row) => row.id === id)).toMatchObject({
          account_id: line.account_id,
          organization_id: entry.organization_id,
          entry_id: entry.id,
          debit: line.debit,
          credit: line.credit,
          exchange_rate: line.exchange_rate,
          base_debit: line.base_debit,
          base_credit: line.base_credit,
        });
      }
    }
    const resolved = rows.alerts.filter((row) => row.status === 'RESOLVED');
    expect(resolved).toHaveLength(1);
    expect(
      refs.fixture.entries.find((entry) => entry.id === resolved[0].resolution_entry_id)?.reverses_entry_id,
    ).toBe(resolved[0].entry_id);
    for (const template of rows.recurring_templates) {
      expect(refs.fixture.entries.some((entry) => entry.recurring_template_id === template.id)).toBe(true);
      expect(template.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: expect.any(String), exchangeRate: '1' }),
        ]),
      );
    }
  });
});
