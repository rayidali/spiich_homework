import { describe, expect, it, vi } from 'vitest';
import { checkStoredFixture, compareFixtureRows, expectedFixture } from '../research/fixture-check';
import { accounts, documents, entries } from '../research/dataset';
import type { ResearchDatabase } from '../research/database';

const vector = JSON.stringify(Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));
function stored() {
  const source = expectedFixture();
  return {
    identity: [{ role: 'daybook_research_reader', read_only: 'on' }],
    ledger: source.ledger.map((row) => ({ ...row })),
    documents: source.documents.map((row) => ({ ...row, embedding: vector })),
  };
}

describe('frozen research fixture consistency', () => {
  it('matches every authorized posted row and all document fields without depending on row order', () => {
    const input = stored();
    input.ledger.reverse();
    input.documents.reverse();
    const result = compareFixtureRows(input);
    expect(result.passed).toBe(true);
    expect(result.sourceManifestSha256).toBe(result.storedManifestSha256);
    expect(result.expected.documents).toBe(39);
    expect(result.expected.corpusDocuments).toBe(40);
    expect(result.observed.validEmbeddings).toBe(39);
    expect(result.sourceLedgerSha256).toBe(result.storedLedgerSha256);
  });

  it('normalizes decimal formatting while retaining every decimal digit', () => {
    const input = stored();
    input.ledger[0].exchange_rate += '.00000000';
    input.ledger[0].debit += '.000';
    expect(compareFixtureRows(input).passed).toBe(true);
    input.ledger[0].debit += '1';
    const changed = compareFixtureRows(input);
    expect(changed.contentMatches).toBe(false);
    expect(changed.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_DRIFT', fields: ['debit'] })]),
    );
  });

  it.each(['description', 'vendor', 'account_name', 'currency', 'exchange_rate', 'date', 'base_credit'])(
    'detects stale %s even when an insert would ON CONFLICT DO NOTHING',
    (field) => {
      const input = stored();
      const replacements: Record<string, string> = {
        description: 'stale description',
        vendor: 'wrong vendor',
        account_name: 'wrong account',
        currency: 'GBP',
        exchange_rate: '1.23456789',
        date: '2020-01-01',
        base_credit: '0.001',
      };
      (input.ledger[0] as Record<string, unknown>)[field] = replacements[field];
      const result = compareFixtureRows(input);
      expect(result.contentMatches).toBe(false);
      expect(result.sourceManifestSha256).not.toBe(result.storedManifestSha256);
    },
  );

  it('detects missing, extra and duplicate ledger rows', () => {
    const input = stored();
    const deleted = input.ledger.pop()!;
    input.ledger.push({ ...input.ledger[0] }, { ...deleted, entry_id: 'unexpected' });
    const result = compareFixtureRows(input);
    expect(result.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_STORED_KEY', 'UNEXPECTED_STORED_ROW', 'MISSING_STORED_ROW']),
    );
  });

  it.each(['title', 'version', 'effective_from', 'effective_to', 'text', 'content_hash'])(
    'detects stale document %s',
    (field) => {
      const input = stored();
      const replacements = {
        title: 'stale title',
        version: 900,
        effective_from: '2020-01-01',
        effective_to: '2020-02-01',
        text: 'changed document',
        content_hash: '0'.repeat(64),
      };
      (input.documents[0] as Record<string, unknown>)[field] =
        replacements[field as keyof typeof replacements];
      expect(compareFixtureRows(input).contentMatches).toBe(false);
    },
  );

  it('distinguishes unchanged corpus content from missing vector indexing', () => {
    const input = stored();
    (input.documents[0] as Record<string, unknown>).embedding = null;
    const result = compareFixtureRows(input);
    expect(result.contentMatches).toBe(true);
    expect(result.embeddingsComplete).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.observed.validEmbeddings).toBe(38);
  });

  it.each(['not-json', '[1,2]', JSON.stringify(Array(768).fill(0)), '[null]'])(
    'rejects malformed/empty embeddings %s',
    (embedding) => {
      const input = stored();
      input.documents[0].embedding = embedding;
      expect(compareFixtureRows(input).embeddingsComplete).toBe(false);
    },
  );

  it('changes the frozen snapshot when vector content changes without confusing it with document drift', () => {
    const input = stored(),
      before = compareFixtureRows(input);
    input.documents[0].embedding = JSON.stringify(Array.from({ length: 768 }, (_, i) => (i === 1 ? 1 : 0)));
    const after = compareFixtureRows(input);
    expect(after.contentMatches).toBe(true);
    expect(after.passed).toBe(true);
    expect(after.snapshotSha256).not.toBe(before.snapshotSha256);
    expect(after.sourceManifestSha256).toBe(before.sourceManifestSha256);
  });

  it('rejects unauthorized scope and mutable/wrong reader identities', () => {
    const input = stored();
    input.ledger[0].organization_id = '22222222-2222-4222-8222-222222222222';
    input.identity[0].role = 'owner';
    const result = compareFixtureRows(input);
    expect(result.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(['READER_READ_ONLY_REQUIRED', 'SCOPE_LEAK']),
    );
    expect(result.passed).toBe(false);
  });

  it('does not mutate source fixtures or input records while checking them', () => {
    const input = stored(),
      before = JSON.stringify(input),
      sourceBefore = JSON.stringify({ accounts, documents, entries });
    compareFixtureRows(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify({ accounts, documents, entries })).toBe(sourceBefore);
  });

  it('reads a coherent read-only batch and never writes or uses an owner connection', async () => {
    const input = stored();
    const batch = vi.fn(async (_queries: unknown, _readOnly: boolean) =>
      [input.identity, input.ledger, input.documents].map((rows) => ({
        fields: [],
        rows,
        rowCount: rows.length,
      })),
    );
    const result = await checkStoredFixture({ batch } as unknown as ResearchDatabase);
    expect(result.passed).toBe(true);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][1]).toBe(true);
    const queries = batch.mock.calls[0][0] as { query: string; params: unknown[] }[];
    expect(queries).toHaveLength(3);
    expect(queries.every(({ query }) => query.startsWith('SELECT '))).toBe(true);
    expect(queries[1].query).toContain('research.scoped_ledger');
    expect(queries[2].query).toContain('research.scoped_documents');
  });
});
