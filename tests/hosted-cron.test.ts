import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createCronHandler } from '../server/hosted-cron';

describe('hosted scheduler authorization', () => {
  function setup(secret: string | undefined = 'test-secret') {
    const recurring = vi.fn().mockResolvedValue({ generated: 2, failed: 0 });
    const jobs = vi.fn().mockResolvedValue(4);
    const handler = createCronHandler(secret, recurring, jobs);
    async function call(auth?: string, method = 'GET') {
      const result = { status: 200, body: {} as unknown, headers: {} as Record<string, string> };
      const req = { method, get: () => auth } as unknown as Request;
      const res = {
        setHeader(key: string, value: string) {
          result.headers[key.toLowerCase()] = value;
        },
        status(code: number) {
          result.status = code;
          return res;
        },
        json(body: unknown) {
          result.body = body;
          return res;
        },
      };
      await handler(req, res as unknown as Response);
      return result;
    }
    return { call, recurring, jobs };
  }
  it.each([undefined, 'Bearer wrong', 'Bearer test-secret-extra'])(
    'rejects %s before any work',
    async (auth) => {
      const { call, recurring, jobs } = setup();
      expect((await call(auth)).status).toBe(401);
      expect(recurring).not.toHaveBeenCalled();
      expect(jobs).not.toHaveBeenCalled();
    },
  );
  it('fails closed with no configured secret', async () => {
    const { call, recurring } = setup('');
    expect((await call('Bearer ')).status).toBe(401);
    expect(recurring).not.toHaveBeenCalled();
  });
  it('runs schedules then durable jobs only for an authorized GET', async () => {
    const { call, recurring, jobs } = setup();
    const res = await call('Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schedules: { generated: 2, failed: 0 }, processed: 4 });
    expect(recurring.mock.invocationCallOrder[0]).toBeLessThan(jobs.mock.invocationCallOrder[0]);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('rejects writes even with the correct credential', async () => {
    const { call, jobs } = setup();
    expect((await call('Bearer test-secret', 'POST')).status).toBe(405);
    expect(jobs).not.toHaveBeenCalled();
  });
  it('does not expose worker error details', async () => {
    const { call, recurring, jobs } = setup();
    recurring.mockRejectedValue(new Error('private connection string'));
    const res = await call('Bearer test-secret');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('private');
    expect(jobs).not.toHaveBeenCalled();
  });
});
