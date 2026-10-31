import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRoute, routes, type RouteEnvironment } from '../research/routes';
import {
  GeminiResearchClient,
  JevResearchClient,
  GENERATION_MODEL,
  type ProviderMetadata,
  type ResearchRequest,
} from '../research/providers';
import { DocumentRetriever } from '../research/retrieval';
import { ResearchDatabase } from '../research/database';
import type { HttpRequest } from '../research/io';
import { questions, documents } from '../research/dataset';
import * as wren from '../research/wren/client';
import type { AnalyticalQuery } from '../research/analytics';
import { EpisodeLimits } from '../research/limits';

const metadata = (kind: ProviderMetadata['kind'] = 'generate'): ProviderMetadata => ({
  provider: kind.startsWith('jev') ? 'jev' : 'gemini',
  requestedModel: kind.startsWith('jev') ? 'jev-1.14.0' : GENERATION_MODEL,
  model: kind.startsWith('jev') ? 'jev-1.14.0' : GENERATION_MODEL,
  kind,
  elapsedMs: 10,
  usage: { inputTokens: 20, outputTokens: 30, thinkingTokens: 0, totalTokens: 50 },
});
const cashPlan: AnalyticalQuery = {
  id: 'cash',
  metric: 'cash_balance',
  from: null,
  to: '2026-09-30',
  groupBy: 'none',
  accountCodes: [],
  search: '',
  limit: 100,
  order: 'value_desc',
};
const planner = (overrides: Record<string, unknown> = {}) => ({
  intent: 'ANSWER',
  queries: [cashPlan],
  sqlQueries: [],
  retrievalQuery: '',
  clarification: '',
  ...overrides,
});
const candidate = (overrides: Record<string, unknown> = {}) => ({
  behavior: 'ANSWER',
  summary: 'The verified cash balance is USD 10.00.',
  facts: [
    {
      key: 'cash_balance',
      value: '10.00',
      unit: 'USD',
      evidenceIds: ['query:cash'],
      entity: null,
      from: null,
      to: null,
      asOf: '2026-09-30',
    },
  ],
  evidenceIds: ['query:cash'],
  assumptions: [],
  assumptionTags: [],
  clarificationTopics: [],
  clarificationTopicTags: [],
  proposalLines: [],
  calculations: [],
  ...overrides,
});
const doc = { ...documents.find((d) => d.id === 'reserve-policy')!, rank: 1, retrievalScore: 1 };
function environment(rows: Record<string, unknown>[] = [{ label: 'total', value: '10.00' }]) {
  const http = vi.fn(async (_request: HttpRequest) => ({
    status: 200,
    json: { results: [{ fields: [], rows, rowCount: rows.length }] },
    elapsedMs: 5,
  }));
  const db = new ResearchDatabase(
    'postgresql://reader:synthetic-password@ep-route-test.us-east-1.aws.neon.tech/research',
    http,
  );
  const transport = vi.fn(async (_request: ResearchRequest) => {
    throw new Error('UNEXPECTED_REAL_PROVIDER_REQUEST');
  });
  const env: RouteEnvironment = {
    db,
    transport,
    geminiKey: 'synthetic-gemini-key',
    jevKey: 'synthetic-jev-key',
    snapshot: 'immutable-fixture-snapshot',
    store: 'fileSearchStores/synthetic-store',
  };
  return { env, http, transport };
}
function scriptedGeneration(
  plan: unknown,
  draft: unknown,
  critic: unknown = { decision: 'PASS', reasons: [], evidenceIds: ['query:cash'] },
) {
  let calls = 0;
  const inputs: { system: string; prompt: string; kind?: string; model?: string }[] = [];
  const generate = vi
    .spyOn(GeminiResearchClient.prototype, 'generate')
    .mockImplementation(async (options) => {
      inputs.push(options);
      const data = options.kind === 'critic' ? critic : ++calls === 1 ? plan : draft;
      return {
        data,
        metadata: metadata(options.kind ?? 'generate'),
        grounding: { chunks: [], supports: [] },
      } as never;
    });
  return { generate, inputs };
}
function mockWren(
  columnUnits: Record<string, 'USD' | 'count' | 'native' | 'unsupported'> = { value: 'USD' },
  rowScope:
    | { provenance: 'ast-scope-v1'; supported: true; from: string | null; toExclusive: string | null }
    | { provenance: 'ast-scope-v1'; supported: false } = {
    provenance: 'ast-scope-v1',
    supported: true,
    from: null,
    toExclusive: '2026-10-01',
  },
) {
  return vi.spyOn(wren, 'planWithWren').mockResolvedValue({
    ok: true,
    id: 'daybook',
    engine: 'wren-core-py',
    engineVersion: '0.8.2',
    sqlglotVersion: '30.27.0',
    plannedSql:
      "SELECT sum(base_debit-base_credit)::text AS value FROM research.scoped_ledger WHERE is_cash AND date <= '2026-09-30'",
    inputSha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
    planningMs: 2,
    maxRows: 100,
    columnUnits,
    rowScope,
  });
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe('declared route components and provider-visible context', () => {
  it('declares nine independently controlled routes with R4 as the R5–R8 reference', () => {
    expect(Object.keys(routes)).toHaveLength(9);
    expect(routes.R5.query).toBe(routes.R4.query);
    expect(routes.R5.review).toBe('none');
    expect(routes.R6.retrieval).toBe(routes.R4.retrieval);
    expect(routes.R6.review).toBe('none');
    for (const id of ['R7', 'R8'] as const) {
      expect(routes[id].query).toBe(routes.R4.query);
      expect(routes[id].retrieval).toBe(routes.R4.retrieval);
    }
  });
  it('uses the same generator for planner and draft and never passes hidden gold labels or credentials', async () => {
    const { env, transport } = environment();
    const { inputs, generate } = scriptedGeneration(planner(), candidate());
    const enriched = {
      ...questions[0],
      goldAnswer: 'GOLD_MUST_NOT_LEAK',
      expected: { amount: 'GOLD_MUST_NOT_LEAK' },
    };
    const result = await executeRoute('R1', enriched, env);
    expect(generate).toHaveBeenCalledTimes(2);
    expect('validation' in result && result.validation.valid).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    for (const input of inputs) {
      expect(input.model ?? GENERATION_MODEL).toBe('gemini-3.5-flash-lite');
      expect(input.prompt).not.toContain('GOLD_MUST_NOT_LEAK');
      expect(input.prompt).not.toContain('synthetic-gemini-key');
      expect(input.prompt).not.toContain('synthetic-password');
      expect(input.prompt).not.toContain('"split"');
      expect(input.prompt).not.toContain('"groupId"');
    }
  });
  it.each([
    ['R2', 'lexical'],
    ['R3', 'managed'],
    ['R4', 'hybrid'],
    ['R5', 'rerank'],
  ] as const)('%s selects only its declared retrieval component', async (route, kind) => {
    const { env } = environment();
    const retriever = vi.spyOn(DocumentRetriever.prototype, 'retrieve').mockResolvedValue([doc]);
    const verifier = vi.spyOn(JevResearchClient.prototype, 'verify');
    scriptedGeneration(planner({ retrievalQuery: 'reserve policy' }), candidate());
    const result = await executeRoute(route, questions[0], env);
    expect(retriever).toHaveBeenCalledExactlyOnceWith('reserve policy', kind);
    expect(verifier).not.toHaveBeenCalled();
    expect('retrievedIds' in result && result.retrievedIds).toEqual(['reserve-policy']);
  });
  it('does not accidentally give R1 documents even when a model asks to retrieve', async () => {
    const { env } = environment();
    const retriever = vi.spyOn(DocumentRetriever.prototype, 'retrieve');
    scriptedGeneration(planner({ retrievalQuery: 'private data' }), candidate());
    await executeRoute('R1', questions[0], env);
    expect(retriever).not.toHaveBeenCalled();
  });
});

describe('execution gates and semantic review wiring', () => {
  it('rejects a foreign workspace before any provider or database operation', async () => {
    const { env, http, transport } = environment();
    const generate = vi.spyOn(GeminiResearchClient.prototype, 'generate');
    await expect(
      executeRoute('R1', { ...questions[0], organizationId: '22222222-2222-4222-8222-222222222222' }, env),
    ).rejects.toThrow(/UNAUTHORIZED_WORKSPACE/);
    expect(generate).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects the wrong query backend before SQL execution', async () => {
    const { env, http } = environment();
    const wrenPlan = mockWren();
    scriptedGeneration(planner({ queries: [], sqlQueries: [{ id: 'cash', sql: 'SELECT 1' }] }), candidate());
    await expect(executeRoute('R1', questions[0], env)).rejects.toThrow(/WRONG_BACKEND/);
    expect(http).not.toHaveBeenCalled();
    expect(wrenPlan).not.toHaveBeenCalled();
  });
  it('does not call a semantic reviewer when mandatory arithmetic/provenance validation fails', async () => {
    const { env } = environment();
    const bad = candidate();
    (bad.facts as { value: string }[])[0].value = '99999.00';
    const { inputs } = scriptedGeneration(planner(), bad);
    const jev = vi.spyOn(JevResearchClient.prototype, 'verify');
    const result = await executeRoute('R7', questions[0], env);
    expect('validation' in result && result.validation.valid).toBe(false);
    expect(inputs.filter((input) => input.kind === 'critic')).toHaveLength(0);
    expect(jev).not.toHaveBeenCalled();
  });
  it('R7 actually calls the critic with evidence and returns its blocking decision', async () => {
    const { env } = environment();
    const { inputs } = scriptedGeneration(planner(), candidate(), {
      decision: 'BLOCK',
      reasons: ['Wrong reporting period.'],
      evidenceIds: ['query:cash'],
    });
    const result = await executeRoute('R7', questions[0], env);
    const critic = inputs.find((input) => input.kind === 'critic');
    expect(critic?.model).toBe('gemini-3.5-flash-lite');
    expect(critic?.prompt).toContain('query:cash');
    expect(critic?.prompt).toContain('immutable-fixture-snapshot');
    expect(critic?.prompt).not.toContain('expected');
    expect('review' in result && (result.review as { data: { decision: string } }).data.decision).toBe(
      'BLOCK',
    );
  });
  it('R8 really calls Jev verification, with calibrated-threshold decisions separate from reranking', async () => {
    const { env } = environment();
    env.jevThreshold = 0.8;
    scriptedGeneration(planner(), candidate());
    const verify = vi.spyOn(JevResearchClient.prototype, 'verify').mockResolvedValue({
      data: {
        unsupported_claim: 0.95,
        wrong_scope: 0.01,
        wrong_period: 0.01,
        wrong_currency: 0.01,
        missing_assumption: 0.01,
        injected_instruction: 0.01,
        nonresponsive: 0.01,
      },
      metadata: metadata('jev-verify'),
    });
    const rerank = vi.spyOn(JevResearchClient.prototype, 'rerank');
    const result = await executeRoute('R8', questions[0], env);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rerank).not.toHaveBeenCalled();
    expect('review' in result && (result.review as { decision: string }).decision).toBe('BLOCK');
  });
  it('rejects any result completed after the full episode deadline, including a slow final critic', async () => {
    const { env } = environment();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let generation = 0;
    vi.spyOn(GeminiResearchClient.prototype, 'generate').mockImplementation(async (options) => {
      generation++;
      if (generation === 1) {
        now = 10000;
        return { data: planner(), metadata: metadata(), grounding: { chunks: [], supports: [] } } as never;
      }
      if (options.kind === 'critic') {
        now = 70000;
        return {
          data: { decision: 'PASS', reasons: [], evidenceIds: [] },
          metadata: metadata('critic'),
          grounding: { chunks: [], supports: [] },
        } as never;
      }
      now = 50000;
      return { data: candidate(), metadata: metadata(), grounding: { chunks: [], supports: [] } } as never;
    });
    await expect(executeRoute('R7', questions[0], env)).rejects.toThrow(/DEADLINE/);
  });
});

describe('Wren evidence must be typed rather than guessed from arbitrary numeric columns', () => {
  it('sends actual planned SQL from the Wren engine to the restricted database', async () => {
    const { env, http } = environment();
    const compile = mockWren();
    scriptedGeneration(
      planner({
        queries: [],
        sqlQueries: [
          {
            id: 'cash',
            sql: "SELECT SUM(net_debit) AS value FROM ledger WHERE is_cash AND date <= '2026-09-30'",
          },
        ],
      }),
      candidate(),
    );
    const result = await executeRoute('R6', questions[0], env);
    expect(compile).toHaveBeenCalledTimes(1);
    const request = http.mock.calls[0]?.[0] as unknown as { body: { queries: { query: string }[] } };
    expect(request.body.queries[0].query).toContain('research.scoped_ledger');
    expect('validation' in result && result.validation.valid).toBe(true);
  });
  it('rejects duplicate Wren query IDs before they can create colliding evidence references', async () => {
    const { env, http } = environment();
    mockWren();
    scriptedGeneration(
      planner({
        queries: [],
        sqlQueries: [
          { id: 'cash', sql: 'SELECT 1 AS value FROM ledger' },
          { id: 'cash', sql: 'SELECT 2 AS value FROM ledger' },
        ],
      }),
      candidate(),
    );
    await expect(executeRoute('R6', questions[0], env)).rejects.toThrow(/QUERY_BUDGET|DUPLICATE/);
    expect(http).not.toHaveBeenCalled();
  });
  it('supports safe integer count outputs but never converts numeric IDs or years into USD evidence', async () => {
    const { env } = environment([{ count: 2, year: '2026', account_code: '1000' }]);
    mockWren(
      { count: 'count', year: 'unsupported', account_code: 'unsupported' },
      { provenance: 'ast-scope-v1', supported: true, from: null, toExclusive: null },
    );
    scriptedGeneration(
      planner({ queries: [], sqlQueries: [{ id: 'cash', sql: 'SELECT COUNT(*) AS count FROM ledger' }] }),
      candidate({
        summary: 'Two entries match.',
        facts: [
          {
            key: 'matching_entries',
            value: '2',
            unit: 'count',
            evidenceIds: ['query:cash'],
            entity: null,
            from: null,
            to: null,
            asOf: null,
          },
        ],
      }),
    );
    const result = await executeRoute('R6', questions[0], env);
    expect('validation' in result && result.validation.valid).toBe(true);
    const facts = result.evidence.find((e) => e.id === 'query:cash')?.facts ?? [];
    expect(facts).toContainEqual(expect.objectContaining({ value: '2', unit: 'count' }));
    expect(facts.some((f) => f.value === '2026' || f.value === '1000')).toBe(false);
  });
  it('withholds date-qualified financial facts when Wren has no scope proof', async () => {
    const { env } = environment();
    mockWren({ value: 'USD' }, { provenance: 'ast-scope-v1', supported: false });
    scriptedGeneration(
      planner({
        queries: [],
        sqlQueries: [{ id: 'cash', sql: 'SELECT SUM(net_debit) AS value FROM ledger' }],
      }),
      candidate(),
    );
    const result = await executeRoute('R6', questions[0], env);
    expect('validation' in result && result.validation.valid).toBe(false);
    expect('validation' in result && result.validation.reasons).toContain('UNSUPPORTED_LEDGER_SCOPE');
  });
});

// Limits are independently tested here rather than merely trusting planner instructions.
describe('per-episode resource limits', () => {
  const request = (kind: ResearchRequest['kind']): ResearchRequest => ({
    provider: kind.startsWith('jev') ? 'jev' : 'gemini',
    model: kind.startsWith('jev') ? 'jev-1.14.0' : GENERATION_MODEL,
    kind,
    url: 'https://generativelanguage.googleapis.com/v1beta/test',
    method: 'POST',
    headers: {},
    body: {},
    timeoutMs: 25000,
  });
  it('enforces separate generator, reviewer, embedding, reranking and logical-tool budgets', () => {
    const generator = new EpisodeLimits(() => 0);
    for (let i = 0; i < 4; i++) generator.model(request(i === 3 ? 'file-search-query' : 'generate'));
    expect(() => generator.model(request('generate'))).toThrow(/GENERATOR_LIMIT/);
    const review = new EpisodeLimits(() => 0);
    review.model(request('critic'));
    expect(() => review.model(request('jev-verify'))).toThrow(/REVIEWER_LIMIT/);
    const embed = new EpisodeLimits(() => 0);
    embed.model(request('embed'));
    expect(() => embed.model(request('embed'))).toThrow(/EMBEDDING_LIMIT/);
    const rerank = new EpisodeLimits(() => 0);
    rerank.model(request('jev-rerank'));
    expect(() => rerank.model(request('jev-rerank'))).toThrow(/RERANK_LIMIT/);
    const tools = new EpisodeLimits(() => 0);
    tools.useTools(7);
    tools.useTools(1);
    expect(() => tools.useTools(1)).toThrow(/TOOL_LIMIT/);
  });
  it('shrinks actual network timeouts to remaining time and rejects late network completion', async () => {
    let now = 0;
    const limits = new EpisodeLimits(() => now);
    now = 59000;
    const transport = vi.fn(async (_request: HttpRequest) => ({ status: 200, json: {}, elapsedMs: 20 }));
    await limits.http(transport)(request('generate'));
    expect(transport.mock.calls[0][0].timeoutMs).toBe(1000);
    const slow = vi.fn(async (_request: HttpRequest) => {
      now = 60001;
      return { status: 200, json: {}, elapsedMs: 1001 };
    });
    await expect(limits.http(slow)(request('generate'))).rejects.toThrow(/DEADLINE/);
    expect(() => limits.model(request('generate'))).toThrow(/DEADLINE/);
  });
  it('counts document retrieval in the same eight-tool allowance as analytical queries', async () => {
    const { env, http } = environment();
    const retrieval = vi.spyOn(DocumentRetriever.prototype, 'retrieve').mockResolvedValue([doc]);
    scriptedGeneration(
      planner({
        queries: Array.from({ length: 8 }, (_, i) => ({ ...cashPlan, id: `q${i}` })),
        retrievalQuery: 'reserve',
      }),
      candidate(),
    );
    await expect(executeRoute('R4', questions[0], env)).rejects.toThrow(/TOOL_LIMIT/);
    expect(http).not.toHaveBeenCalled();
    expect(retrieval).not.toHaveBeenCalled();
  });
  it('does not execute tools for a blocked plan, even if the planner supplies one', async () => {
    const { env, http } = environment();
    scriptedGeneration(planner({ intent: 'BLOCK' }), candidate());
    await expect(executeRoute('R1', questions[0], env)).rejects.toThrow(/BLOCK_WITH_TOOL_REQUEST/);
    expect(http).not.toHaveBeenCalled();
  });
});
