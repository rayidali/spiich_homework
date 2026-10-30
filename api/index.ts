import { waitUntil } from '@vercel/functions';
import { createApp } from '../server/app';
import { processJobs } from '../server/anomalies';
import { config } from '../server/config';
import express from 'express';

const app = express();
app.use((req, res, next) => {
  res.on('finish', () => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400)
      waitUntil(
        processJobs(config.organizationId).catch(() => {
          console.error(JSON.stringify({ event: 'hosted_worker_failed' }));
        }),
      );
  });
  next();
});
app.use(createApp());
export default app;
