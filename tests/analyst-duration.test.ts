import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANALYST_LEASE_MS } from '../server/analyst-store';
import { ANALYST_MODEL_LIMITS } from '../server/analyst-model';
import { NATIVE_ANALYST_LIMITS } from '../server/native-analyst-service';

describe('native inference, hosting and lease duration contract', () => {
  it('keeps both hosted workers alive for inference and keeps the native lease longer than either invocation', () => {
    const hosting = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    // Both api/index.js and api/cron.js can advance a native model generation.
    const invocationMs = hosting.functions['api/*.js'].maxDuration * 1000;
    expect(hosting.fluid).toBe(true);
    expect(invocationMs).toBeGreaterThanOrEqual(NATIVE_ANALYST_LIMITS.modelMs + 60_000);
    expect(invocationMs).toBeLessThanOrEqual(300_000); // Hobby Fluid maximum.
    expect(ANALYST_LEASE_MS.daybook).toBeGreaterThanOrEqual(invocationMs + 30_000);
    expect(ANALYST_MODEL_LIMITS.timeoutMs).toBe(NATIVE_ANALYST_LIMITS.modelMs);
    expect(ANALYST_LEASE_MS.querio).toBe(75_000);
    expect(NATIVE_ANALYST_LIMITS.sqlMs).toBe(12_000);
    expect(NATIVE_ANALYST_LIMITS.inferenceRecoveries).toBe(1);
  });
});
