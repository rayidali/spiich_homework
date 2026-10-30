import { createCronHandler } from '../server/hosted-cron';
import { generateRecurring } from '../server/recurring';
import { processJobs } from '../server/anomalies';
import { config } from '../server/config';

export default createCronHandler(
  process.env.CRON_SECRET,
  () => generateRecurring(config.organizationId),
  () => processJobs(config.organizationId),
);
