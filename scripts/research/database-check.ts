import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchDatabase } from '../../research/database';
import { httpTransport, atomicJson } from '../../research/io';
import { compileQuery, runQueries } from '../../research/analytics';
import { getReference } from '../../research/reference';
import { planWithWren } from '../../research/wren/client';

export interface DatabaseCheck {
  name: string;
  passed: boolean | null;
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  details?: unknown;
}

export async function checkResearchDatabase(
  db: ResearchDatabase,
  planner: typeof planWithWren = planWithWren,
) {
  const checks: DatabaseCheck[] = [];
  const add = (name: string, passed: boolean | null, details?: unknown) => {
    checks.push({
      name,
      passed,
      status: passed === null ? 'NOT_APPLICABLE' : passed ? 'PASS' : 'FAIL',
      ...(details === undefined ? {} : { details }),
    });
  };
  const before = await db.fingerprint();
  const base = {
    id: 'cash',
    metric: 'cash_balance',
    from: null,
    to: '2026-09-30',
    groupBy: 'none',
    accountCodes: [],
    search: '',
    limit: 10,
    order: 'label_asc',
  };
  const compiled = compileQuery(base);
  const evidence = await runQueries(db, [compiled.plan], before);
  add(
    'custom SQL vs independent decimal oracle',
    evidence[0].rows[0].value === getReference('financial-01').facts[0].value,
    evidence[0].rows,
  );
  const wren = await planner(
    "SELECT SUM(net_debit) AS value FROM ledger WHERE is_cash = true AND date <= DATE '2026-09-30'",
  );
  const wrenResult = await db.execute(wren.plannedSql);
  add(
    'actual Wren plan executed by restricted PostgreSQL reader',
    String(wrenResult.rows[0].value) === getReference('financial-01').facts[0].value,
    wrenResult.rows,
  );
  const scope = await db.execute('SELECT DISTINCT organization_id FROM research.scoped_ledger');
  add(
    'fixed workspace view excludes other tenant',
    scope.rows.length === 1 && scope.rows[0].organization_id === '11111111-1111-4111-8111-111111111111',
  );
  for (const [name, sql] of [
    ['research base table denied', 'SELECT count(*) FROM research.ledger'],
    ['demo ledger denied', 'SELECT count(*) FROM public.journal_entries'],
    [
      'write denied',
      "INSERT INTO research.ledger(organization_id) VALUES('11111111-1111-4111-8111-111111111111')",
    ],
    ['schema creation denied', 'CREATE TABLE research.forbidden_probe(id integer)'],
  ] as const) {
    try {
      await db.execute(sql);
      add(name, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^RESEARCH_DATABASE_ERROR:([A-Z0-9]{5})$/.exec(message)?.[1];
      if (name === 'demo ledger denied' && code === '42P01') {
        add('demo ledger absent', null, {
          code,
          reason: 'No public.journal_entries exists in this database; absence is not a permission test.',
        });
      } else {
        add(name, code === '42501' || code === '25006', { code: code ?? 'UNKNOWN' });
      }
    }
  }
  const after = await db.fingerprint();
  add('complete research fingerprint unchanged', before === after);
  const transport = process.env.RESEARCH_DB_TRANSPORT ?? 'neon-http';
  return {
    at: new Date().toISOString(),
    passed: checks.every((check) => check.passed !== false),
    checks,
    before,
    after,
    wren: { version: wren.engineVersion, manifestHash: wren.manifestSha256 },
    databaseTransport: transport,
    isolation:
      transport === 'postgres'
        ? 'Restricted reader and scoped research schema over native PostgreSQL; server topology is not inferred'
        : 'Restricted reader and scoped research schema over Neon HTTP; server topology is not inferred',
    scope:
      'Pre-index database execution and access boundaries; no embedding, retrieval or model-quality claim',
  };
}

async function main() {
  await import('dotenv/config');
  const reader = JSON.parse(readFileSync('.tools/research/database-private.json', 'utf8')).readerUrl;
  const report = await checkResearchDatabase(new ResearchDatabase(reader, httpTransport()));
  mkdirSync('docs/evidence', { recursive: true });
  atomicJson('docs/evidence/research-database-check.json', report);
  console.log(JSON.stringify(report.checks));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
