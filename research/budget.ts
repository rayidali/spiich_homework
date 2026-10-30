import { existsSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './io';
import type { ResearchRequest, ResearchResponse, ResearchTransport } from './providers/transport';

export interface UsageRecord {
  id: string;
  episode: string;
  provider: 'gemini' | 'jev';
  kind: string;
  model: string;
  at: string;
  reserveUsd: number;
  estimatedUsd: number | null;
  status: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
}
const prices = { geminiInput: 0.25, geminiOutput: 1.5, embeddingInput: 0.15, jevInput: 0.042 };
function generationPrice(model: string) {
  return model === 'gemini-3.5-flash-lite'
    ? { input: 0.3, output: 2.5 }
    : { input: prices.geminiInput, output: prices.geminiOutput };
}
// Rates are USD/million tokens, official pricing inspected 2026-10-30.
// Paid-equivalent estimates, not a billing invoice/free-tier assumption.
export class StudyBudget {
  readonly records: UsageRecord[];
  episode = 'setup';
  constructor(
    readonly path: string,
    readonly limits = { gemini: 10, jev: 4, attempts: 10000 },
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.records = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  }
  spend(provider: 'gemini' | 'jev') {
    return this.records
      .filter((r) => r.provider === provider)
      .reduce((a, r) => a + (r.estimatedUsd ?? r.reserveUsd), 0);
  }
  wrap(transport: ResearchTransport): ResearchTransport {
    return async (request) => {
      const lockPath = `${this.path}.lock`;
      if (existsSync(lockPath)) {
        const pid = Number(readFileSync(lockPath, 'utf8'));
        try {
          process.kill(pid, 0);
          throw new Error('RESEARCH_BUDGET_IN_USE');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          unlinkSync(lockPath);
        }
      }
      const lock = openSync(lockPath, 'wx', 0o600);
      writeFileSync(lock, String(process.pid));
      try {
        if (existsSync(this.path))
          this.records.splice(
            0,
            this.records.length,
            ...(JSON.parse(readFileSync(this.path, 'utf8')) as UsageRecord[]),
          );
        const reservation = this.reserve(request);
        const response = await transport(request);
        this.finish(reservation, request, response);
        return response;
      } finally {
        atomicJson(this.path, this.records);
        closeSync(lock);
        unlinkSync(lockPath);
      }
    };
  }
  private reserve(request: ResearchRequest) {
    const inputBound = Buffer.byteLength(request.rawBody ?? JSON.stringify(request.body ?? {})) + 2048;
    if (
      request.provider === 'gemini' &&
      !['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-embedding-001', 'file-search'].includes(
        request.model,
      )
    )
      throw new Error('RESEARCH_UNPRICED_MODEL');
    const rate = generationPrice(request.model);
    const generations = this.records.filter(
      (r) =>
        r.provider === request.provider &&
        ['generate', 'critic', 'file-search-query', 'jev-systemone', 'jev-verify', 'jev-rerank'].includes(
          r.kind,
        ),
    );
    if (generations.length >= 3 && generations.slice(-3).every((r) => r.estimatedUsd === null))
      throw new Error('RESEARCH_PROVIDER_CIRCUIT_OPEN');
    const data = request.body as
      | {
          generationConfig?: { maxOutputTokens?: number };
          generation_config?: { max_output_tokens?: number };
        }
      | undefined;
    const outputBound =
      data?.generationConfig?.maxOutputTokens ?? data?.generation_config?.max_output_tokens ?? 8000;
    const embed = request.kind === 'embed' || request.kind === 'file-index';
    const freeControl = ['file-store', 'file-poll'].includes(request.kind);
    // For managed retrieval, reserve a full 100k-token source allowance per query.
    const extraRetrieval = request.kind === 'file-search-query' ? 100000 : 0;
    const reserveUsd = freeControl
      ? 0
      : request.provider === 'jev'
        ? (inputBound * prices.jevInput) / 1e6
        : ((inputBound + extraRetrieval) * (embed ? prices.embeddingInput : rate.input) +
            (embed ? 0 : outputBound * rate.output)) /
          1e6;
    if (
      this.records.length >= this.limits.attempts ||
      this.spend(request.provider) + reserveUsd > this.limits[request.provider]
    )
      throw new Error('RESEARCH_BUDGET_EXHAUSTED');
    const record: UsageRecord = {
      id: randomUUID(),
      episode: this.episode,
      provider: request.provider,
      kind: request.kind,
      model: request.model,
      at: new Date().toISOString(),
      reserveUsd,
      estimatedUsd: freeControl ? 0 : null,
      status: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
    };
    this.records.push(record);
    atomicJson(this.path, this.records);
    return record;
  }
  private finish(record: UsageRecord, request: ResearchRequest, response: ResearchResponse) {
    record.status = response.status;
    record.durationMs = response.elapsedMs;
    const body = response.json as {
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_input_tokens?: unknown;
        total_output_tokens?: unknown;
        total_thought_tokens?: unknown;
        total_tool_use_tokens?: unknown;
      };
      usageMetadata?: {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        thoughtsTokenCount?: unknown;
      };
    } | null;
    const count = (x: unknown) => (Number.isSafeInteger(x) && Number(x) >= 0 ? Number(x) : null);
    let input = count(
      request.provider === 'jev'
        ? body?.usage?.input_tokens
        : (body?.usageMetadata?.promptTokenCount ?? body?.usage?.total_input_tokens),
    );
    if (input !== null && request.provider === 'gemini' && body?.usage?.total_input_tokens !== undefined)
      input += count(body.usage.total_tool_use_tokens) ?? 0;
    const output =
      request.provider === 'jev'
        ? count(body?.usage?.output_tokens)
        : count(body?.usageMetadata?.candidatesTokenCount ?? body?.usage?.total_output_tokens);
    const thinking =
      request.provider === 'jev'
        ? 0
        : (count(body?.usageMetadata?.thoughtsTokenCount ?? body?.usage?.total_thought_tokens) ?? 0);
    const rate = generationPrice(request.model);
    record.inputTokens = input;
    record.outputTokens = output === null ? null : output + thinking;
    if (input !== null && (output !== null || request.provider === 'jev')) {
      record.estimatedUsd =
        request.provider === 'jev'
          ? (input * prices.jevInput) / 1e6
          : (input * (request.kind === 'embed' ? prices.embeddingInput : rate.input) +
              (record.outputTokens ?? 0) * rate.output) /
            1e6;
    }
    // Unknown usage retains its reservation; failed requests are never claimed free.
  }
}
