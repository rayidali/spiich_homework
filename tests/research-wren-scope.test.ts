import { beforeEach, describe, expect, it, vi } from 'vitest';

const response = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Writable } = await import('node:stream');
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new Writable({
          write(_chunk, _encoding, done) {
            done();
            queueMicrotask(() => {
              child.stdout.write(JSON.stringify(response.value));
              child.emit('close', 0);
            });
          },
        }),
        kill: vi.fn(),
      });
      return child;
    }),
  };
});

import { planWithWren } from '../research/wren/client';

beforeEach(() => {
  response.value = {
    ok: true,
    id: 'daybook',
    engine: 'wren-core-py',
    engineVersion: '0.8.2',
    sqlglotVersion: '30.27.0',
    plannedSql: 'SELECT SUM(base_debit) FROM research.scoped_ledger LIMIT 100',
    inputSha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
    planningMs: 1,
    maxRows: 100,
    columnUnits: { amount: 'USD' },
  };
});

describe('Wren subprocess scope contract', () => {
  it('maps missing legacy scope to explicit unsupported proof', async () => {
    const result = await planWithWren('SELECT SUM(base_debit) AS amount FROM ledger');
    expect(result.rowScope).toEqual({ provenance: 'ast-scope-v1', supported: false });
  });

  it('does not promote a money unit into cumulative scope for raw lines', async () => {
    response.value.rowScope = { provenance: 'ast-scope-v1', supported: false };
    const result = await planWithWren(
      "SELECT net_debit AS amount FROM ledger WHERE is_cash=TRUE AND date<=DATE '2026-09-30'",
    );
    expect(result.columnUnits?.amount).toBe('USD');
    expect(result.rowScope).toEqual({ provenance: 'ast-scope-v1', supported: false });
  });

  it('preserves proved bounds, source identities and actual period output names', async () => {
    const scope = {
      provenance: 'ast-scope-v1',
      supported: true,
      from: '2026-07-15',
      toExclusive: '2026-10-01',
      periodColumn: { name: 'billing_month', kind: 'month' },
      identityColumns: { vendor: 'customer', accountCode: 'code', entryId: 'transaction' },
      fixedIdentity: { accountName: 'Services' },
    };
    response.value.rowScope = scope;
    const result = await planWithWren('SELECT SUM(base_debit) AS amount FROM ledger');
    expect(result.rowScope).toEqual(scope);
  });

  it('preserves explicit unbounded history without inventing asOf', async () => {
    response.value.rowScope = { provenance: 'ast-scope-v1', supported: true, from: null, toExclusive: null };
    const result = await planWithWren('SELECT SUM(base_debit) AS amount FROM ledger');
    expect(result.rowScope).toEqual(response.value.rowScope);
    expect(result.rowScope).not.toHaveProperty('asOf');
  });

  it.each([
    { provenance: 'ast-scope-v1', supported: true },
    { provenance: 'ast-scope-v1', supported: true, from: null },
    { provenance: 'ast-scope-v1', supported: false, from: null },
    { provenance: 'model', supported: true, from: null, toExclusive: null },
    { provenance: 'ast-scope-v1', supported: true, from: '2026-02-30', toExclusive: null },
    { provenance: 'ast-scope-v1', supported: true, from: '2026-04-01', toExclusive: '2026-03-01' },
    {
      provenance: 'ast-scope-v1',
      supported: true,
      from: null,
      toExclusive: null,
      periodColumn: { name: 'month', kind: 'quarter' },
    },
    {
      provenance: 'ast-scope-v1',
      supported: true,
      from: null,
      toExclusive: null,
      periodColumn: { name: '__proto__', kind: 'month' },
    },
    {
      provenance: 'ast-scope-v1',
      supported: true,
      from: null,
      toExclusive: null,
      identityColumns: { guessedEntity: 'Acme' },
    },
  ])('rejects malformed or unproved scope metadata: %j', async (scope) => {
    response.value.rowScope = scope;
    await expect(planWithWren('SELECT SUM(base_debit) AS amount FROM ledger')).rejects.toThrow(
      'WREN_PLAN_REJECTED',
    );
  });
});
