import { createCronHandler } from '../hosted-cron';
import { generateRecurring } from '../recurring';
import { processJobs } from '../anomalies';
import { config } from '../config';
import express from 'express';

const app = express();
app.all(
  '/{*path}',
  createCronHandler(
    process.env.CRON_SECRET,
    () => generateRecurring(config.organizationId),
    () => processJobs(config.organizationId),
  ),
);
export default app;
