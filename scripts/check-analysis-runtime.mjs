import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Run after hosting:bundle. This is an actual invocation of the native build,
// not a TypeScript import or a fake WASM loader. It opens no DB/provider client.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('.vercel-build/analysis-runtime-manifest.json', 'utf8'));
const expectedEntry = '.vercel-build/analysis-program.js';
const expectedWasm = 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';
assert.equal(manifest.entry, expectedEntry);
assert.equal(manifest.wasm, expectedWasm);
assert.equal(manifest.bundleSha256, sha256(await readFile(expectedEntry)), 'Built executor changed');
assert.equal(manifest.wasmSha256, sha256(await readFile(expectedWasm)), 'WASM asset changed');
for (const [path, hash] of Object.entries(manifest.sourceHashes)) {
  assert.match(path, /^(?:server\/analysis-program|server\/errors)\.ts$/);
  assert.equal(hash, sha256(await readFile(path)), `Rebuild after changing ${path}`);
}
assert.ok(Object.hasOwn(manifest.sourceHashes, 'server/analysis-program.ts'));
for (const imported of manifest.externalImports) {
  assert.equal(imported.external, true);
  assert.ok(['node:crypto', 'quickjs-emscripten', 'zod'].includes(imported.path));
}
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.equal(
  config.functions['api/*.js'].includeFiles,
  `{.vercel-build/**,${expectedWasm}}`,
  'The native API bundle and package-relative WASM asset must both be included',
);
const wasm = await readFile(expectedWasm);
assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109], 'Expected an actual WASM module');

// QuickJS uses its installed Node file loader; this guard makes any unexpected
// HTTP/provider request during this smoke check fail rather than spending money.
globalThis.fetch = async () => {
  throw new Error('Network access is disabled in the analysis runtime smoke check');
};
const { executeAnalysisProgram } = await import(pathToFileURL(resolve(expectedEntry)).href);
const actual = await executeAnalysisProgram({
  code: `
    const [one,three,zero]=tables[0].rows.map(row=>row.value);
    function share(numerator,denominator) {return calc.div(numerator,denominator)}
    return [{title:'Native runtime proof',rows:[
      {label:'One third',value:share(one,three),format:'percent'},
      {label:'No denominator',value:share(zero,zero),format:'percent'}]}];
  `,
  tables: [
    {
      id: 'fixture',
      truncated: false,
      rows: ['1', '3', '0'].map((value, index) => ({
        id: `fixture:${index}`,
        label: `Value ${index}`,
        value,
        unit: 'USD',
        source: 'posted',
      })),
    },
  ],
});
assert.equal(actual.tables[0].rows[0].value, '33.33%');
assert.deepEqual(actual.tables[0].rows[0].exact, { numerator: '1', denominator: '3' });
assert.deepEqual(actual.tables[0].rows[0].references, [
  { queryId: 'fixture', rowId: 'fixture:0' },
  { queryId: 'fixture', rowId: 'fixture:1' },
]);
assert.equal(actual.tables[0].rows[1].exact, null);
assert.equal(actual.tables[0].rows[1].reason, 'zero_denominator');
assert.equal(actual.tables[0].rows[1].value, 'Not available — denominator is zero');
console.log(
  JSON.stringify({
    check: 'native_analysis_runtime',
    passed: true,
    entry: expectedEntry,
    bundleSha256: manifest.bundleSha256,
    wasmSha256: manifest.wasmSha256,
    wasmBytes: wasm.byteLength,
    rowsVerified: 2,
    providerCalls: 0,
    databaseCalls: 0,
    scope: 'Local/CI native bundle and configured WASM inclusion; hosted execution requires a separate check',
  }),
);
