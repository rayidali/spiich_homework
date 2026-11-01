import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnostic, safeSchemaIssues, withRequestContext, type RequestContext } from '../server/diagnostics';
import { answerContractSchema, outputBindingsSchema } from '../server/answer-contract';

const secret = 'PRIVATE_ANSWER_QUOTE_AND_OUTPUT_ID_DO_NOT_LOG';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const context = (requestId = firstId): RequestContext => ({
  requestId,
  method: 'POST',
  route: () => '/api/ai/chat',
});
const records = () => vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(String(line)));
const allLogs = () =>
  JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40));
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_completiontest');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Completion diagnostics without question or contract contents', () => {
  it.each([
    ['fulfilled', 'INVALID_ANSWER_CONTRACT', 8, 0, 0],
    ['partial', 'INVALID_ANSWER_BINDING', 2, 3, 1],
    ['unassessed', 'ANSWER_INCOMPLETE', 0, 8, 0],
  ] as const)(
    'correlates safe %s status and bounded counts with the server request',
    (completionStatus, code, fulfilledOutputs, missingOutputs, invalidOutputs) => {
      withRequestContext(context(), () =>
        diagnostic('ai_answer_completion', {
          completionStatus,
          code,
          fulfilledOutputs,
          missingOutputs,
          invalidOutputs,
          generatedCalculationCount: 2,
        }),
      );
      expect(records()).toEqual([
        {
          event: 'ai_answer_completion',
          timestamp: expect.any(String),
          deploymentRevision: 'a'.repeat(40),
          deploymentId: 'dpl_completiontest',
          requestId: firstId,
          method: 'POST',
          route: '/api/ai/chat',
          code,
          completionStatus,
          fulfilledOutputs,
          missingOutputs,
          invalidOutputs,
          generatedCalculationCount: 2,
        },
      ]);
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it('ignores unsolicited business text, output IDs and complete contracts instead of spreading fields', () => {
    const fields = {
      completionStatus: 'partial',
      fulfilledOutputs: 1,
      missingOutputs: 1,
      invalidOutputs: 0,
      outputIds: [secret],
      answerContract: { outputs: [{ id: secret }] },
      outputBindings: [{ outputId: secret }],
      sourceQuotes: [{ quote: secret }],
      userMessage: secret,
      error: new Error(secret),
      labels: [secret],
      reason: secret,
    };
    diagnostic('ai_answer_completion', fields as Parameters<typeof diagnostic>[1], context());
    expect(records()[0]).toMatchObject({
      completionStatus: 'partial',
      fulfilledOutputs: 1,
      missingOutputs: 1,
      invalidOutputs: 0,
    });
    for (const key of [
      'outputIds',
      'answerContract',
      'outputBindings',
      'sourceQuotes',
      'userMessage',
      'error',
      'labels',
      'reason',
    ])
      expect(records()[0]).not.toHaveProperty(key);
    expect(allLogs()).not.toContain(secret);
  });

  it.each([-1, 9, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '2', null, { value: secret }])(
    'omits invalid output counts rather than clamping or coercing them: %j',
    (value) => {
      diagnostic('ai_answer_completion', {
        completionStatus: 'partial',
        fulfilledOutputs: value,
        missingOutputs: value,
        invalidOutputs: value,
        generatedCalculationCount: value,
      } as Parameters<typeof diagnostic>[1]);
      expect(records()[0]).toHaveProperty('completionStatus', 'partial');
      for (const key of ['fulfilledOutputs', 'missingOutputs', 'invalidOutputs', 'generatedCalculationCount'])
        expect(records()[0]).not.toHaveProperty(key);
      expect(allLogs()).not.toContain(secret);
    },
  );

  it('omits an arbitrary status and converts an unknown error code without logging either string', () => {
    diagnostic('ai_answer_completion', { completionStatus: secret, code: secret } as unknown as Parameters<
      typeof diagnostic
    >[1]);
    expect(records()[0]).not.toHaveProperty('completionStatus');
    expect(records()[0].code).toBe('UNKNOWN_ERROR');
    expect(allLogs()).not.toContain(secret);
  });

  it('keeps concurrent completion events attached to their own request context', async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all([
      withRequestContext(context(firstId), async () => {
        await paused;
        diagnostic('ai_answer_completion', { completionStatus: 'fulfilled', fulfilledOutputs: 2 });
      }),
      withRequestContext(context(secondId), async () => {
        diagnostic('ai_answer_completion', { completionStatus: 'partial', missingOutputs: 1 });
        release();
      }),
    ]);
    expect(records().map((row) => [row.requestId, row.completionStatus])).toEqual([
      [secondId, 'partial'],
      [firstId, 'fulfilled'],
    ]);
    diagnostic('ai_answer_completion', { completionStatus: 'unassessed' });
    expect(records().at(-1)).not.toHaveProperty('requestId');
  });

  it('retains real contract and binding error paths without serializing rejected values', () => {
    const contract = answerContractSchema.safeParse({
      outputs: [
        {
          id: 'one',
          sourceQuotes: [{ messageIndex: 0, quote: 123 }],
          requirement: {
            kind: 'arithmetic',
            operation: 'add',
            operands: [
              { source: 'output', id: 'first' },
              { source: 'output', id: 'second' },
            ],
          },
        },
      ],
    });
    const bindings = outputBindingsSchema.safeParse([
      { outputId: 'one', source: { kind: 'calculation', calculationId: secret } },
    ]);
    expect(contract.success).toBe(false);
    expect(bindings.success).toBe(false);
    if (contract.success || bindings.success) throw new Error('Expected schema failures');
    diagnostic('ai_schema_validation', {
      issues: [
        ...contract.error.issues.map((issue) => ({
          code: issue.code,
          path: ['answerContract', ...issue.path] as (string | number)[],
        })),
        ...bindings.error.issues.map((issue) => ({
          code: issue.code,
          path: ['outputBindings', ...issue.path] as (string | number)[],
        })),
      ],
    });
    const entry = JSON.parse(String(vi.mocked(console.error).mock.calls[0][0]));
    expect(entry.issues).toEqual([
      { code: 'invalid_type', path: ['answerContract', 'outputs', 0, 'sourceQuotes', 0, 'quote'] },
      { code: 'invalid_format', path: ['outputBindings', 0, 'source', 'calculationId'] },
    ]);
    expect(allLogs()).not.toContain(secret);
  });

  it('keeps only fixed contract schema words and preserves existing path and issue caps', () => {
    const keys = [
      'answerContract',
      'outputBindings',
      'outputs',
      'sourceQuotes',
      'messageIndex',
      'quote',
      'requirement',
      'kind',
      'scope',
      'counterpartyFrom',
      'query',
      'coverage',
      'tiePolicy',
      'outputId',
      'queryId',
      'calculationId',
    ];
    for (const key of keys)
      expect(safeSchemaIssues([{ code: 'invalid_type', path: [key] }])).toEqual([
        { code: 'invalid_type', path: [key] },
      ]);
    const issue = {
      code: secret,
      path: [
        'answerContract',
        'outputs',
        0,
        secret,
        -1,
        1001,
        1.2,
        Symbol(secret),
        ...Array(10).fill('quote'),
      ],
    };
    const safe = safeSchemaIssues(Array(30).fill(issue));
    expect(safe).toHaveLength(12);
    expect(safe[0]).toEqual({
      code: 'invalid_type',
      path: ['answerContract', 'outputs', 0, '?', '?', '?', '?', '?', 'quote', 'quote', 'quote', 'quote'],
    });
    expect(JSON.stringify(safe)).not.toContain(secret);
  });
});
