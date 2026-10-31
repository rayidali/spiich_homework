import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CategoryBudget } from '../scripts/category-evaluation/budget';

const directories: string[] = [];
const hash = 'a'.repeat(64);
const gemini = JSON.stringify({ generationConfig: { maxOutputTokens: 256 }, contents: ['synthetic'] });
const jev = JSON.stringify({
  model: 'jev-1.14.0',
  state: 'synthetic',
  questions: { category: { type: 'choice' } },
});
function path() {
  const dir = mkdtempSync(join(tmpdir(), 'daybook-category-budget-'));
  directories.push(dir);
  return join(dir, 'ledger.json');
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('New categorization spend ledger', () => {
  it('persists a reservation before dispatch and reconciles exact decimal reported usage', () => {
    const file = path();
    const budget = new CategoryBudget(file, hash, 'create');
    budget.reserve('dev:1:gemini', 'gemini', gemini);
    expect(JSON.parse(readFileSync(file, 'utf8')).records[0].state).toBe('pending');
    expect(() => budget.reserve('dev:2:gemini', 'gemini', gemini)).toThrow('BUDGET_IN_FLIGHT');
    budget.settle('dev:1:gemini', { inputTokens: 100, outputTokens: 10 });
    expect(budget.snapshot().records[0].chargedUsd).toBe('0.000055000000');
    budget.release();
  });
  it('retains timeout/unknown reserves and consumes their IDs across a resume', () => {
    const file = path();
    const first = new CategoryBudget(file, hash, 'create');
    first.reserve('hold:1:jev', 'jev', jev);
    const reserved = first.snapshot().records[0].reservedUsd;
    first.release();
    const resumed = new CategoryBudget(file, hash, 'resume');
    expect(resumed.snapshot().records[0]).toMatchObject({ state: 'unknown', chargedUsd: reserved });
    expect(() => resumed.reserve('hold:1:jev', 'jev', jev)).toThrow('BUDGET_REQUEST_USED');
    resumed.release();
  });
  it('forbids resetting existing spending, concurrent writers and reopening closed runs', () => {
    const file = path();
    const budget = new CategoryBudget(file, hash, 'create');
    expect(() => new CategoryBudget(file, hash, 'resume')).toThrow();
    budget.reserve('one', 'jev', jev);
    budget.settle('one', null);
    budget.release(true);
    expect(() => new CategoryBudget(file, hash, 'create')).toThrow();
    expect(() => new CategoryBudget(file, hash, 'resume')).toThrow('BUDGET_BINDING');
    expect(JSON.parse(readFileSync(file, 'utf8')).records).toHaveLength(1);
  });
  it('stops before the new Jev cost allowance is crossed, including unknown use', () => {
    const budget = new CategoryBudget(path(), hash, 'create');
    const large = JSON.stringify({
      model: 'jev-1.14.0',
      state: 'x'.repeat(100_000),
      questions: { category: {} },
    });
    for (let i = 0; i < 7; i++) {
      budget.reserve(`unknown:${i}`, 'jev', large);
      budget.settle(`unknown:${i}`, null);
    }
    expect(() => budget.reserve('too-much', 'jev', large)).toThrow('BUDGET_EXHAUSTED');
    expect(budget.snapshot().records).toHaveLength(7);
    budget.release();
  });
  it('counts the request ceiling even when reported token use is zero', () => {
    const budget = new CategoryBudget(path(), hash, 'create');
    for (let i = 0; i < 72; i++) {
      budget.reserve(`call:${i}`, 'gemini', gemini);
      budget.settle(`call:${i}`, { inputTokens: 0, outputTokens: 0 });
    }
    expect(() => budget.reserve('excess', 'gemini', gemini)).toThrow('BUDGET_EXHAUSTED');
    budget.release();
  });
  it('rejects source/price/limit changes and altered accounting on resume', () => {
    const file = path();
    const budget = new CategoryBudget(file, hash, 'create');
    budget.reserve('one', 'gemini', gemini);
    budget.settle('one', { inputTokens: 100, outputTokens: 10 });
    budget.release();
    expect(() => new CategoryBudget(file, 'b'.repeat(64), 'resume')).toThrow('BUDGET_BINDING');
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    ledger.records[0].chargedUsd = '0';
    writeFileSync(file, JSON.stringify(ledger));
    expect(() => new CategoryBudget(file, hash, 'resume')).toThrow('BUDGET_RECORD');
  });
  it('keeps unexpectedly large reported charges and stops subsequent requests', () => {
    const file = path();
    const budget = new CategoryBudget(file, hash, 'create');
    budget.reserve('one', 'gemini', gemini);
    expect(() => budget.settle('one', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toThrow(
      'BUDGET_RESERVATION_EXCEEDED',
    );
    expect(budget.snapshot().records[0].chargedUsd).toBe('2.800000000000');
    expect(() => budget.reserve('two', 'gemini', gemini)).toThrow('BUDGET_EXHAUSTED');
    budget.release();
  });
  it('rejects hidden tools, output increases, model changes and multiple Jev questions', () => {
    const budget = new CategoryBudget(path(), hash, 'create');
    expect(() =>
      budget.reserve(
        'tools',
        'gemini',
        JSON.stringify({ generationConfig: { maxOutputTokens: 256 }, tools: [] }),
      ),
    ).toThrow('BUDGET_OUTPUT_BOUND');
    expect(() =>
      budget.reserve('output', 'gemini', JSON.stringify({ generationConfig: { maxOutputTokens: 1024 } })),
    ).toThrow('BUDGET_OUTPUT_BOUND');
    expect(() =>
      budget.reserve('model', 'jev', JSON.stringify({ model: 'jev-latest', questions: { category: {} } })),
    ).toThrow('BUDGET_MODEL');
    expect(() =>
      budget.reserve(
        'multi',
        'jev',
        JSON.stringify({ model: 'jev-1.14.0', questions: { one: {}, two: {} } }),
      ),
    ).toThrow('BUDGET_QUESTION_BOUND');
    expect(budget.snapshot().records).toEqual([]);
    budget.release();
  });
});
