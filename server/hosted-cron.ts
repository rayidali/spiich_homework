import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

type Work = () => Promise<unknown>;
export function createCronHandler(secret: string | undefined, recurring: Work, jobs: Work) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const actual = Buffer.from(req.get('authorization') ?? '');
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const schedules = await recurring();
      const processed = await jobs();
      res.json({ schedules, processed });
    } catch {
      console.error(JSON.stringify({ event: 'hosted_schedule_failed' }));
      res.status(503).json({ error: 'SCHEDULE_UNAVAILABLE' });
    }
  };
}
