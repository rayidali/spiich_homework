import 'dotenv/config';
import { z } from 'zod';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { StudyBudget } from '../../research/budget';
import { GeminiResearchClient, JevResearchClient } from '../../research/providers';
const budget = new StudyBudget('.tools/research/usage.json');
budget.episode = 'provider-smoke-v1';
const transport = budget.wrap(providerTransport(httpTransport()));
const gemini = new GeminiResearchClient(process.env.GEMINI_API_KEY ?? '', transport);
const jev = new JevResearchClient(process.env.TYPESAFE_API_KEY ?? '', transport);
const outcomes: Record<string, unknown> = {};
async function check(name: string, task: () => Promise<unknown>) {
  try {
    outcomes[name] = { ok: true, result: await task() };
    console.log(`${name}: passed`);
  } catch (error) {
    outcomes[name] = { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
    console.log(`${name}: failed`);
  }
  atomicJson('.tools/research/provider-smoke.json', outcomes);
}
await check('gemini_json', async () => {
  const r = await gemini.generate({
    system: 'Return the requested exact text in the provided JSON schema.',
    prompt: 'Set text to ready.',
    schema: z.object({ text: z.string() }),
    maxOutputTokens: 512,
  });
  if (r.data.text !== 'ready') throw new Error('UNEXPECTED_VALUE');
  return r.metadata;
});
await check('jev', async () => {
  const r = await jev.noul('Invoice says amount USD 100. Answer says amount USD 200.', {
    mismatch: { type: 'noul', instructions: 'Does the answer contradict the invoice amount?' },
  });
  return { probability: r.data.mismatch, metadata: r.metadata };
});
await check('gemini_embedding', async () => {
  const r = await gemini.embed('Office rent agreement', { task: 'RETRIEVAL_QUERY' });
  return { dimensions: r.data.length, metadata: r.metadata };
});
await check('gemini_critic_model', async () => {
  const r = await gemini.generate({
    system: 'Return the requested exact text in the provided JSON schema.',
    prompt: 'Set text to ready.',
    schema: z.object({ text: z.string() }),
    maxOutputTokens: 128,
    model: 'gemini-3.5-flash-lite',
    kind: 'critic',
  });
  if (r.data.text !== 'ready') throw new Error('UNEXPECTED_VALUE');
  return r.metadata;
});
console.log(
  JSON.stringify({
    geminiReservedOrEstimated: budget.spend('gemini'),
    jevReservedOrEstimated: budget.spend('jev'),
  }),
);
