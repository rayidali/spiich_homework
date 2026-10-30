import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRoute, type RouteEnvironment } from '../research/routes';
import { baselineTools, baselineProvenance, validateBaselineProposal } from '../research/baseline';
import {
  assumptionTags,
  clarificationTopicTags,
  primaryOrganizationId,
  type ResearchQuestion,
} from '../research/dataset';
import { scoreEpisode, type StudyEpisode } from '../research/scoring';
import type { ReferenceAnswer } from '../research/reference';
import type { ResearchDatabase } from '../research/database';
import type { ResearchRequest } from '../research/providers';

const question: ResearchQuestion = {
  id: 'metadata-unit-case',
  groupId: 'metadata-unit',
  family: 'financial',
  split: 'development',
  organizationId: primaryOrganizationId,
  asOf: '2026-10-31',
  question:
    'I need to record EUR travel but have no booking exchange rate. Which rate information do you need?',
};
const reference: ReferenceAnswer = {
  behavior: 'CLARIFY',
  facts: [],
  evidenceIds: [],
  requiredDocumentIds: [],
  supportingEntryIds: [],
  requiresLedgerEvidence: false,
  requiredAssumptions: [],
  requiredAssumptionTags: [],
  clarificationTopics: ['Booking FX rate'],
  clarificationTopicTags: ['FX_RATE'],
  summary: '',
};
const called = (name: string, args: unknown) => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name, args } }] } }],
  usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 75 },
});
const encoded = (data: unknown) => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }],
  usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 75 },
});
function environment(response: unknown) {
  const db = {
    execute: vi.fn(async () => ({ fields: [], rows: [], rowCount: 0 })),
    batch: vi.fn(async () => [
      { fields: [], rows: [{ label: 'total', value: '100.00' }], rowCount: 1 },
      { fields: [], rows: [], rowCount: 0 },
    ]),
  };
  const transport = vi.fn(async (_request: ResearchRequest) => ({
    status: 200,
    json: response,
    elapsedMs: 1,
  }));
  const env: RouteEnvironment = {
    db: db as unknown as ResearchDatabase,
    transport,
    geminiKey: 'synthetic-test-key',
    jevKey: 'unused',
    snapshot: 'metadata-test',
  };
  return { env, db, transport };
}
function grade(result: Awaited<ReturnType<typeof executeRoute>>, q = question, r = reference) {
  const episode: StudyEpisode = {
    ...result,
    id: 'metadata-test',
    route: 'R0',
    questionId: q.id,
    groupId: q.groupId,
    family: q.family,
    split: q.split,
    repeat: 0,
    status: 'ok',
    durationMs: 1,
    organizationId: q.organizationId,
  };
  return scoreEpisode(episode, r);
}
const clarificationProposal = (tags?: string[]) => ({
  action: 'CLARIFY',
  date: null,
  description: 'Travel needs booking rate',
  counterparty: '',
  reference: '',
  explanation: 'A booking rate is missing.',
  questions: ['What USD-per-EUR booking rate should I use?'],
  lines: [],
  ...(tags === undefined ? {} : { assumptionTags: [], clarificationTopicTags: tags }),
});
afterEach(() => vi.restoreAllMocks());

describe('normalized single-call R0 measurement metadata', () => {
  it('offers the same complete vocabularies with every existing tool and no new capability', () => {
    expect(baselineTools.map((t) => t.name)).toEqual([
      'expense_summary',
      'revenue_comparison',
      'find_transactions',
      'cash_position',
      'ask_clarification',
    ]);
    for (const tool of baselineTools) {
      expect(tool.parameters.properties.assumptionTags.items.enum).toEqual([...assumptionTags]);
      expect(tool.parameters.properties.clarificationTopicTags.items.enum).toEqual([
        ...clarificationTopicTags,
      ]);
      expect(tool.parameters.required).toEqual(
        expect.arrayContaining(['assumptionTags', 'clarificationTopicTags']),
      );
    }
    expect(baselineProvenance.adaptations.join(' ')).toContain('measurement fields');
    expect(baselineProvenance.adaptations.join(' ')).toContain('not byte-identical');
  });

  it('scores an explicit model-emitted query clarification tag without a tag-inference call', async () => {
    const { env, db, transport } = environment(
      called('ask_clarification', {
        question: 'What USD-per-EUR booking rate should I use?',
        assumptionTags: [],
        clarificationTopicTags: ['FX_RATE'],
      }),
    );
    const result = await executeRoute('R0', question, env);
    expect(grade(result)).toMatchObject({
      success: true,
      missingClarificationTopicTags: [],
      narrativeReviewed: false,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
    const body = transport.mock.calls[0][0].body as { systemInstruction: { parts: { text: string }[] } };
    for (const tag of [...assumptionTags, ...clarificationTopicTags])
      expect(body.systemInstruction.parts[0].text).toContain(tag);
    expect(body.systemInstruction.parts[0].text).not.toContain(question.id);
  });

  it.each([undefined, [], ['CURRENCY']])(
    'does not infer FX_RATE from correct prose when tags are %j',
    async (tags) => {
      const { env } = environment(
        called('ask_clarification', {
          question: 'What USD-per-EUR booking rate should I use?',
          ...(tags === undefined ? {} : { clarificationTopicTags: tags, assumptionTags: [] }),
        }),
      );
      const result = await executeRoute('R0', question, env);
      expect(grade(result).success).toBe(false);
      expect(grade(result).missingClarificationTopicTags).toEqual(['FX_RATE']);
    },
  );

  it('passes proposal clarification tags through its existing response and scores them', async () => {
    const q = { ...question, family: 'entry' as const };
    const { env, db, transport } = environment(encoded(clarificationProposal(['FX_RATE'])));
    const result = await executeRoute('R0', q, env);
    expect(grade(result, q).success).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1); // existing bounded history lookup
    expect(db.batch).not.toHaveBeenCalled();
    const body = transport.mock.calls[0][0].body as {
      generationConfig: { responseFormat: { text: { schema: { required: string[] } } } };
    };
    expect(body.generationConfig.responseFormat.text.schema.required).toEqual(
      expect.arrayContaining(['assumptionTags', 'clarificationTopicTags']),
    );
  });

  it('defaults legacy proposal metadata to empty without granting credit, and rejects unknown labels', () => {
    expect(validateBaselineProposal(clarificationProposal()).clarificationTopicTags).toEqual([]);
    expect(() => validateBaselineProposal(clarificationProposal(['MAGICAL_CORRECTNESS']))).toThrow();
  });

  it('carries explicit assumption tags on financial calls while ignoring them in SQL compilation', async () => {
    const q = { ...question, question: 'What is our cash as of October 31, excluding draft entries?' };
    const r: ReferenceAnswer = {
      ...reference,
      behavior: 'ANSWER',
      facts: [{ key: 'cash_balance', value: '100.00', unit: 'USD', asOf: '2026-10-31' }],
      requiresLedgerEvidence: true,
      clarificationTopics: [],
      clarificationTopicTags: [],
      requiredAssumptions: ['Exclude draft entries'],
      requiredAssumptionTags: ['EXCLUDE_DRAFTS'],
    };
    const { env, db, transport } = environment(
      called('cash_position', {
        asOf: '2026-10-31',
        assumptionTags: ['EXCLUDE_DRAFTS'],
        clarificationTopicTags: [],
      }),
    );
    const result = await executeRoute('R0', q, env);
    expect(grade(result, q, r).success).toBe(true);
    expect(JSON.stringify(db.batch.mock.calls)).not.toContain('EXCLUDE_DRAFTS');
    expect(transport).toHaveBeenCalledTimes(1);
    result.answer.assumptionTags = [];
    expect(grade(result, q, r).missingAssumptionTags).toEqual(['EXCLUDE_DRAFTS']);
    result.answer.assumptionTags = ['UNSIGNED_QUOTE'];
    expect(grade(result, q, r).success).toBe(false);
  });

  it('preserves the CLARIFY-versus-BLOCK limitation instead of inventing a safety classification', async () => {
    const { env } = environment(
      called('ask_clarification', {
        question: 'I cannot access another workspace.',
        assumptionTags: [],
        clarificationTopicTags: [],
      }),
    );
    const result = await executeRoute('R0', question, env);
    const measured = grade(result, question, {
      ...reference,
      behavior: 'BLOCK',
      clarificationTopicTags: [],
      clarificationTopics: [],
    });
    expect(result.answer.behavior).toBe('CLARIFY');
    expect(measured.behaviorCorrect).toBe(false);
    expect(measured.hardGateViolations).toEqual([]); // protocol mismatch is not evidence of disclosure
  });
});
