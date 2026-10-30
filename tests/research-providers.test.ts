import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  decideJevReview,
  fetchTransport,
  GeminiResearchClient,
  JEV_CHECKS,
  JevResearchClient,
  type JevReviewProbabilities,
  type ResearchRequest,
  type ResearchResponse,
  type ResearchTransport,
} from '../research/providers';

const usageMetadata = {
  promptTokenCount: 10,
  candidatesTokenCount: 5,
  thoughtsTokenCount: 2,
  totalTokenCount: 17,
};
function generated(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }],
    modelVersion: 'gemini-3.5-flash-lite-001',
    usageMetadata,
    ...overrides,
  };
}
function mockTransport(...responses: Partial<ResearchResponse>[]) {
  const requests: ResearchRequest[] = [];
  const transport: ResearchTransport = vi.fn(async (request) => {
    requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected additional HTTP request.');
    return { status: 200, json: null, elapsedMs: 23, ...response };
  });
  return { transport, requests };
}
const shape = z.object({ amount: z.string().regex(/^\d+\.\d{2}$/) }).strict();
const prompt = { system: 'Use verified facts only.', prompt: 'What is cash?', schema: shape };
const question = { relevant: { type: 'noul' as const, instructions: 'Is this relevant?' } };
function jevResponse(answers: Record<string, number>, extras: Record<string, unknown> = {}) {
  return {
    model: 'jev-1.14.0',
    answers: Object.fromEntries(Object.entries(answers).map(([key, noul]) => [key, { type: 'noul', noul }])),
    usage: { input_tokens: 100, output_tokens: 4 },
    ...extras,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('research Gemini generation', () => {
  it('uses a single bounded request and validates exact typed output with measured metadata', async () => {
    const mock = mockTransport({ json: generated({ amount: '125.20' }) });
    const result = await new GeminiResearchClient('test-key', mock.transport).generate(prompt);
    expect(result.data.amount).toBe('125.20');
    expect(result.metadata).toMatchObject({
      model: 'gemini-3.5-flash-lite-001',
      elapsedMs: 23,
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 2, totalTokens: 17 },
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      kind: 'generate',
      timeoutMs: 25000,
      headers: { 'x-goog-api-key': 'test-key' },
    });
    expect(mock.requests[0].url).not.toContain('test-key');
  });

  it('retains application array limits even though the provider grammar omits maxima', async () => {
    const schema = z.object({ values: z.array(z.string()).max(2) });
    const mock = mockTransport({ json: generated({ values: ['a', 'b', 'c'] }) });
    await expect(
      new GeminiResearchClient('test', mock.transport).generate({ ...prompt, schema }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(JSON.stringify(mock.requests[0].body)).not.toContain('"maxItems":2');
  });

  it.each([{ amount: 125.2 }, { amount: 'NaN' }, { amount: '10.00', unauthorized: true }])(
    'rejects invalid/extra fields: %j',
    async (data) => {
      const mock = mockTransport({ json: generated(data) });
      await expect(new GeminiResearchClient('test', mock.transport).generate(prompt)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );

  it('never accepts truncated JSON, a hidden tool call, or multiple candidates', async () => {
    for (const candidates of [
      [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"amount":"2.00"}' }] } }],
      [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: '{"amount":"2.00"}', functionCall: { name: 'post' } }] },
        },
      ],
      [generated({ amount: '2.00' }).candidates[0], generated({ amount: '3.00' }).candidates[0]],
    ]) {
      const mock = mockTransport({ json: generated({}, { candidates }) });
      await expect(new GeminiResearchClient('test', mock.transport).generate(prompt)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('keeps unreported usage unknown rather than reporting free requests', async () => {
    const mock = mockTransport({ json: generated({ amount: '2.00' }, { usageMetadata: undefined }) });
    const result = await new GeminiResearchClient('test', mock.transport).generate(prompt);
    expect(result.metadata.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      totalTokens: null,
    });
  });

  it('rejects missing keys and model path injection before I/O', async () => {
    const mock = mockTransport();
    await expect(new GeminiResearchClient('', mock.transport).generate(prompt)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    await expect(
      new GeminiResearchClient('test', mock.transport).generate({ ...prompt, model: '../../secrets' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mock.requests).toHaveLength(0);
  });

  it.each([
    [401, 'AUTH_ERROR'],
    [429, 'RATE_LIMIT'],
    [404, 'MODEL_UNAVAILABLE'],
    [503, 'PROVIDER_ERROR'],
  ])('classifies %s without exposing provider body and without retry', async (status, code) => {
    const mock = mockTransport({
      status: Number(status),
      json: { error: { message: 'secret-test-key-private-prompt' } },
    });
    let thrown: unknown;
    try {
      await new GeminiResearchClient('secret-test-key', mock.transport).generate(prompt);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code });
    expect(String(thrown)).not.toContain('secret');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('Gemini embeddings and managed file search', () => {
  it('pins the embedding model and dimensions, normalizes vectors, and preserves unknown billing', async () => {
    const mock = mockTransport({ json: { embedding: { values: [3, 4] } } });
    const result = await new GeminiResearchClient('test', mock.transport).embed('Laptop budget policy', {
      task: 'RETRIEVAL_DOCUMENT',
      title: 'Policy',
      dimensions: 2,
    });
    expect(result.data).toEqual([0.6, 0.8]);
    expect(result.metadata.usage.inputTokens).toBeNull();
    expect(mock.requests[0].body).toMatchObject({
      model: 'models/gemini-embedding-001',
      outputDimensionality: 2,
      taskType: 'RETRIEVAL_DOCUMENT',
      title: 'Policy',
    });
    expect(mock.requests[0].body).not.toHaveProperty('embedContentConfig');
  });

  it.each([{ values: [0, 0] }, { values: [1] }, { values: [Number.NaN, 1] }])(
    'rejects unusable vectors: %j',
    async ({ values }) => {
      const mock = mockTransport({ json: { embedding: { values } } });
      await expect(
        new GeminiResearchClient('test', mock.transport).embed('Question', { dimensions: 2 }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );

  it('preserves provider grounding text and indices independently of the generated answer', async () => {
    const mock = mockTransport({
      json: generated(
        { amount: '2400.00' },
        {
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: '{"amount":"2400.00"}' }] },
              groundingMetadata: {
                groundingChunks: [
                  {
                    retrievedContext: {
                      title: 'lease-v2',
                      text: 'Monthly rent is USD 2,400.',
                      fileSearchStore: 'fileSearchStores/daybook-123',
                      customMetadata: [{ key: 'document_id', stringValue: 'lease-v2' }],
                    },
                  },
                ],
                groundingSupports: [{ segment: { endIndex: 5 }, groundingChunkIndices: [0] }],
              },
            },
          ],
        },
      ),
    });
    const result = await new GeminiResearchClient('test', mock.transport).generate({
      ...prompt,
      fileSearch: { stores: ['fileSearchStores/daybook-123'], topK: 6 },
    });
    expect(result.grounding.chunks[0].text).toBe('Monthly rent is USD 2,400.');
    expect(result.metadata.kind).toBe('file-search-query');
    expect(mock.requests[0].body).toMatchObject({
      tools: [{ fileSearch: { fileSearchStoreNames: ['fileSearchStores/daybook-123'], topK: 6 } }],
    });
  });

  it('rejects out-of-scope grounding and references to nonexistent chunks', async () => {
    for (const groundingMetadata of [
      {
        groundingChunks: [
          { retrievedContext: { fileSearchStore: 'fileSearchStores/other-tenant', text: 'private' } },
        ],
      },
      {
        groundingChunks: [{ retrievedContext: { text: 'text' } }],
        groundingSupports: [{ segment: { endIndex: 5 }, groundingChunkIndices: [2] }],
      },
    ]) {
      const mock = mockTransport({
        json: generated(
          { amount: '2.00' },
          {
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: '{"amount":"2.00"}' }] },
                groundingMetadata,
              },
            ],
          },
        ),
      });
      await expect(
        new GeminiResearchClient('test', mock.transport).generate({
          ...prompt,
          fileSearch: { stores: ['fileSearchStores/daybook-123'] },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('uploads UTF-8 text in two counted requests then polls an explicit operation', async () => {
    const operation = { name: 'fileSearchStores/daybook-123/upload/operations/op1', done: false };
    const mock = mockTransport(
      {
        headers: {
          'x-goog-upload-url':
            'https://generativelanguage.googleapis.com/upload/v1beta/fileSearchStores/daybook-123?upload_id=abc',
        },
      },
      { json: operation },
      {
        json: {
          ...operation,
          done: true,
          response: { documentName: 'fileSearchStores/daybook-123/documents/doc1' },
        },
      },
    );
    const client = new GeminiResearchClient('test', mock.transport);
    const uploaded = await client.uploadText('fileSearchStores/daybook-123', 'Policy', '€ 100', [
      { key: 'document_id', stringValue: 'policy-1' },
    ]);
    expect(uploaded.metadata).toHaveLength(2);
    expect(mock.requests[1]).toMatchObject({
      rawBody: '€ 100',
      headers: { 'Content-Length': '7', 'X-Goog-Upload-Command': 'upload, finalize' },
    });
    expect(mock.requests[1].body).toBeUndefined();
    const done = await client.pollOperation(uploaded.data.name);
    expect(done.data.done).toBe(true);
    expect(mock.requests[2].method).toBe('GET');
  });

  it('does not forward a key or document to an untrusted upload URL', async () => {
    for (const url of [
      'https://attacker.example/upload',
      'https://generativelanguage.googleapis.com.attacker.example/upload',
      'http://generativelanguage.googleapis.com/upload',
      'https://generativelanguage.googleapis.com/v1beta/foo',
    ]) {
      const mock = mockTransport({ headers: { 'x-goog-upload-url': url } });
      await expect(
        new GeminiResearchClient('test', mock.transport).uploadText(
          'fileSearchStores/daybook-123',
          'Policy',
          'text',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(mock.requests).toHaveLength(1);
    }
  });

  it('surfaces index failures without claiming readiness', async () => {
    const mock = mockTransport({
      json: { name: 'fileSearchStores/daybook-123/operations/op1', done: true, error: { message: 'secret' } },
    });
    await expect(
      new GeminiResearchClient('test', mock.transport).pollOperation(
        'fileSearchStores/daybook-123/operations/op1',
      ),
    ).rejects.toMatchObject({ code: 'INDEX_FAILED' });
  });
});

describe('Gemini Interactions File Search', () => {
  const options = {
    system: 'Search the authorized files and cite source documents.',
    prompt: 'What is the equipment budget?',
    stores: ['fileSearchStores/daybook-123'],
  };
  function interaction(annotations: unknown[] = [], extras: Record<string, unknown> = {}) {
    return {
      status: 'completed',
      model: 'gemini-3.5-flash-lite',
      steps: [
        { type: 'file_search_call', id: 'call-1' },
        {
          type: 'file_search_result',
          call_id: 'call-1',
          result: [{ text: 'Unverified extra result field' }],
        },
        { type: 'model_output', content: [{ type: 'text', text: 'Budget is €500.', annotations }] },
      ],
      usage: { total_input_tokens: 19, total_output_tokens: 8, total_thought_tokens: 2, total_tokens: 29 },
      ...extras,
    };
  }

  it('requests a stateless bounded interaction and preserves only citation selection and usage', async () => {
    const citation = {
      type: 'file_citation',
      file_name: 'policy-equipment | Equipment policy',
      document_uri: 'fileSearchStores/daybook-123/documents/doc1',
      source: 'attribution',
      custom_metadata: { document_id: 'policy-equipment' },
      start_index: 0,
      end_index: Buffer.byteLength('Budget is €500.'),
    };
    const mock = mockTransport({ json: interaction([citation]) });
    const result = await new GeminiResearchClient('private-test-key', mock.transport).searchInteractions(
      options,
    );
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
      timeoutMs: 25000,
      kind: 'file-search-query',
      body: {
        model: 'gemini-3.5-flash-lite',
        store: false,
        input: options.prompt,
        system_instruction: options.system,
        tools: [{ type: 'file_search', file_search_store_names: options.stores, top_k: 6 }],
        generation_config: { max_output_tokens: 1500, thinking_summaries: 'none' },
      },
    });
    expect(result.data).toEqual({
      citations: [citation],
      searchCallCount: 1,
      searchResultCount: 1,
      rawPassagesAvailable: false,
    });
    expect(JSON.stringify(result.data)).not.toContain('Budget is');
    expect(JSON.stringify(result.data)).not.toContain('Unverified extra');
    expect(result.metadata.usage).toEqual({
      inputTokens: 19,
      outputTokens: 8,
      thinkingTokens: 2,
      totalTokens: 29,
    });
  });

  it('accepts documented array metadata without promoting it to authorization', async () => {
    const mock = mockTransport({
      json: interaction([
        {
          type: 'file_citation',
          file_name: 'foreign-record',
          custom_metadata: [{ key: 'document_id', string_value: 'foreign-record' }],
        },
      ]),
    });
    const result = await new GeminiResearchClient('test', mock.transport).searchInteractions(options);
    // The caller must resolve it against its scoped corpus. It is not a trusted document.
    expect(result.data.citations[0].file_name).toBe('foreign-record');
    expect(result.data).not.toHaveProperty('documents');
  });

  it('includes retrieved tool-use prompt tokens exactly once and excludes initial-turn diagnostics', async () => {
    const mock = mockTransport({
      json: interaction([], {
        usage: {
          total_tokens: 1987,
          total_input_tokens: 71,
          total_output_tokens: 45,
          total_tool_use_tokens: 1871,
          total_thought_tokens: 0,
          initial_input_tokens: 378,
        },
      }),
    });
    const result = await new GeminiResearchClient('test', mock.transport).searchInteractions(options);
    expect(result.metadata.usage).toEqual({
      inputTokens: 1942,
      outputTokens: 45,
      thinkingTokens: 0,
      totalTokens: 1987,
    });
    const incomplete = mockTransport({ json: interaction([], { usage: { total_tool_use_tokens: 1871 } }) });
    const unknown = await new GeminiResearchClient('test', incomplete.transport).searchInteractions(options);
    expect(unknown.metadata.usage.inputTokens).toBeNull();
  });

  it('does not invent evidence from an uncited answer or omitted tool steps', async () => {
    const mock = mockTransport({
      json: interaction([], {
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Budget is €500.' }] }],
        usage: undefined,
      }),
    });
    const result = await new GeminiResearchClient('test', mock.transport).searchInteractions(options);
    expect(result.data).toEqual({
      citations: [],
      searchCallCount: 0,
      searchResultCount: 0,
      rawPassagesAvailable: false,
    });
    expect(result.metadata.usage.inputTokens).toBeNull();
  });

  it.each(['incomplete', 'requires_action', 'requires_continuation', 'failed'])(
    'rejects %s instead of continuing or retrying',
    async (status) => {
      const mock = mockTransport({ json: interaction([], { status }) });
      await expect(
        new GeminiResearchClient('test', mock.transport).searchInteractions(options),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(mock.requests).toHaveLength(1);
    },
  );

  it('rejects malformed citation offsets, unmatched result steps, and undeclared tools', async () => {
    const responses = [
      interaction([{ type: 'file_citation', start_index: 20, end_index: 1 }]),
      interaction([], { steps: [{ type: 'file_search_result', call_id: 'missing' }] }),
      interaction([], { steps: [{ type: 'function_call', id: 'post', name: 'postJournal' }] }),
      interaction([], { usage: { total_input_tokens: -1 } }),
    ];
    for (const json of responses) {
      const mock = mockTransport({ json });
      await expect(
        new GeminiResearchClient('test', mock.transport).searchInteractions(options),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('validates trusted store inputs before any network access', async () => {
    const mock = mockTransport();
    for (const stores of [[], ['fileSearchStores/../../foreign'], [options.stores[0], options.stores[0]]]) {
      await expect(
        new GeminiResearchClient('test', mock.transport).searchInteractions({ ...options, stores }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(mock.requests).toHaveLength(0);
  });
});

describe('Jev bounded semantic decisions', () => {
  it('pins Jev and returns real probabilities with measured usage', async () => {
    const mock = mockTransport({ json: jevResponse({ relevant: 0.93 }) });
    const result = await new JevResearchClient('test', mock.transport).noul(
      { question: 'Rent?', text: 'Monthly rent' },
      question,
    );
    expect(result.data).toEqual({ relevant: 0.93 });
    expect(result.metadata).toMatchObject({
      model: 'jev-1.14.0',
      usage: { inputTokens: 100, outputTokens: 4, totalTokens: 104 },
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      timeoutMs: 25000,
      url: 'https://api.typesafe.ai/v1/systemone',
      body: { model: 'jev-1.14.0' },
    });
  });

  it('rejects missing/extra answers, probabilities outside [0,1], and model drift', async () => {
    for (const json of [
      jevResponse({}),
      jevResponse({ relevant: 0.9, extra: 0.8 }),
      jevResponse({ relevant: 1.2 }),
      jevResponse({ relevant: 0.9 }, { model: 'jev-latest' }),
    ]) {
      const mock = mockTransport({ json });
      await expect(
        new JevResearchClient('test', mock.transport).noul('text', question),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('batch-reranks the same candidate set with stable tie order', async () => {
    const mock = mockTransport({
      json: jevResponse({ candidate_0: 0.2, candidate_1: 0.9, candidate_2: 0.9 }),
    });
    const candidates = [
      { id: 'old', text: 'old lease' },
      { id: 'current', text: 'current lease' },
      { id: 'other', text: 'another current lease' },
    ];
    const result = await new JevResearchClient('test', mock.transport).rerank('Current rent?', candidates);
    expect(result.data.map((row) => row.id)).toEqual(['current', 'other', 'old']);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].kind).toBe('jev-rerank');
  });

  it('uses a distinct reviewer request and explicit calibrated thresholds', async () => {
    const probabilities = Object.fromEntries(
      JEV_CHECKS.map((key) => [key, key === 'wrong_currency' ? 0.82 : 0.04]),
    ) as JevReviewProbabilities;
    const mock = mockTransport({ json: jevResponse(probabilities) });
    const result = await new JevResearchClient('test', mock.transport).verify({
      question: 'Cash in USD?',
      answer: 'EUR 100.',
      evidence: [{ id: 'cash', text: 'USD 100.' }],
    });
    expect(mock.requests[0].kind).toBe('jev-verify');
    expect(decideJevReview(result.data, { clarify: 0.35, block: 0.7 })).toEqual({
      decision: 'BLOCK',
      reasons: ['wrong_currency'],
    });
    expect(
      decideJevReview({ ...result.data, wrong_currency: 0.5 }, { clarify: 0.35, block: 0.7 }).decision,
    ).toBe('CLARIFY');
    expect(
      decideJevReview({ ...result.data, wrong_currency: 0.1 }, { clarify: 0.35, block: 0.7 }).decision,
    ).toBe('PASS');
    expect(() => decideJevReview(result.data, { clarify: 0.8, block: 0.7 })).toThrow();
  });

  it('refuses absent keys, empty questions, and excessive context before I/O', async () => {
    const mock = mockTransport();
    await expect(new JevResearchClient('', mock.transport).noul('text', question)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    await expect(new JevResearchClient('test', mock.transport).noul('text', {})).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(
      new JevResearchClient('test', mock.transport).noul('x'.repeat(70000), question),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mock.requests).toHaveLength(0);
  });
});

describe('native transport boundaries', () => {
  const request: ResearchRequest = {
    provider: 'gemini',
    model: 'test',
    kind: 'generate',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent',
    method: 'POST',
    headers: { 'x-goog-api-key': 'test' },
    body: {},
    timeoutMs: 25,
  };
  it('fails closed on arbitrary destinations and does not follow redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchTransport({ ...request, url: 'https://attacker.example' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetch).not.toHaveBeenCalled();
    await fetchTransport(request);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('classifies a timeout safely and attempts exactly once', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('private key data', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetch);
    await expect(fetchTransport(request)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
