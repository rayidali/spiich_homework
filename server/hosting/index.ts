import { waitUntil } from '@vercel/functions';
import { createApp } from '../app';
import { processJobs } from '../anomalies';
import { config } from '../config';
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
