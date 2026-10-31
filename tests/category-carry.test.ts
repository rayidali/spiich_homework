import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  CATEGORY_LIMITS,
  CategoryBudget,
  categoryBudgetTotals,
  addCategoryTotals,
  verifyCategoryCarry,
  type CategoryCarryReceipt,
  type CategoryCarryOptions,
} from '../scripts/category-evaluation/budget';
import {
  categorySourceBinding,
  parseCategoryArguments,
  runCategoryEvaluation,
} from '../scripts/category-evaluation/run';
import { categoryCases } from '../scripts/category-evaluation/fixtures';
import type { CategoryTransport } from '../server/category-selector';
import type { TransportObservation } from '../scripts/category-evaluation/transport';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const oldSource = 'a'.repeat(64),
  newSource = 'b'.repeat(64);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const gemini = JSON.stringify({ generationConfig: { maxOutputTokens: 256 }, contents: ['synthetic'] });
const jev = JSON.stringify({ model: 'jev-1.14.0', state: 'x'.repeat(100000), questions: { category: {} } });
function fixture(
  seed: (budget: CategoryBudget) => void = (budget) => {
    budget.reserve('gemini:failed-v1', 'gemini', gemini);
    budget.settle('gemini:failed-v1', { inputTokens: 100, outputTokens: 10 });
  },
) {
  const dir = mkdtempSync(join(tmpdir(), 'category-carry-test-'));
  dirs.push(dir);
  const old = join(dir, 'category-learning-20261031-v1'),
    current = join(dir, 'category-learning-20261031-v2');
  mkdirSync(old);
  mkdirSync(current);
  mkdirSync(join(old, 'observations'));
  const budget = new CategoryBudget(join(old, 'budget.json'), oldSource, 'create');
  seed(budget);
  budget.release(true);
  const ledger = JSON.parse(readFileSync(join(old, 'budget.json'), 'utf8'));
  // Synthetic legacy schema, never a mutation of the actual preserved ledger.
  ledger.version = 1;
  delete ledger.openingCarry;
  writeFileSync(join(old, 'budget.json'), JSON.stringify(ledger));
  const keyFingerprints = { gemini: hash('fake-gemini'), jev: hash('fake-jev') };
  writeFileSync(
    join(old, 'manifest.json'),
    JSON.stringify({
      run: 'category-learning-20261031-v1',
      version: 'daybook-category-learning-v1',
      source: { sourceHash: oldSource, files: { 'docs/CATEGORIZATION_PROTOCOL.md': 'c'.repeat(64) } },
    }),
  );
  writeFileSync(join(old, 'private-config.json'), JSON.stringify({ keyFingerprints }));
  writeFileSync(join(old, 'halt.json'), JSON.stringify({ reason: 'synthetic adapter error' }));
  writeFileSync(join(old, 'closure.json'), JSON.stringify({ closed: true }));
  writeFileSync(join(old, 'observations/0000.json'), JSON.stringify({ status: 'error', fixture: true }));
  const path = join(current, 'budget.json'),
    receiptPath = join(dir, 'approved-carry.json');
  const receipt: CategoryCarryReceipt = {
    schema: 'category-reviewed-carry-v1',
    approved: true,
    reason: 'gemini-additive-billing-metadata-compatibility',
    fromRun: 'category-learning-20261031-v1',
    toRun: 'category-learning-20261031-v2',
    fromVersion: 'daybook-category-learning-v1',
    toVersion: 'daybook-category-learning-v2',
    targetSourceHash: newSource,
    targetLedgerPath: path,
    predecessorLedgerSha256: hash(readFileSync(join(old, 'budget.json'), 'utf8')),
    predecessorSourceHash: oldSource,
    predecessorProtocolSha256: 'c'.repeat(64),
    artifactHashes: Object.fromEntries(
      ['manifest.json', 'private-config.json', 'halt.json', 'closure.json', 'observations/0000.json'].map(
        (file) => [file, hash(readFileSync(join(old, file), 'utf8'))],
      ),
    ),
    totals: categoryBudgetTotals(ledger.records),
    limits: CATEGORY_LIMITS,
    approvedAt: '2026-10-31T18:00:00.000Z',
  };
  const saveReceipt = () => {
    writeFileSync(receiptPath, JSON.stringify(receipt));
    return {
      receiptPath,
      receiptSha256: hash(readFileSync(receiptPath, 'utf8')),
      keyFingerprints,
    } satisfies CategoryCarryOptions;
  };
  return { dir, old, current, path, receiptPath, receipt, options: saveReceipt(), saveReceipt };
}

function fixtureV3(
  seed: (budget: CategoryBudget) => void = (budget) => {
    budget.reserve('v2:gemini', 'gemini', gemini);
    budget.settle('v2:gemini', { inputTokens: 100, outputTokens: 10 });
  },
) {
  const first = fixture();
  const secondBudget = new CategoryBudget(first.path, newSource, 'create', first.options);
  seed(secondBudget);
  const opening = secondBudget.snapshot().openingCarry!;
  secondBudget.release(true);
  const second = first.current;
  mkdirSync(join(second, 'observations'));
  writeFileSync(
    join(second, 'manifest.json'),
    JSON.stringify({
      run: 'category-learning-20261031-v2',
      version: 'daybook-category-learning-v2',
      source: { sourceHash: newSource, files: { 'docs/CATEGORIZATION_PROTOCOL.md': 'd'.repeat(64) } },
      openingCarry: opening,
    }),
  );
  writeFileSync(
    join(second, 'private-config.json'),
    JSON.stringify({ keyFingerprints: first.options.keyFingerprints, openingCarry: opening }),
  );
  writeFileSync(join(second, 'halt.json'), '{"reason":"synthetic rounded confidence adapter failure"}');
  writeFileSync(join(second, 'closure.json'), '{"closed":true}');
  writeFileSync(join(second, 'observations/0000.json'), '{"status":"error","fixture":true}');
  const current = join(first.dir, 'category-learning-20261031-v3');
  mkdirSync(current);
  const path = join(current, 'budget.json'),
    receiptPath = join(first.dir, 'v3-approval.json');
  const ledger = JSON.parse(readFileSync(first.path, 'utf8'));
  const receipt: CategoryCarryReceipt = {
    ...first.receipt,
    reason: 'jev-rounded-confidence-compatibility',
    fromRun: 'category-learning-20261031-v2',
    toRun: 'category-learning-20261031-v3',
    fromVersion: 'daybook-category-learning-v2',
    toVersion: 'daybook-category-learning-v3',
    targetSourceHash: 'e'.repeat(64),
    targetLedgerPath: path,
    ancestorReceipt: { receiptPath: first.receiptPath, receiptSha256: first.options.receiptSha256 },
    predecessorLedgerSha256: hash(readFileSync(first.path, 'utf8')),
    predecessorSourceHash: newSource,
    predecessorProtocolSha256: 'd'.repeat(64),
    artifactHashes: Object.fromEntries(
      ['manifest.json', 'private-config.json', 'halt.json', 'closure.json', 'observations/0000.json'].map(
        (file) => [file, hash(readFileSync(join(second, file), 'utf8'))],
      ),
    ),
    totals: addCategoryTotals(categoryBudgetTotals(ledger.records), opening.totals),
  };
  const saveReceipt = () => {
    writeFileSync(receiptPath, JSON.stringify(receipt));
    return {
      receiptPath,
      receiptSha256: hash(readFileSync(receiptPath, 'utf8')),
      keyFingerprints: first.options.keyFingerprints,
    };
  };
  return {
    dir: first.dir,
    old: second,
    current,
    path,
    receiptPath,
    receipt,
    options: saveReceipt(),
    saveReceipt,
    first,
  };
}

describe('Finite reviewed v1 to v2 category carry', () => {
  it('verifies both fixed ancestor approvals and adds their records exactly once', () => {
    const f = fixtureV3();
    const carry = verifyCategoryCarry(f.path, 'e'.repeat(64), f.options);
    expect(carry.totals.gemini).toMatchObject({ attempts: 2, knownUsd: '0.000110000000' });
    expect(carry.ancestorCarry!.totals.gemini.attempts).toBe(1);
    const budget = new CategoryBudget(f.path, 'e'.repeat(64), 'create', f.options);
    budget.reserve('v3:new', 'gemini', gemini);
    budget.settle('v3:new', null);
    expect(budget.accounting().cumulative.gemini.attempts).toBe(3);
    expect(Number(budget.accounting().cumulative.gemini.unknownReservedUsd)).toBeGreaterThan(0);
    budget.release();
  });
  it('rejects modified ancestors, omitted ancestors, undercounted or double-counted totals and repeated transitions', () => {
    for (const mutation of [
      'ancestor-ledger',
      'ancestor-approval',
      'ancestor-output',
      'missing',
      'undercount',
      'duplicate',
      'cycle',
      'manifest-carry',
    ]) {
      const f = fixtureV3();
      if (mutation === 'ancestor-ledger') writeFileSync(join(f.first.old, 'budget.json'), '{}');
      if (mutation === 'ancestor-approval') writeFileSync(f.first.receiptPath, '{}');
      if (mutation === 'ancestor-output') writeFileSync(join(f.first.old, 'observations/0000.json'), '{}');
      if (mutation === 'missing') delete f.receipt.ancestorReceipt;
      if (mutation === 'undercount') f.receipt.totals = f.first.receipt.totals;
      if (mutation === 'duplicate')
        f.receipt.totals = addCategoryTotals(f.receipt.totals, f.first.receipt.totals);
      if (mutation === 'cycle')
        f.receipt.ancestorReceipt = { receiptPath: f.receiptPath, receiptSha256: f.options.receiptSha256 };
      if (mutation === 'manifest-carry') {
        const path = join(f.old, 'manifest.json'),
          body = JSON.parse(readFileSync(path, 'utf8'));
        body.openingCarry.totals.gemini.attempts = 0;
        writeFileSync(path, JSON.stringify(body));
        f.receipt.artifactHashes['manifest.json'] = hash(readFileSync(path, 'utf8'));
      }
      expect(() => verifyCategoryCarry(f.path, 'e'.repeat(64), f.saveReceipt()), mutation).toThrow(
        'BUDGET_CARRY_BINDING',
      );
    }
  });
  it('deducts attempts and unknown costs from both earlier versions against unchanged ceilings', () => {
    const f = fixtureV3((budget) => {
      for (let i = 0; i < 70; i++) {
        budget.reserve(`v2:${i}`, 'gemini', gemini);
        budget.settle(`v2:${i}`, { inputTokens: 0, outputTokens: 0 });
      }
    });
    const budget = new CategoryBudget(f.path, 'e'.repeat(64), 'create', f.options);
    budget.reserve('last', 'gemini', gemini);
    budget.settle('last', { inputTokens: 0, outputTokens: 0 });
    expect(budget.accounting().cumulative.gemini.attempts).toBe(72);
    expect(() => budget.reserve('extra', 'gemini', gemini)).toThrow('BUDGET_EXHAUSTED');
    budget.release();
    const unknown = fixtureV3((b) => {
      for (let i = 0; i < 7; i++) {
        b.reserve(`u:${i}`, 'jev', jev);
        b.settle(`u:${i}`, null);
      }
    });
    const u = new CategoryBudget(unknown.path, 'e'.repeat(64), 'create', unknown.options);
    expect(() => u.reserve('extra', 'jev', jev)).toThrow('BUDGET_EXHAUSTED');
    u.release();
  });
  it('keeps the predecessor bytes untouched and separates known carry from new records and cohort totals', () => {
    const f = fixture(),
      original = readFileSync(join(f.old, 'budget.json'), 'utf8');
    const budget = new CategoryBudget(f.path, newSource, 'create', f.options);
    expect(budget.snapshot().records).toEqual([]);
    expect(budget.accounting().predecessor.gemini).toEqual({
      attempts: 1,
      knownUsd: '0.000055000000',
      unknownReservedUsd: '0.000000000000',
      chargedUsd: '0.000055000000',
    });
    budget.reserve('gemini:new-v2', 'gemini', gemini);
    budget.settle('gemini:new-v2', { inputTokens: 100, outputTokens: 10 });
    expect(budget.accounting().cumulative.gemini).toMatchObject({
      attempts: 2,
      chargedUsd: '0.000110000000',
    });
    expect(budget.accounting().currentRun.gemini.attempts).toBe(1);
    budget.release();
    const resumed = new CategoryBudget(f.path, newSource, 'resume', f.options);
    expect(resumed.accounting().cumulative.gemini.attempts).toBe(2);
    resumed.release(true);
    expect(readFileSync(join(f.old, 'budget.json'), 'utf8')).toBe(original);
  });
  it('counts zero-priced predecessor attempts and denies a second72-call allowance', () => {
    const f = fixture((budget) => {
      for (let i = 0; i < 71; i++) {
        budget.reserve(`old:${i}`, 'gemini', gemini);
        budget.settle(`old:${i}`, { inputTokens: 0, outputTokens: 0 });
      }
    });
    const budget = new CategoryBudget(f.path, newSource, 'create', f.options);
    budget.reserve('last', 'gemini', gemini);
    budget.settle('last', { inputTokens: 0, outputTokens: 0 });
    expect(budget.accounting().cumulative.gemini.attempts).toBe(72);
    expect(() => budget.reserve('excess', 'gemini', gemini)).toThrow('BUDGET_EXHAUSTED');
    budget.release();
  });
  it('retains unknown predecessor reservations against the same monetary cap', () => {
    const f = fixture((budget) => {
      for (let i = 0; i < 7; i++) {
        budget.reserve(`old:${i}`, 'jev', jev);
        budget.settle(`old:${i}`, null);
      }
    });
    const budget = new CategoryBudget(f.path, newSource, 'create', f.options);
    expect(Number(budget.accounting().predecessor.jev.unknownReservedUsd)).toBeGreaterThan(0.029);
    expect(() => budget.reserve('extra', 'jev', jev)).toThrow('BUDGET_EXHAUSTED');
    expect(budget.snapshot().records).toHaveLength(0);
    budget.release();
  });
  it('rejects empty carry, forged zero totals, nested carry and a pending or unclosed predecessor', () => {
    const empty = fixture(() => {});
    expect(() => verifyCategoryCarry(empty.path, newSource, empty.options)).toThrow('BUDGET_CARRY_BINDING');
    for (const mutation of ['totals', 'nested', 'pending', 'open']) {
      const f = fixture();
      if (mutation === 'totals') f.receipt.totals = categoryBudgetTotals([]);
      else {
        const oldPath = join(f.old, 'budget.json'),
          ledger = JSON.parse(readFileSync(oldPath, 'utf8'));
        if (mutation === 'nested') ledger.openingCarry = {};
        if (mutation === 'open') ledger.state = 'open';
        if (mutation === 'pending') {
          ledger.records[0].state = 'pending';
          ledger.records[0].chargedUsd = ledger.records[0].reservedUsd;
        }
        writeFileSync(oldPath, JSON.stringify(ledger));
        f.receipt.predecessorLedgerSha256 = hash(readFileSync(oldPath, 'utf8'));
      }
      expect(() => verifyCategoryCarry(f.path, newSource, f.saveReceipt())).toThrow('BUDGET_CARRY_BINDING');
    }
  });
  it('binds the reviewed receipt, exact target path, source, caps, keys and all prior outcome artifacts', () => {
    for (const mutation of [
      'receipt',
      'ledger',
      'outcome',
      'closure',
      'manifest',
      'key',
      'path',
      'source',
      'limits',
    ]) {
      const f = fixture();
      let options = f.options,
        path = f.path,
        source = newSource;
      if (mutation === 'receipt') writeFileSync(f.receiptPath, '{}');
      if (mutation === 'ledger') writeFileSync(join(f.old, 'budget.json'), '{}');
      if (mutation === 'outcome') writeFileSync(join(f.old, 'observations/0000.json'), '{}');
      if (mutation === 'closure') writeFileSync(join(f.old, 'closure.json'), '{}');
      if (mutation === 'manifest') writeFileSync(join(f.old, 'manifest.json'), '{}');
      if (mutation === 'key')
        options = { ...options, keyFingerprints: { ...options.keyFingerprints, gemini: 'd'.repeat(64) } };
      if (mutation === 'path') path = join(f.dir, 'another', 'category-learning-20261031-v2', 'budget.json');
      if (mutation === 'source') source = 'e'.repeat(64);
      if (mutation === 'limits') {
        (f.receipt.limits as unknown as { gemini: { usd: string } }) = structuredClone(CATEGORY_LIMITS);
        (f.receipt.limits.gemini as { usd: string }).usd = '1.00';
        options = f.saveReceipt();
      }
      expect(() => verifyCategoryCarry(path, source, options), mutation).toThrow('BUDGET_CARRY_BINDING');
    }
  });
  it('rechecks predecessor bindings before every new reservation and never recreates an existing v2 ledger', () => {
    const f = fixture();
    const budget = new CategoryBudget(f.path, newSource, 'create', f.options);
    expect(() => new CategoryBudget(f.path, newSource, 'create', f.options)).toThrow();
    writeFileSync(join(f.old, 'observations/0000.json'), '{}');
    expect(() => budget.reserve('new', 'gemini', gemini)).toThrow('BUDGET_CARRY_BINDING');
    expect(budget.snapshot().records).toHaveLength(0);
    budget.release();
  });
  it('cannot resume by dropping the receipt or replacing its opening totals', () => {
    const f = fixture();
    const budget = new CategoryBudget(f.path, newSource, 'create', f.options);
    budget.release();
    expect(() => new CategoryBudget(f.path, newSource, 'resume')).toThrow('BUDGET_BINDING');
    const ledger = JSON.parse(readFileSync(f.path, 'utf8'));
    ledger.openingCarry.totals.gemini.attempts = 0;
    writeFileSync(f.path, JSON.stringify(ledger));
    expect(() => new CategoryBudget(f.path, newSource, 'resume', f.options)).toThrow('BUDGET_BINDING');
  });
  it('requires explicit paired carry arguments and refuses an unreviewed paid runner before creating a directory', async () => {
    const parsed = parseCategoryArguments([
      '--split=development',
      '--run=category-learning-20261031-v2',
      '--mode=create',
      '--carry-from=/tmp/approved.json',
      `--carry-sha256=${'a'.repeat(64)}`,
    ]);
    expect(parsed.carry).toEqual({ receiptPath: '/tmp/approved.json', receiptSha256: 'a'.repeat(64) });
    expect(() =>
      parseCategoryArguments(['--split=development', '--run=x', '--mode=create', '--carry-from=/tmp/x']),
    ).toThrow('RUN_ARGUMENTS');
    const f = fixture();
    writeFileSync(join(f.dir, 'frozen.txt'), 'synthetic');
    await expect(
      runCategoryEvaluation({
        root: f.dir,
        run: 'unapproved',
        split: 'development',
        mode: 'create',
        keys: { gemini: 'fake', jev: 'fake' },
        sourceFiles: ['frozen.txt'],
      }),
    ).rejects.toThrow('RUN_CARRY_REQUIRED');
    expect(readdirSync(f.dir)).not.toContain('unapproved');
  });
  it('binds the reviewed carry to both v3 runner phases while keeping both earlier runs out of accuracy', async () => {
    const f = fixtureV3();
    writeFileSync(join(f.dir, 'frozen.txt'), 'synthetic frozen v2 source');
    f.receipt.targetSourceHash = categorySourceBinding(f.dir, ['frozen.txt']).sourceHash;
    const carry = f.saveReceipt();
    rmSync(f.current, { recursive: true });
    const prior = readFileSync(join(f.old, 'budget.json'), 'utf8');
    const transport =
      (_dir: string, id: string, budget: CategoryBudget, observed: TransportObservation): CategoryTransport =>
      async (request) => {
        budget.reserve(id, request.provider, request.body);
        budget.settle(id, { inputTokens: 100, outputTokens: 10 });
        observed.httpStatus = 200;
        observed.networkMs = 1;
        observed.dispatched = true;
        const body = JSON.parse(request.body);
        const state = request.provider === 'gemini' ? JSON.parse(body.contents[0].parts[0].text) : body.state;
        return {
          status: 200,
          body:
            request.provider === 'gemini'
              ? {
                  modelVersion: 'gemini-3.5-flash-lite',
                  candidates: [
                    { finishReason: 'STOP', content: { parts: [{ text: '{"choice":"unsupported"}' }] } },
                  ],
                  usageMetadata: {
                    promptTokenCount: 100,
                    candidatesTokenCount: 10,
                    thoughtsTokenCount: 0,
                    totalTokenCount: 110,
                  },
                }
              : {
                  model: 'jev-1.14.0',
                  answers: {
                    category: {
                      type: 'choice',
                      choice: 'unsupported',
                      confidence: 1,
                      probabilities: Object.fromEntries(
                        state.options.map((o: { key: string }) => [o.key, o.key === 'unsupported' ? 1 : 0]),
                      ),
                    },
                  },
                  usage: { input_tokens: 100, output_tokens: 10 },
                },
        };
      };
    const options = {
      root: f.dir,
      run: 'category-learning-20261031-v3',
      directory: f.current,
      split: 'development' as const,
      mode: 'create' as const,
      keys: { gemini: 'fake-gemini', jev: 'fake-jev' },
      sourceFiles: ['frozen.txt'],
      carry,
      cases: categoryCases.filter((c) => ['repeat-paper-dev', 'repeat-paper'].includes(c.sequenceId)),
    };
    const dev = await runCategoryEvaluation(options, { transport });
    expect(dev.observed).toBe(9);
    expect(dev.accounting.cohort!.predecessor.gemini.attempts).toBe(2);
    expect(dev.accounting.cohort!.currentRun.gemini.attempts).toBe(3);
    expect(dev.accounting.cohort!.cumulative.gemini.attempts).toBe(5);
    const holdout = await runCategoryEvaluation(
      { ...options, split: 'holdout', mode: 'resume' },
      { transport },
    );
    expect(holdout.observed).toBe(9);
    expect(holdout.scores).toHaveLength(9);
    expect(holdout.accounting.cohort!.cumulative.gemini.attempts).toBe(8);
    expect(holdout.accounting.priorAccuracyPooled).toBe(false);
    expect(holdout.selectors.find((s) => s.selector === 'gemini')!.costs.actualAttempts).toBe(3);
    expect(readFileSync(join(f.old, 'budget.json'), 'utf8')).toBe(prior);
    expect(
      JSON.parse(readFileSync(join(f.current, 'manifest.json'), 'utf8')).openingCarry.receiptSha256,
    ).toBe(carry.receiptSha256);
    expect(readFileSync(join(f.current, 'holdout/report.md'), 'utf8')).toContain(
      'No earlier accuracy result is pooled',
    );
  });
});
