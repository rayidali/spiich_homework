import { afterEach, describe, expect, it, vi } from 'vitest';
import * as baseline from '../research/baseline';
import { executeRoute, type RouteEnvironment } from '../research/routes';
import { questions } from '../research/dataset';
import { scoreEpisode, type StudyEpisode } from '../research/scoring';
import { getReference } from '../research/reference';
import type { ResearchDatabase, QueryResult } from '../research/database';
import type { ResearchRequest } from '../research/providers';

const rows = (data: Record<string, unknown>[]): QueryResult => ({
  fields: [],
  rows: data,
  rowCount: data.length,
});
const queryResponse = (name: string, args: unknown) => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name, args } }] } }],
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 50,
    thoughtsTokenCount: 0,
    totalTokenCount: 150,
  },
  modelVersion: 'gemini-3.5-flash-lite',
});
function environment(response: unknown) {
  const db = { execute: vi.fn(async () => rows([])), batch: vi.fn(async () => [rows([])]) };
  const transport = vi.fn(async (_request: ResearchRequest) => ({
    status: 200,
    json: response,
    elapsedMs: 10,
  }));
  const env: RouteEnvironment = {
    db: db as unknown as ResearchDatabase,
    transport,
    geminiKey: 'synthetic-test-key',
    jevKey: 'unused-test-key',
    snapshot: 'frozen-test-snapshot',
  };
  return { env, db, transport };
}
function score(id: string, result: Awaited<ReturnType<typeof executeRoute>>) {
  const question = questions.find((q) => q.id === id)!;
  const episode: StudyEpisode = {
    ...result,
    id: `r0-validation:${id}`,
    route: 'R0',
    questionId: id,
    groupId: question.groupId,
    family: question.family,
    split: question.split,
    repeat: 0,
    status: result.validation.valid ? 'ok' : 'blocked',
    durationMs: 10,
    organizationId: question.organizationId,
  };
  return scoreEpisode(episode, getReference(id));
}
afterEach(() => vi.restoreAllMocks());

describe('R0 shared validation and deterministic evidence adapter', () => {
  it('gives a real baseline proposal its cited user evidence and scores the unchanged lines', async () => {
    const question = questions.find((q) => q.id === 'entry-01-1')!;
    const proposal = {
      action: 'READY',
      description: 'Printer paper and pens',
      date: '2026-10-30',
      counterparty: '',
      reference: '',
      explanation: 'Review supplies paid from Operating bank.',
      questions: [],
      lines: [
        {
          accountId: baseline.baselineAccountId('5030'),
          debit: '340.00',
          credit: '0',
          exchangeRate: '1',
          memo: '',
        },
        {
          accountId: baseline.baselineAccountId('1000'),
          debit: '0',
          credit: '340.00',
          exchangeRate: '1',
          memo: '',
        },
      ],
    };
    const response = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
    };
    const { env, db, transport } = environment(response);
    const result = await executeRoute('R0', question, env);
    expect(result.validation.valid).toBe(true);
    expect(result.answer.behavior).toBe('PROPOSAL');
    expect(result.answer.evidenceIds).toEqual(['user']);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        id: 'user',
        organizationId: question.organizationId,
        text: question.question,
        facts: expect.arrayContaining([expect.objectContaining({ value: '340.00', unit: 'USD' })]),
      }),
    );
    expect(score(question.id, result)).toMatchObject({
      success: true,
      automatedScore: 90,
      unresolvedCitationIds: [],
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1); // bounded history lookup, never a write
    expect(db.batch).not.toHaveBeenCalled();
    expect(result.review).toBeNull();
  });

  it('materializes revenue difference and percentage evidence without another model call', async () => {
    const question = questions.find((q) => q.id === 'financial-02-1')!;
    const { env, db, transport } = environment(
      queryResponse('revenue_comparison', {
        from: '2026-08-01',
        to: '2026-08-31',
        previousFrom: '2026-07-01',
        previousTo: '2026-07-31',
      }),
    );
    db.batch.mockResolvedValue([
      rows([{ label: 'total', value: '35100.00' }]),
      rows([{ label: 'total', value: '30000.00' }]),
    ]);
    const result = await executeRoute('R0', question, env);
    expect(result.validation.valid).toBe(true);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        id: 'calc:revenue_change',
        kind: 'calculation',
        facts: [{ key: 'revenue_change', value: '5100.00', unit: 'USD' }],
      }),
    );
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        id: 'calc:revenue_change_percent',
        kind: 'calculation',
        facts: [{ key: 'revenue_change_percent', value: '17.0', unit: 'percent' }],
      }),
    );
    const graded = score(question.id, result);
    expect(graded.success).toBe(true);
    expect(graded.unresolvedCitationIds).toEqual([]);
    expect(graded.unsupportedFacts).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it('keeps baseline cash/account evidence intact under the shared validation gate', async () => {
    const question = questions.find((q) => q.id === 'financial-01-1')!;
    const { env, db, transport } = environment(queryResponse('cash_position', { asOf: '2026-09-30' }));
    db.batch.mockResolvedValue([
      rows([{ label: 'total', value: '164615.00' }]),
      rows([
        { label: '1000 Operating bank', value: '153615.00' },
        { label: '1010 Euro bank', value: '11000.00' },
      ]),
    ]);
    const result = await executeRoute('R0', question, env);
    expect(result.validation.valid).toBe(true);
    expect(score(question.id, result).success).toBe(true);
    expect(result.evidence.filter((e) => e.kind === 'ledger')).toHaveLength(2);
    expect(result.evidence.filter((e) => e.id === 'user')).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns validation failure for an unsupported R0 candidate so the runner can withhold it', async () => {
    const question = questions.find((q) => q.id === 'financial-01-1')!;
    const { env, db, transport } = environment(queryResponse('cash_position', { asOf: '2026-09-30' }));
    db.batch.mockResolvedValue([rows([{ label: 'total', value: '164615.00' }]), rows([])]);
    const candidate = await baseline.runBaseline({
      question,
      db: env.db,
      transport: env.transport,
      apiKey: env.geminiKey,
      snapshot: env.snapshot,
    });
    candidate.answer.facts[0].value = '999999.00'; // mutate claim after evidence was measured
    vi.spyOn(baseline, 'runBaseline').mockResolvedValue(candidate);
    const result = await executeRoute('R0', question, env);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.reasons).toContain('UNSUPPORTED_NUMERIC_FACT');
    expect(score(question.id, result).success).toBe(false);
    expect(score(question.id, result).failures).toContain('deterministic_validation_failed');
    expect(transport).toHaveBeenCalledTimes(1); // no repair or reviewer request
    expect(result.review).toBeNull();
  });
});
