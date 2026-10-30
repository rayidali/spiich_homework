import { createCronHandler } from '../hosted-cron';
import { generateRecurring } from '../recurring';
import { processJobs } from '../anomalies';
import { config } from '../config';

export default createCronHandler(
  process.env.CRON_SECRET,
  () => generateRecurring(config.organizationId),
  () => processJobs(config.organizationId),
);
