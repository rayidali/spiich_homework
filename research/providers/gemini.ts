import { z } from 'zod';
import { parseFileSearchInteraction, type InteractionsFileSearchResult } from './interactions';
import {
  checkStatus,
  fetchTransport,
  missingUsage,
  ResearchProviderError,
  tokenCount,
  type ProviderMetadata,
  type ProviderResult,
  type RequestKind,
  type ResearchResponse,
  type ResearchTransport,
} from './transport';

export const GENERATION_MODEL = 'gemini-3.5-flash-lite';
export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;
const base = 'https://generativelanguage.googleapis.com';
const modelName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/);
const storeName = z.string().regex(/^fileSearchStores\/[a-z0-9-]{1,80}$/);
const operationName = z
  .string()
  .regex(/^(?:fileSearchStores\/[a-z0-9-]{1,80}\/)?(?:upload\/)?operations\/[a-zA-Z0-9_-]{1,180}$/);
const promptText = z.string().min(1).max(200000);
const metadataSchema = z
  .array(
    z.union([
      z.object({ key: z.string().min(1).max(100), stringValue: z.string().max(1000) }).strict(),
      z.object({ key: z.string().min(1).max(100), numericValue: z.number().finite() }).strict(),
    ]),
  )
  .max(20);
export type FileMetadata = z.infer<typeof metadataSchema>;
const chunkSchema = z.object({
  retrievedContext: z
    .object({
      uri: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
      fileSearchStore: z.string().optional(),
      pageNumber: z.number().int().optional(),
      customMetadata: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
});
const supportSchema = z.object({
  segment: z.object({
    startIndex: z.number().int().optional(),
    endIndex: z.number().int(),
    text: z.string().optional(),
  }),
  groundingChunkIndices: z.array(z.number().int().nonnegative()),
  confidenceScores: z.array(z.number().finite()).optional(),
});
export type FileSearchChunk = z.infer<typeof chunkSchema>['retrievedContext'];
export type FileSearchGrounding = {
  chunks: NonNullable<FileSearchChunk>[];
  supports: z.infer<typeof supportSchema>[];
};
const generatedSchema = z.object({
  candidates: z.array(
    z.object({
      finishReason: z.string(),
      content: z.object({
        parts: z.array(
          z.object({
            text: z.string().optional(),
            thought: z.boolean().optional(),
            functionCall: z.unknown().optional(),
          }),
        ),
      }),
      groundingMetadata: z
        .object({
          groundingChunks: z.array(chunkSchema).optional(),
          groundingSupports: z.array(supportSchema).optional(),
        })
        .optional(),
    }),
  ),
  modelVersion: z.string().max(160).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});
const operationSchema = z.object({
  name: operationName,
  done: z.boolean().optional(),
  response: z.record(z.string(), z.unknown()).optional(),
  error: z.record(z.string(), z.unknown()).optional(),
});
export type FileSearchOperation = z.infer<typeof operationSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ResearchProviderError('INVALID_RESPONSE');
  return parsed.data;
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ResearchProviderError('INVALID_REQUEST');
  return parsed.data;
}
function providerSchema(schema: z.ZodType): Record<string, unknown> {
  // Matches the production grammar workaround; the full schema still validates output.
  return JSON.parse(
    JSON.stringify(z.toJSONSchema(schema), (key, value) =>
      key === 'maxItems' && typeof value === 'number' ? undefined : value,
    ),
  ) as Record<string, unknown>;
}

export type GenerationInput<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
  maxOutputTokens?: number;
  kind?: 'generate' | 'critic' | 'file-search-query';
  /** Supply only names selected by trusted workspace routing, never the model. */
  fileSearch?: { stores: string[]; topK?: number; metadataFilter?: string };
};

export type FileSearchInteractionInput = {
  system: string;
  prompt: string;
  /** Trusted workspace configuration, never an identifier supplied by a model. */
  stores: string[];
  topK?: number;
  metadataFilter?: string;
  maxOutputTokens?: number;
};

export class GeminiResearchClient {
  constructor(
    private readonly apiKey: string,
    private readonly transport: ResearchTransport = fetchTransport,
  ) {}

  private async request(
    path: string,
    kind: RequestKind,
    model: string,
    body?: unknown,
    method: 'GET' | 'POST' | 'DELETE' = 'POST',
    headers: Record<string, string> = {},
    rawBody?: string,
  ): Promise<ResearchResponse> {
    if (!this.apiKey.trim()) throw new ResearchProviderError('NOT_CONFIGURED');
    const response = await this.transport({
      provider: 'gemini',
      model,
      kind,
      url: `${base}${path}`,
      method,
      headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
      ...(rawBody === undefined ? {} : { rawBody }),
      timeoutMs: 25000,
    });
    checkStatus(response);
    return response;
  }

  private metadata(response: ResearchResponse, model: string, kind: RequestKind): ProviderMetadata {
    return {
      provider: 'gemini',
      requestedModel: model,
      model,
      kind,
      elapsedMs: response.elapsedMs,
      usage: missingUsage(),
    };
  }

  async generate<T>(
    options: GenerationInput<T>,
  ): Promise<ProviderResult<T> & { grounding: FileSearchGrounding }> {
    const model = input(modelName, options.model ?? GENERATION_MODEL);
    const maxOutputTokens = input(z.number().int().min(128).max(8000), options.maxOutputTokens ?? 4000);
    const kind = options.fileSearch ? 'file-search-query' : (options.kind ?? 'generate');
    const fileSearch = options.fileSearch
      ? {
          fileSearchStoreNames: input(z.array(storeName).min(1).max(4), options.fileSearch.stores),
          topK: input(z.number().int().min(1).max(20), options.fileSearch.topK ?? 6),
          ...(options.fileSearch.metadataFilter
            ? { metadataFilter: input(z.string().max(2000), options.fileSearch.metadataFilter) }
            : {}),
        }
      : undefined;
    const response = await this.request(`/v1beta/models/${model}:generateContent`, kind, model, {
      systemInstruction: { parts: [{ text: input(promptText, options.system) }] },
      contents: [{ role: 'user', parts: [{ text: input(promptText, options.prompt) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens,
        ...(model.startsWith('gemini-3') || model.startsWith('gemini-4')
          ? { thinkingConfig: { thinkingLevel: 'LOW' } }
          : {}),
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: providerSchema(options.schema) } },
      },
      ...(fileSearch ? { tools: [{ fileSearch }] } : {}),
    });
    const parsed = parse(generatedSchema, response.json);
    if (parsed.candidates.length !== 1 || parsed.candidates[0].finishReason !== 'STOP')
      throw new ResearchProviderError('INVALID_RESPONSE');
    const candidate = parsed.candidates[0];
    const parts = candidate.content.parts.filter((part) => !part.thought);
    if (!parts.length || parts.some((part) => part.functionCall !== undefined || part.text === undefined))
      throw new ResearchProviderError('INVALID_RESPONSE');
    let decoded: unknown;
    try {
      decoded = JSON.parse(parts.map((part) => part.text).join(''));
    } catch {
      throw new ResearchProviderError('INVALID_RESPONSE');
    }
    const usage = parsed.usageMetadata;
    const grounding: FileSearchGrounding = {
      chunks: (candidate.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) =>
        chunk.retrievedContext ? [chunk.retrievedContext] : [],
      ),
      supports: candidate.groundingMetadata?.groundingSupports ?? [],
    };
    // Keep original chunk indexing: no web/maps tools are enabled, so mixed chunks are invalid.
    if (
      (candidate.groundingMetadata?.groundingChunks?.length ?? 0) !== grounding.chunks.length ||
      grounding.supports.some((support) =>
        support.groundingChunkIndices.some((index) => index >= grounding.chunks.length),
      )
    )
      throw new ResearchProviderError('INVALID_RESPONSE');
    if (
      fileSearch &&
      grounding.chunks.some(
        (chunk) => chunk.fileSearchStore && !fileSearch.fileSearchStoreNames.includes(chunk.fileSearchStore),
      )
    )
      throw new ResearchProviderError('INVALID_RESPONSE');
    return {
      data: parse(options.schema, decoded),
      grounding,
      metadata: {
        ...this.metadata(response, model, kind),
        model: parsed.modelVersion ?? model,
        usage: {
          inputTokens: tokenCount(usage?.promptTokenCount),
          outputTokens: tokenCount(usage?.candidatesTokenCount),
          thinkingTokens: usage ? tokenCount(usage.thoughtsTokenCount ?? 0) : null,
          totalTokens: tokenCount(usage?.totalTokenCount),
        },
      },
    };
  }

  /** Managed citation selection. No generated prose is returned as source evidence. */
  async searchInteractions(
    options: FileSearchInteractionInput,
  ): Promise<ProviderResult<InteractionsFileSearchResult>> {
    const stores = input(z.array(storeName).min(1).max(4), options.stores);
    if (new Set(stores).size !== stores.length) throw new ResearchProviderError('INVALID_REQUEST');
    const response = await this.request('/v1beta/interactions', 'file-search-query', GENERATION_MODEL, {
      model: GENERATION_MODEL,
      store: false,
      system_instruction: input(promptText, options.system),
      input: input(promptText, options.prompt),
      generation_config: {
        temperature: 0,
        thinking_level: 'low',
        thinking_summaries: 'none',
        max_output_tokens: input(z.number().int().min(128).max(8000), options.maxOutputTokens ?? 1500),
      },
      tools: [
        {
          type: 'file_search',
          file_search_store_names: stores,
          top_k: input(z.number().int().min(1).max(20), options.topK ?? 6),
          ...(options.metadataFilter
            ? { metadata_filter: input(z.string().max(2000), options.metadataFilter) }
            : {}),
        },
      ],
    });
    const result = parseFileSearchInteraction(response.json);
    return {
      data: result.data,
      metadata: {
        ...this.metadata(response, GENERATION_MODEL, 'file-search-query'),
        model: result.model ?? GENERATION_MODEL,
        usage: result.usage,
      },
    };
  }

  async embed(
    text: string,
    options: { task?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'; title?: string; dimensions?: number } = {},
  ): Promise<ProviderResult<number[]>> {
    const dimensions = input(z.number().int().min(1).max(3072), options.dimensions ?? EMBEDDING_DIMENSIONS);
    const task = options.task ?? 'RETRIEVAL_QUERY';
    if (options.title && task !== 'RETRIEVAL_DOCUMENT') throw new ResearchProviderError('INVALID_REQUEST');
    const response = await this.request(
      `/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
      'embed',
      EMBEDDING_MODEL,
      {
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: input(z.string().min(1).max(12000), text) }] },
        // Live smoke on 2026-10-30 returned 3072 dimensions when the documented nested
        // config requested 768. Use the still-documented flat fields; never silently
        // truncate a mismatched vector or retry with a different configuration.
        taskType: task,
        outputDimensionality: dimensions,
        ...(options.title ? { title: input(z.string().max(500), options.title) } : {}),
      },
    );
    const value = parse(
      z.object({
        embedding: z.object({ values: z.array(z.number().finite()).length(dimensions) }),
        usageMetadata: z.object({ promptTokenCount: z.number().optional() }).optional(),
      }),
      response.json,
    );
    const norm = Math.sqrt(value.embedding.values.reduce((sum, item) => sum + item * item, 0));
    if (!Number.isFinite(norm) || norm === 0) throw new ResearchProviderError('INVALID_RESPONSE');
    const count = tokenCount(value.usageMetadata?.promptTokenCount);
    return {
      data: value.embedding.values.map((item) => item / norm),
      metadata: {
        ...this.metadata(response, EMBEDDING_MODEL, 'embed'),
        usage: { inputTokens: count, outputTokens: 0, thinkingTokens: 0, totalTokens: count },
      },
    };
  }

  async createStore(displayName: string): Promise<ProviderResult<{ name: string; embeddingModel?: string }>> {
    const response = await this.request('/v1beta/fileSearchStores', 'file-store', EMBEDDING_MODEL, {
      displayName: input(z.string().min(1).max(200), displayName),
      embeddingModel: `models/${EMBEDDING_MODEL}`,
    });
    return {
      data: parse(z.object({ name: storeName, embeddingModel: z.string().optional() }), response.json),
      metadata: this.metadata(response, EMBEDDING_MODEL, 'file-store'),
    };
  }

  async importFile(
    store: string,
    file: string,
    metadata: FileMetadata = [],
  ): Promise<ProviderResult<FileSearchOperation>> {
    const response = await this.request(
      `/v1beta/${input(storeName, store)}:importFile`,
      'file-index',
      EMBEDDING_MODEL,
      {
        fileName: input(z.string().regex(/^files\/[a-zA-Z0-9_-]{1,100}$/), file),
        customMetadata: input(metadataSchema, metadata),
        chunkingConfig: { whiteSpaceConfig: { maxTokensPerChunk: 200, maxOverlapTokens: 20 } },
      },
    );
    return this.operationResult(response, 'file-index');
  }

  /** Two real HTTP requests; caller accounts for both. Polling is separate and explicit. */
  async uploadText(
    store: string,
    displayName: string,
    text: string,
    metadata: FileMetadata = [],
  ): Promise<{ data: FileSearchOperation; metadata: ProviderMetadata[] }> {
    const content = input(z.string().min(1).max(100000), text);
    const bytes = Buffer.byteLength(content, 'utf8');
    const start = await this.request(
      `/upload/v1beta/${input(storeName, store)}:uploadToFileSearchStore`,
      'file-index',
      EMBEDDING_MODEL,
      {
        displayName: input(z.string().min(1).max(200), displayName),
        customMetadata: input(metadataSchema, metadata),
        chunkingConfig: { whiteSpaceConfig: { maxTokensPerChunk: 200, maxOverlapTokens: 20 } },
      },
      'POST',
      {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
    );
    let url: URL;
    try {
      url = new URL(start.headers?.['x-goog-upload-url'] ?? '');
    } catch {
      throw new ResearchProviderError('INVALID_RESPONSE');
    }
    if (
      url.origin !== base ||
      !url.pathname.startsWith('/upload/') ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new ResearchProviderError('INVALID_RESPONSE');
    const finish = await this.request(
      `${url.pathname}${url.search}`,
      'file-index',
      EMBEDDING_MODEL,
      undefined,
      'POST',
      {
        'Content-Type': 'text/plain',
        'Content-Length': String(bytes),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      content,
    );
    const operation = this.operationResult(finish, 'file-index');
    return {
      data: operation.data,
      metadata: [this.metadata(start, EMBEDDING_MODEL, 'file-index'), operation.metadata],
    };
  }

  async pollOperation(name: string): Promise<ProviderResult<FileSearchOperation>> {
    const response = await this.request(
      `/v1beta/${input(operationName, name)}`,
      'file-poll',
      EMBEDDING_MODEL,
      undefined,
      'GET',
    );
    return this.operationResult(response, 'file-poll');
  }

  async getStore(name: string): Promise<
    ProviderResult<{
      name: string;
      activeDocumentsCount?: string;
      pendingDocumentsCount?: string;
      failedDocumentsCount?: string;
    }>
  > {
    const response = await this.request(
      `/v1beta/${input(storeName, name)}`,
      'file-store',
      EMBEDDING_MODEL,
      undefined,
      'GET',
    );
    return {
      data: parse(
        z.object({
          name: storeName,
          activeDocumentsCount: z.string().regex(/^\d+$/).optional(),
          pendingDocumentsCount: z.string().regex(/^\d+$/).optional(),
          failedDocumentsCount: z.string().regex(/^\d+$/).optional(),
        }),
        response.json,
      ),
      metadata: this.metadata(response, EMBEDDING_MODEL, 'file-store'),
    };
  }

  async deleteStore(name: string): Promise<ProviderResult<null>> {
    const response = await this.request(
      `/v1beta/${input(storeName, name)}?force=true`,
      'file-store',
      EMBEDDING_MODEL,
      undefined,
      'DELETE',
    );
    return { data: null, metadata: this.metadata(response, EMBEDDING_MODEL, 'file-store') };
  }

  private operationResult(
    response: ResearchResponse,
    kind: RequestKind,
  ): ProviderResult<FileSearchOperation> {
    const operation = parse(operationSchema, response.json);
    if (operation.error) throw new ResearchProviderError('INDEX_FAILED');
    return { data: operation, metadata: this.metadata(response, EMBEDDING_MODEL, kind) };
  }
}
