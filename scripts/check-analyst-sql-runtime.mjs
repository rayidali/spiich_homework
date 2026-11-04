import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('.vercel-build/analyst-sql-manifest.json', 'utf8'));
assert.equal(manifest.entry, '.vercel-build/analyst-sql.js');
assert.equal(manifest.wasm, 'node_modules/libpg-query/wasm/libpg-query.wasm');
assert.equal(hash(await readFile(manifest.entry)), manifest.bundleSha256);
assert.equal(hash(await readFile(manifest.wasm)), manifest.wasmSha256);
for (const [path, expected] of Object.entries(manifest.sourceHashes)) {
  assert.equal(path, 'server/analyst-sql.ts');
  assert.equal(hash(await readFile(path)), expected);
}
assert.equal(
  manifest.parserVersion,
  JSON.parse(await readFile('node_modules/pgsql-parser/package.json', 'utf8')).version,
);
assert.equal(
  manifest.engineVersion,
  JSON.parse(await readFile('node_modules/libpg-query/package.json', 'utf8')).version,
);
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.ok(config.functions['api/*.js'].includeFiles.includes('node_modules/libpg-query/wasm/**'));
globalThis.fetch = async () => {
  throw Error('No network permitted in SQL parser runtime check');
};
const { validateAnalystSql } = await import(pathToFileURL(resolve(manifest.entry)).href);
const query = await validateAnalystSql({
  id: 'proof',
  sql: `WITH monthly AS (
  SELECT date_trunc('month',date) AS month, sum(base_debit-base_credit)::numeric AS amount
  FROM analytics.ledger WHERE status='POSTED' AND account_type='EXPENSE'
  AND date BETWEEN DATE '2026-01-01' AND DATE '2026-11-03' GROUP BY 1)
  SELECT month,amount,round(100*amount/nullif(sum(amount) OVER (),0),2) AS percent FROM monthly ORDER BY month`,
});
assert.ok(query.sql.includes('analytics.ledger'));
await assert.rejects(validateAnalystSql({ id: 'deny', sql: "SELECT pg_read_file('/etc/passwd')" }), {
  code: 'ANALYST_SQL_POLICY',
});
console.log(
  JSON.stringify({
    check: 'native_analyst_sql_runtime',
    passed: true,
    ...manifest,
    databaseCalls: 0,
    providerCalls: 0,
  }),
);
