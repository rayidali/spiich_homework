import type { ResearchRequest } from './providers';
import type { HttpTransport } from './io';
export class EpisodeLimits {
  private readonly started: number;
  private generators = 0;
  private reviewers = 0;
  private embeddings = 0;
  private reranks = 0;
  private tools = 0;
  constructor(
    private readonly clock: () => number = () => performance.now(),
    private readonly deadlineMs = 60000,
  ) {
    this.started = clock();
  }
  remaining() {
    const value = Math.floor(this.deadlineMs - (this.clock() - this.started));
    if (value <= 0) throw new Error('RESEARCH_EPISODE_DEADLINE');
    return value;
  }
  assert() {
    this.remaining();
  }
  model(request: ResearchRequest) {
    this.assert();
    if (['generate', 'file-search-query'].includes(request.kind) && ++this.generators > 4)
      throw new Error('RESEARCH_GENERATOR_LIMIT');
    if (['critic', 'jev-verify'].includes(request.kind) && ++this.reviewers > 1)
      throw new Error('RESEARCH_REVIEWER_LIMIT');
    if (request.kind === 'embed' && ++this.embeddings > 1) throw new Error('RESEARCH_EMBEDDING_LIMIT');
    if (request.kind === 'jev-rerank' && ++this.reranks > 1) throw new Error('RESEARCH_RERANK_LIMIT');
  }
  useTools(count: number) {
    this.assert();
    this.tools += count;
    if (this.tools > 8) throw new Error('RESEARCH_TOOL_LIMIT');
  }
  http(transport: HttpTransport): HttpTransport {
    return async (request) => {
      const response = await transport({
        ...request,
        timeoutMs: Math.min(request.timeoutMs, this.remaining()),
      });
      this.assert();
      return response;
    };
  }
}
