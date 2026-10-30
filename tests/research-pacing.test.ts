import { describe, expect, it } from 'vitest';
import { GeminiStartPacer, type PacingClock } from '../research/pacing';
import type { ResearchRequest, ResearchTransport } from '../research/providers/transport';

const request: ResearchRequest = {
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  kind: 'generate',
  url: 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent',
  method: 'POST',
  headers: {},
  body: {},
  timeoutMs: 25000,
};
function fixture() {
  let time = 0;
  const waits: number[] = [];
  const calls: { at: number; request: ResearchRequest }[] = [];
  const clock: PacingClock = {
    now: () => time,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
  };
  const transport: ResearchTransport = async (input) => {
    calls.push({ at: time, request: input });
    return { status: 200, json: {}, elapsedMs: 7 };
  };
  return {
    clock,
    transport,
    calls,
    waits,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('shared Gemini request start pacing', () => {
  it('spaces generation, managed retrieval and critic starts across wrapped clients', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    const first = pacer.wrap(f.transport),
      second = pacer.wrap(f.transport);
    await first(request);
    await second({ ...request, kind: 'file-search-query' });
    await first({ ...request, kind: 'critic' });
    expect(f.calls.map((call) => call.at)).toEqual([0, 4200, 8400]);
    expect(f.waits).toEqual([4200, 4200]);
  });

  it('serializes concurrent starts without waiting for response completion', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    let complete!: () => void;
    const slow = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const transport: ResearchTransport = async (input) => {
      await f.transport(input);
      if (f.calls.length === 1) await slow;
      return { status: 200, json: {}, elapsedMs: 1 };
    };
    const first = pacer.execute(request, transport);
    const second = pacer.execute(request, transport);
    await second;
    expect(f.calls.map((call) => call.at)).toEqual([0, 4200]);
    complete();
    await first;
  });

  it('keeps embeddings, index operations and Jev outside the Gemini start gate', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    await pacer.execute(request, f.transport);
    await pacer.execute({ ...request, kind: 'embed' }, f.transport);
    await pacer.execute({ ...request, kind: 'file-store' }, f.transport);
    await pacer.execute({ ...request, provider: 'jev', kind: 'jev-verify' }, f.transport);
    expect(f.calls.map((call) => call.at)).toEqual([0, 0, 0, 0]);
    expect(f.waits).toEqual([]);
  });

  it('uses time spent in previous responses instead of adding a fixed sleep per call', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    await pacer.execute(request, f.transport);
    f.advance(5000);
    await pacer.execute(request, f.transport);
    expect(f.waits).toEqual([]);
    expect(f.calls.map((call) => call.at)).toEqual([0, 5000]);
  });

  it('counts a failed attempt as a start but never retries it or poisons the gate', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    await expect(
      pacer.execute(request, () => {
        throw new Error('RATE_LIMIT');
      }),
    ).rejects.toThrow('RATE_LIMIT');
    await pacer.execute(request, f.transport);
    expect(f.calls.map((call) => call.at)).toEqual([4200]);
  });

  it('declines requests whose pacing wait would consume the episode deadline without dispatch', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    await pacer.execute(request, f.transport);
    await expect(pacer.execute(request, f.transport, 4200)).rejects.toThrow('RESEARCH_EPISODE_DEADLINE');
    expect(f.calls).toHaveLength(1);
    expect(f.waits).toEqual([]);
    await pacer.execute(request, f.transport, 8000);
    expect(f.calls[1].request.timeoutMs).toBe(3800);
  });

  it('captures one absolute episode deadline before waiting and caps transport timeout after the wait', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    await pacer.execute(request, f.transport);
    const wrapped = pacer.wrap(f.transport, { remainingMs: () => 6000 });
    await wrapped(request);
    expect(f.calls[1]).toMatchObject({ at: 4200, request: { timeoutMs: 1800 } });
  });

  it('applies the wall deadline to unpaced operations too and rejects late responses', async () => {
    const f = fixture(),
      pacer = new GeminiStartPacer({ clock: f.clock });
    await expect(
      pacer.execute(
        { ...request, kind: 'embed' },
        async (input) => {
          expect(input.timeoutMs).toBe(1000);
          f.advance(1001);
          return { status: 200, json: {}, elapsedMs: 1001 };
        },
        1000,
      ),
    ).rejects.toThrow('RESEARCH_EPISODE_DEADLINE');
    await expect(
      pacer.execute({ ...request, timeoutMs: 500 }, async () => {
        f.advance(501);
        return { status: 200, json: {}, elapsedMs: 501 };
      }),
    ).rejects.toThrow('RESEARCH_HTTP_TIMEOUT');
  });

  it('rechecks an early wake and never reduces spacing below the free-tier default', async () => {
    const f = fixture();
    let wake = 0;
    const clock: PacingClock = {
      now: f.clock.now,
      sleep: async (ms) => {
        f.advance(wake++ ? ms : 1000);
      },
    };
    const pacer = new GeminiStartPacer({ clock });
    await pacer.execute(request, f.transport);
    await pacer.execute(request, f.transport);
    expect(f.calls[1].at).toBe(4200);
    expect(() => new GeminiStartPacer({ spacingMs: 1000 })).toThrow('RESEARCH_INVALID_PACING');
  });
});
