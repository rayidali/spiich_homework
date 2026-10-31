import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  baselineAccountId,
  baselineInstructions,
  baselineProvenance,
  baselineTools,
  chooseBaselineTool,
  runBaseline,
  validateBaselineProposal,
  type BaselineInput,
} from '../research/baseline';
import { validateAnswer } from '../research/answer';
import type { ResearchDatabase, QueryResult } from '../research/database';
import { primaryOrganizationId } from '../research/dataset';
import type { ResearchRequest, ResearchTransport } from '../research/providers';

function result(rows: Record<string, unknown>[]): QueryResult {
  return { fields: [], rows, rowCount: rows.length };
}
function inputFor(response: unknown) {
  const requests: ResearchRequest[] = [];
  const transport: ResearchTransport = vi.fn(async (request) => {
    requests.push(request);
    return { status: 200, json: response, elapsedMs: 30 };
  });
  const db = {
    execute: vi.fn(async (_sql: string, _params?: unknown[]) => result([])),
    batch: vi.fn(async (_queries: { query: string; params: unknown[] }[]) => [result([])]),
  };
  const input: BaselineInput = {
    question: {
      id: 'unit-case',
      groupId: 'unit',
      split: 'development',
      family: 'financial',
      question: 'What is my cash as of October 1, 2026?',
      organizationId: primaryOrganizationId,
      asOf: '2026-10-30',
    },
    db: db as unknown as ResearchDatabase,
    transport,
    apiKey: 'test-key',
    snapshot: 'frozen-fixture',
  };
  return { input, requests, db };
}
const usageMetadata = {
  promptTokenCount: 100,
  candidatesTokenCount: 20,
  thoughtsTokenCount: 5,
  totalTokenCount: 125,
};
function called(name: string, args: unknown) {
  return {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name, args } }] } }],
    usageMetadata,
    modelVersion: 'gemini-3.5-flash-lite',
  };
}
const proposal = () => ({
  action: 'READY',
  description: 'Office supplies paid by company credit card',
  date: '2026-10-30',
  counterparty: 'Office Supply',
  reference: '',
  explanation: 'Review the debit to supplies and credit to the company card.',
  questions: [],
  lines: [
    { accountId: baselineAccountId('5030'), debit: '340.00', credit: '0', exchangeRate: '1', memo: '' },
    { accountId: baselineAccountId('2100'), debit: '0', credit: '340.00', exchangeRate: '1', memo: '' },
  ],
});

describe('R0 control provenance and boundaries', () => {
  it('pins the historical production snapshots rather than requiring the current product to stay frozen', () => {
    const directory = 'tests/fixtures/r0-production-source';
    const origin = JSON.parse(readFileSync(`${directory}/origin.json`, 'utf8'));
    expect(origin.sourceRepository).toBe('https://github.com/rayidali/spiich_homework');
    expect(origin.sourceCommit).toBe(baselineProvenance.sourceCommit);
    const sources = {
      'server/ai.ts': baselineProvenance.aiSourceSha256,
      'server/ai-provider.ts': baselineProvenance.providerSourceSha256,
    };
    expect(Object.keys(origin.files).sort()).toEqual(Object.keys(sources).sort());
    for (const [source, expectedHash] of Object.entries(sources)) {
      const provenance = origin.files[source];
      expect(provenance.snapshot).toBe(`${source}.txt`);
      const snapshot = readFileSync(`${directory}/${source}.txt`);
      expect(createHash('sha256').update(snapshot).digest('hex')).toBe(expectedHash);
      expect(provenance.sha256).toBe(expectedHash);
      expect(createHash('sha1').update(`blob ${snapshot.length}\0`).update(snapshot).digest('hex')).toBe(
        provenance.gitBlobSha1,
      );
    }
    expect(readFileSync('research/baseline.ts', 'utf8')).not.toMatch(/from\s+['"][^'"]*reference['"]/);
  });

  it('makes one native function-calling request with only the original four query tools and clarification', async () => {
    const { input, requests } = inputFor(called('cash_position', { asOf: '2026-10-01' }));
    const chosen = await chooseBaselineTool(input);
    expect(chosen).toMatchObject({
      name: 'cash_position',
      args: { asOf: '2026-10-01' },
      metadata: { usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 5, totalTokens: 125 } },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ timeoutMs: 25000, model: 'gemini-3.5-flash-lite', kind: 'generate' });
    const body = requests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: input.question.question }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2000, candidateCount: 1 },
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [
            'expense_summary',
            'revenue_comparison',
            'find_transactions',
            'cash_position',
            'ask_clarification',
          ],
        },
      },
    });
    expect(baselineTools).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain(input.question.id);
    expect(JSON.stringify(body)).not.toContain('fileSearch');
    expect(baselineInstructions('2026-10-30')).toContain('Never write SQL or invent amounts');
  });

  it.each([
    called('execute_sql', { sql: 'DELETE FROM ledger' }),
    called('cash_position', { asOf: '2026-02-30' }),
    called('cash_position', { asOf: '2026-10-01', organizationId: 'other' }),
    called('expense_summary', { from: '2026-10-31', to: '2026-10-01' }),
    {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { functionCall: { name: 'cash_position', args: { asOf: '2026-10-01' } } },
              { functionCall: { name: 'cash_position', args: { asOf: '2026-10-02' } } },
            ],
          },
        },
      ],
    },
  ])('rejects invalid tool selections without executing a database query', async (response) => {
    const { input, db, requests } = inputFor(response);
    await expect(runBaseline(input)).rejects.toThrow('INVALID_RESPONSE');
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it('rejects another workspace before contacting either provider or database', async () => {
    const { input, db, requests } = inputFor(called('cash_position', { asOf: '2026-10-01' }));
    input.question.organizationId = '22222222-2222-4222-8222-222222222222';
    await expect(runBaseline(input)).rejects.toThrow('RESEARCH_SCOPE_MISMATCH');
    expect(requests).toHaveLength(0);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('preserves clarification without a fabricated answer, tag inference call or extra SQL', async () => {
    const { input, db, requests } = inputFor(
      called('ask_clarification', { question: 'What salary and planning period should I use?' }),
    );
    const response = await runBaseline(input);
    expect(response.answer).toMatchObject({
      behavior: 'CLARIFY',
      facts: [],
      clarificationTopicTags: [],
      clarificationTopics: ['What salary and planning period should I use?'],
    });
    expect(requests).toHaveLength(1);
    expect(db.batch).not.toHaveBeenCalled();
  });
});

describe('R0 figures come from trusted calculations', () => {
  it('preserves large exact decimal cash and independent account evidence', async () => {
    const { input, db } = inputFor(called('cash_position', { asOf: '2026-10-01' }));
    db.batch.mockResolvedValueOnce([
      result([{ label: 'total', value: '900719925474099.91' }]),
      result([
        { label: '1000 Operating bank', value: '900719925474000.00' },
        { label: '1010 Euro bank', value: '99.91' },
      ]),
    ]);
    const response = await runBaseline(input);
    expect(response.answer.facts[0]).toMatchObject({
      key: 'cash_balance',
      value: '900719925474099.91',
      asOf: '2026-10-01',
    });
    expect(response.answer.summary).toContain('$900,719,925,474,099.91');
    expect(db.batch.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ params: ['2026-10-01'] })]),
    );
    expect(validateAnswer(response.answer, input.question, response.evidence).valid).toBe(true);
  });

  it('reports total expenses separately from the five displayed categories', async () => {
    const { input, db } = inputFor(called('expense_summary', { from: '2026-09-01', to: '2026-09-30' }));
    db.batch.mockResolvedValueOnce([
      result([{ label: 'total', value: '12500.99' }]),
      result([{ label: '5000 Rent', value: '2400.00' }]),
    ]);
    const response = await runBaseline(input);
    expect(response.answer.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'expenses', value: '12500.99' }),
        expect.objectContaining({ key: 'expense_total', value: '2400.00', entity: 'Rent' }),
      ]),
    );
    expect(validateAnswer(response.answer, input.question, response.evidence).valid).toBe(true);
  });

  it('computes percentage change with decimal math and retains both periods', async () => {
    const { input, db } = inputFor(
      called('revenue_comparison', {
        from: '2026-09-01',
        to: '2026-09-30',
        previousFrom: '2026-08-01',
        previousTo: '2026-08-31',
      }),
    );
    db.batch.mockResolvedValueOnce([
      result([{ label: 'total', value: '120.12' }]),
      result([{ label: 'total', value: '100.10' }]),
    ]);
    const response = await runBaseline(input);
    expect(response.answer.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'revenue', value: '120.12', from: '2026-09-01' }),
        expect.objectContaining({ key: 'revenue', value: '100.10', from: '2026-08-01' }),
        expect.objectContaining({ key: 'revenue_change', value: '20.02' }),
        expect.objectContaining({ key: 'revenue_change_percent', value: '20.0', unit: 'percent' }),
      ]),
    );
    expect(validateAnswer(response.answer, input.question, response.evidence).valid).toBe(true);
  });

  it('does not divide by zero or pretend negative prior revenue has meaningful growth', async () => {
    const { input, db } = inputFor(
      called('revenue_comparison', {
        from: '2026-09-01',
        to: '2026-09-30',
        previousFrom: '2026-08-01',
        previousTo: '2026-08-31',
      }),
    );
    db.batch.mockResolvedValueOnce([
      result([{ label: 'total', value: '100.00' }]),
      result([{ label: 'total', value: '0.00' }]),
    ]);
    const response = await runBaseline(input);
    expect(response.answer.summary).toContain('not meaningful');
    expect(response.answer.facts.some((f) => f.unit === 'percent')).toBe(false);
  });

  it('keeps search text as a parameter and distinguishes journal totals from revenue', async () => {
    const search = "Acme' OR true--";
    const { input, db } = inputFor(
      called('find_transactions', { search, from: '2026-01-01', to: '2026-10-30' }),
    );
    db.batch.mockResolvedValueOnce([
      result([
        { entry_id: 'invoice', date: '2026-09-01', description: 'Invoice', vendor: 'Acme', value: '500.00' },
      ]),
    ]);
    const response = await runBaseline(input);
    const queries = db.batch.mock.calls[0][0] as { query: string; params: unknown[] }[];
    expect(queries[0].query).not.toContain(search);
    expect(queries[0].params).toContain(search);
    expect(response.answer.summary).toContain('not necessarily revenue or cash movements');
    expect(response.answer.facts[0]).toMatchObject({ key: 'matching_entries', value: '1', unit: 'count' });
    expect(validateAnswer(response.answer, input.question, response.evidence).valid).toBe(true);
  });
});

describe('R0 proposal safety', () => {
  it('maps valid chart UUIDs back to fixture codes and never posts', () => {
    const response = validateBaselineProposal(proposal());
    expect(response).toMatchObject({
      behavior: 'PROPOSAL',
      proposalLines: [
        { accountCode: '5030', debit: '340.00', credit: '0.00', currency: 'USD', exchangeRate: '1' },
        { accountCode: '2100', debit: '0.00', credit: '340.00', currency: 'USD', exchangeRate: '1' },
      ],
    });
  });

  it.each([
    'unbalanced',
    'unknown-account',
    'both-sides',
    'usd-rate',
    'too-precise',
    'zero-rate',
    'ready-and-question',
  ])('rejects %s proposals', (failure) => {
    const value = proposal();
    if (failure === 'unbalanced') value.lines[1].credit = '339.99';
    if (failure === 'unknown-account') value.lines[0].accountId = '33333333-3333-4333-8333-333333333333';
    if (failure === 'both-sides') value.lines[0].credit = '1';
    if (failure === 'usd-rate') value.lines[0].exchangeRate = '1.1';
    if (failure === 'too-precise') value.lines[0].debit = '340.001';
    if (failure === 'zero-rate') value.lines[0].exchangeRate = '0';
    if (failure === 'ready-and-question') (value.questions as string[]).push('Which card?');
    expect(() => validateBaselineProposal(value)).toThrow();
  });

  it('requires clarification text and enforces the original 100-line cap', () => {
    expect(() =>
      validateBaselineProposal({ ...proposal(), action: 'CLARIFY', questions: [], lines: [] }),
    ).toThrow();
    expect(() =>
      validateBaselineProposal({
        ...proposal(),
        lines: Array.from({ length: 101 }, () => proposal().lines[0]),
      }),
    ).toThrow();
  });

  it('uses schema-constrained output for entry UI tasks with scoped history and no gold/document context', async () => {
    const { input, requests, db } = inputFor({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal()) }] } }],
      usageMetadata,
    });
    input.question.family = 'entry';
    input.question.question = 'Bought office supplies for $340 with the company credit card';
    const response = await runBaseline(input);
    expect(response.answer.behavior).toBe('PROPOSAL');
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.batch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    const body = requests[0].body as {
      systemInstruction: { parts: { text: string }[] };
      generationConfig: { responseFormat: unknown };
    };
    expect(body.systemInstruction.parts[0].text).toContain('CONFIRMED CORRECTIONS: []');
    expect(body.systemInstruction.parts[0].text).toContain('HISTORY: []');
    expect(body.systemInstruction.parts[0].text).toContain('Never invent exchange rates');
    expect(body.generationConfig.responseFormat).toMatchObject({ text: { mimeType: 'APPLICATION_JSON' } });
    expect(response.selectedTool.name).toBe('entry_proposal');
  });
});
