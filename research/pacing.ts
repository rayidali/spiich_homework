import type { ResearchRequest, ResearchResponse, ResearchTransport } from './providers/transport';

export interface PacingClock {
  /** A monotonic millisecond clock; injected deadlines use this same clock. */
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}
const realClock: PacingClock = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};
export const MINIMUM_GEMINI_START_SPACING_MS = 4200;
const generationKinds = new Set(['generate', 'critic', 'file-search-query']);

/** One instance per runner, shared across routes/episodes and Gemini clients.
 * Serializes dispatch starts, not response completion. It never retries a call.
 * This is local pacing, not a guarantee about provider RPM/TPM/daily quotas.
 */
export class GeminiStartPacer {
  private gate: Promise<void> = Promise.resolve();
  private lastStartedAt: number | null = null;
  private readonly clock: PacingClock;
  readonly spacingMs: number;

  constructor(options: { clock?: PacingClock; spacingMs?: number } = {}) {
    this.clock = options.clock ?? realClock;
    this.spacingMs = options.spacingMs ?? MINIMUM_GEMINI_START_SPACING_MS;
    if (
      !Number.isSafeInteger(this.spacingMs) ||
      this.spacingMs < MINIMUM_GEMINI_START_SPACING_MS ||
      this.spacingMs > 60000
    )
      throw new Error('RESEARCH_INVALID_PACING');
  }

  wrap(transport: ResearchTransport, options: { remainingMs?: () => number } = {}): ResearchTransport {
    return (request) => {
      const remaining = options.remainingMs?.();
      if (remaining !== undefined && (!Number.isFinite(remaining) || remaining <= 0))
        return Promise.reject(new Error('RESEARCH_EPISODE_DEADLINE'));
      return this.execute(
        request,
        transport,
        remaining === undefined ? undefined : this.clock.now() + remaining,
      );
    };
  }

  async execute(
    request: ResearchRequest,
    transport: ResearchTransport,
    deadlineAtMs?: number,
  ): Promise<ResearchResponse> {
    if (
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > 25000 ||
      (deadlineAtMs !== undefined && !Number.isFinite(deadlineAtMs))
    )
      throw new Error('RESEARCH_INVALID_PACING_REQUEST');
    if (request.provider !== 'gemini' || !generationKinds.has(request.kind))
      return this.dispatch(request, transport, deadlineAtMs);

    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    let response: Promise<ResearchResponse>;
    try {
      // Recheck after an early wake rather than dispatching too soon.
      while (this.lastStartedAt !== null) {
        const now = this.clock.now();
        const waitMs = this.lastStartedAt + this.spacingMs - now;
        if (waitMs <= 0) break;
        if (deadlineAtMs !== undefined && now + waitMs >= deadlineAtMs)
          throw new Error('RESEARCH_EPISODE_DEADLINE');
        await this.clock.sleep(waitMs);
      }
      this.timeout(request, deadlineAtMs);
      this.lastStartedAt = this.clock.now();
      response = this.dispatch(request, transport, deadlineAtMs);
    } finally {
      // A slow or failed request must not hold the dispatch gate until completion.
      release();
    }
    return response;
  }

  private timeout(request: ResearchRequest, deadlineAtMs?: number) {
    const remaining =
      deadlineAtMs === undefined ? request.timeoutMs : Math.floor(deadlineAtMs - this.clock.now());
    if (remaining <= 0) throw new Error('RESEARCH_EPISODE_DEADLINE');
    return Math.min(request.timeoutMs, remaining);
  }

  private async dispatch(request: ResearchRequest, transport: ResearchTransport, deadlineAtMs?: number) {
    const timeoutMs = this.timeout(request, deadlineAtMs);
    const started = this.clock.now();
    const response = await transport({ ...request, timeoutMs });
    // Native fetch/approved curl owns cancellation. Reject any late result too;
    // Promise.race would leave a budgeted network request running in the background.
    if (deadlineAtMs !== undefined && this.clock.now() >= deadlineAtMs)
      throw new Error('RESEARCH_EPISODE_DEADLINE');
    if (this.clock.now() - started >= timeoutMs) throw new Error('RESEARCH_HTTP_TIMEOUT');
    return response;
  }
}
