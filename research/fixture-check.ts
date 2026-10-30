import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Decimal } from '../shared/money';
import { accounts, documents, entries, primaryOrganizationId, datasetVersion } from './dataset';
import type { ResearchDatabase } from './database';

const numeric = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform((value) => new Decimal(value).toFixed());
const bool = z
  .union([z.boolean(), z.enum(['t', 'f', 'true', 'false'])])
  .transform((value) => value === true || value === 't' || value === 'true');
const integer = z
  .union([z.number().int().safe(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .refine(Number.isSafeInteger);
const date = z.string().date();
const ledgerSchema = z
  .object({
    organization_id: z.string().uuid(),
    entry_id: z.string(),
    date,
    status: z.string(),
    description: z.string(),
    vendor: z.string(),
    account_code: z.string(),
    account_name: z.string(),
    account_type: z.string(),
    currency: z.string(),
    is_cash: bool,
    debit: numeric,
    credit: numeric,
    base_debit: numeric,
    base_credit: numeric,
    exchange_rate: numeric,
  })
  .strict();
const documentSchema = z
  .object({
    id: z.string(),
    organization_id: z.string().uuid(),
    title: z.string(),
    version: integer,
    effective_from: date,
    effective_to: date.nullable(),
    text: z.string(),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type LedgerRow = z.infer<typeof ledgerSchema>;
type DocumentRow = z.infer<typeof documentSchema>;
type EmbeddingRecord = {
  id: string;
  present: boolean;
  valid: boolean;
  dimensions: number | null;
  sha256: string | null;
};
export interface FixtureFailure {
  section: 'identity' | 'ledger' | 'documents' | 'embeddings' | 'snapshot';
  code: string;
  id?: string;
  fields?: string[];
}
export interface FixtureCheckReport {
  protocol: 'daybook-fixture-consistency-v1';
  at: string;
  datasetVersion: string;
  organizationId: string;
  passed: boolean;
  contentMatches: boolean;
  embeddingsComplete: boolean;
  expected: { ledgerLines: number; entries: number; documents: number; corpusDocuments: number };
  observed: {
    ledgerLines: number;
    entries: number;
    documents: number;
    embeddingsPresent: number;
    validEmbeddings: number;
  };
  sourceManifestSha256: string;
  storedManifestSha256: string | null;
  snapshotSha256: string | null;
  sourceLedgerSha256: string;
  storedLedgerSha256: string | null;
  sourceDocumentsSha256: string;
  storedDocumentsSha256: string | null;
  embeddings: EmbeddingRecord[];
  failures: FixtureFailure[];
  limitations: string[];
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const ledgerKey = (row: LedgerRow) => JSON.stringify([row.organization_id, row.entry_id, row.account_code]);
function sorted<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Normalize semantics, not raw PostgreSQL formatting; never round financial differences away. */
export function expectedFixture() {
  const chart = new Map(accounts.map((account) => [account.code, account]));
  const ledger = entries
    .filter((entry) => entry.organizationId === primaryOrganizationId && entry.status === 'POSTED')
    .flatMap((entry) =>
      entry.lines.map((line) => {
        const account = chart.get(line.accountCode);
        if (!account) throw new Error('FIXTURE_UNKNOWN_ACCOUNT');
        return ledgerSchema.parse({
          organization_id: entry.organizationId,
          entry_id: entry.id,
          date: entry.date,
          status: entry.status,
          description: entry.description,
          vendor: entry.vendor,
          account_code: account.code,
          account_name: account.name,
          account_type: account.type,
          currency: line.currency,
          is_cash: account.isCash,
          debit: line.debit,
          credit: line.credit,
          base_debit: line.baseDebit,
          base_credit: line.baseCredit,
          exchange_rate: line.exchangeRate,
        });
      }),
    );
  const docs = documents
    .filter((doc) => doc.organizationId === primaryOrganizationId)
    .map((doc) =>
      documentSchema.parse({
        id: doc.id,
        organization_id: doc.organizationId,
        title: doc.title,
        version: doc.version,
        effective_from: doc.effectiveFrom,
        effective_to: doc.effectiveTo,
        text: doc.text,
        content_hash: hash(doc.text),
      }),
    );
  if (
    new Set(ledger.map(ledgerKey)).size !== ledger.length ||
    new Set(docs.map((doc) => doc.id)).size !== docs.length
  )
    throw new Error('FIXTURE_DUPLICATE_SOURCE_KEY');
  return { ledger: sorted(ledger, ledgerKey), documents: sorted(docs, (doc) => doc.id) };
}

function compare<T extends Record<string, unknown>>(
  expected: T[],
  actual: T[],
  key: (row: T) => string,
  section: 'ledger' | 'documents',
  failures: FixtureFailure[],
) {
  const wanted = new Map(expected.map((row) => [key(row), row])),
    seen = new Set<string>();
  for (const row of actual) {
    const id = key(row);
    if (seen.has(id)) failures.push({ section, code: 'DUPLICATE_STORED_KEY', id });
    seen.add(id);
    const source = wanted.get(id);
    if (!source) {
      failures.push({ section, code: 'UNEXPECTED_STORED_ROW', id });
      continue;
    }
    const fields = Object.keys(source).filter((field) => source[field] !== row[field]);
    if (fields.length) failures.push({ section, code: 'SOURCE_DRIFT', id, fields });
  }
  for (const id of wanted.keys())
    if (!seen.has(id)) failures.push({ section, code: 'MISSING_STORED_ROW', id });
}

export function compareFixtureRows(input: {
  identity: Record<string, unknown>[];
  ledger: Record<string, unknown>[];
  documents: Record<string, unknown>[];
}): FixtureCheckReport {
  const expected = expectedFixture(),
    failures: FixtureFailure[] = [];
  if (
    input.identity.length !== 1 ||
    input.identity[0].role !== 'daybook_research_reader' ||
    input.identity[0].read_only !== 'on'
  )
    failures.push({ section: 'identity', code: 'READER_READ_ONLY_REQUIRED' });
  const storedLedger: LedgerRow[] = [],
    storedDocuments: DocumentRow[] = [],
    embeddings: EmbeddingRecord[] = [];
  for (const row of input.ledger) {
    const parsed = ledgerSchema.safeParse(row);
    if (!parsed.success) {
      failures.push({ section: 'ledger', code: 'INVALID_ROW_SHAPE' });
      continue;
    }
    storedLedger.push(parsed.data);
    if (parsed.data.organization_id !== primaryOrganizationId || parsed.data.status !== 'POSTED')
      failures.push({ section: 'ledger', code: 'SCOPE_LEAK', id: ledgerKey(parsed.data) });
  }
  for (const row of input.documents) {
    const { embedding, ...content } = row;
    const parsed = documentSchema.safeParse(content);
    if (!parsed.success) {
      failures.push({ section: 'documents', code: 'INVALID_ROW_SHAPE' });
      continue;
    }
    const doc = parsed.data;
    storedDocuments.push(doc);
    if (doc.organization_id !== primaryOrganizationId)
      failures.push({ section: 'documents', code: 'SCOPE_LEAK', id: doc.id });
    if (doc.content_hash !== hash(doc.text))
      failures.push({ section: 'documents', code: 'STORED_CONTENT_HASH_MISMATCH', id: doc.id });
    let vector: unknown = null;
    if (typeof embedding === 'string') {
      try {
        vector = JSON.parse(embedding);
      } catch {
        /* Invalid vectors fail below. */
      }
    }
    const present = embedding !== null && embedding !== undefined;
    const valid =
      Array.isArray(vector) &&
      vector.length === 768 &&
      vector.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      vector.some((v) => v !== 0);
    embeddings.push({
      id: doc.id,
      present,
      valid,
      dimensions: Array.isArray(vector) ? vector.length : null,
      sha256: valid ? hash(vector) : null,
    });
    if (!valid)
      failures.push({
        section: 'embeddings',
        code: present ? 'INVALID_EMBEDDING' : 'MISSING_EMBEDDING',
        id: doc.id,
      });
  }
  compare(expected.ledger, storedLedger, ledgerKey, 'ledger', failures);
  compare(expected.documents, storedDocuments, (doc) => doc.id, 'documents', failures);
  const normalized = {
    ledger: sorted(storedLedger, ledgerKey),
    documents: sorted(storedDocuments, (doc) => doc.id),
  };
  const orderedEmbeddings = sorted(embeddings, (embedding) => embedding.id);
  const contentMatches = !failures.some(
    (failure) => failure.section === 'ledger' || failure.section === 'documents',
  );
  const embeddingsComplete =
    embeddings.length === expected.documents.length &&
    embeddings.every((embedding) => embedding.valid) &&
    new Set(embeddings.map((embedding) => embedding.id)).size === expected.documents.length;
  return {
    protocol: 'daybook-fixture-consistency-v1',
    at: new Date().toISOString(),
    datasetVersion,
    organizationId: primaryOrganizationId,
    passed: failures.length === 0 && contentMatches && embeddingsComplete,
    contentMatches,
    embeddingsComplete,
    expected: {
      ledgerLines: expected.ledger.length,
      entries: new Set(expected.ledger.map((row) => row.entry_id)).size,
      documents: expected.documents.length,
      corpusDocuments: documents.length,
    },
    observed: {
      ledgerLines: input.ledger.length,
      entries: new Set(storedLedger.map((row) => row.entry_id)).size,
      documents: input.documents.length,
      embeddingsPresent: embeddings.filter((embedding) => embedding.present).length,
      validEmbeddings: embeddings.filter((embedding) => embedding.valid).length,
    },
    sourceManifestSha256: hash(expected),
    storedManifestSha256: hash(normalized),
    snapshotSha256: hash({
      datasetVersion,
      organizationId: primaryOrganizationId,
      ...normalized,
      embeddings: orderedEmbeddings,
    }),
    sourceLedgerSha256: hash(expected.ledger),
    storedLedgerSha256: hash(normalized.ledger),
    sourceDocumentsSha256: hash(expected.documents),
    storedDocumentsSha256: hash(normalized.documents),
    embeddings: orderedEmbeddings,
    failures,
    limitations: [
      'The reader verifies all posted primary-workspace ledger lines and all authorized documents; other-organization and draft rows are intentionally inaccessible.',
      'Every stored amount/rate is normalized as an exact decimal string without rounding; row order and trailing decimal zeros do not affect content equality.',
      'Document source URI and entry reversal-link metadata are not columns in the research view; their source-file definitions are outside this stored-row equality check.',
      'Embedding presence, dimension, finite/nonzero values and a vector-content hash are checked. This does not prove which model produced a vector or whether it semantically represents the document.',
      'The source fixture has forty corpus documents, but only the authorized subset is verified through this reader; this is not a claim to have inspected inaccessible vectors.',
    ],
  };
}

export async function checkStoredFixture(db: ResearchDatabase): Promise<FixtureCheckReport> {
  // One repeatable-read, read-only batch gives identity, ledger and documents one snapshot.
  const batches = await db.batch(
    [
      {
        query: "SELECT current_user AS role,current_setting('transaction_read_only') AS read_only",
        params: [],
      },
      {
        query:
          'SELECT organization_id,entry_id,date::text,status,description,vendor,account_code,account_name,account_type,currency,is_cash,debit::text,credit::text,base_debit::text,base_credit::text,exchange_rate::text FROM research.scoped_ledger ORDER BY entry_id,account_code',
        params: [],
      },
      {
        query:
          'SELECT id,organization_id,title,version,effective_from::text,effective_to::text,text,content_hash,embedding::text FROM research.scoped_documents ORDER BY id',
        params: [],
      },
    ],
    true,
  );
  if (batches.length !== 3) throw new Error('FIXTURE_SNAPSHOT_INCOMPLETE');
  return compareFixtureRows({
    identity: batches[0].rows,
    ledger: batches[1].rows,
    documents: batches[2].rows,
  });
}
