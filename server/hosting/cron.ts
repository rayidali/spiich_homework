import { createCronHandler } from '../hosted-cron';
import { generateRecurring } from '../recurring';
import { processJobs } from '../anomalies';
import { config } from '../config';
import express from 'express';
import { processAnalystWork } from '../analyst-worker';

const app = express();
app.all(
  '/{*path}',
  createCronHandler(
    process.env.CRON_SECRET,
    () => generateRecurring(config.organizationId),
    () => Promise.all([processJobs(config.organizationId), processAnalystWork(config.organizationId)]),
  ),
);
export default app;
