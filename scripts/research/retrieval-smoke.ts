import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { StudyBudget } from '../../research/budget';
import { GeminiResearchClient, JevResearchClient } from '../../research/providers';
import { ResearchDatabase } from '../../research/database';
import { DocumentRetriever } from '../../research/retrieval';
const budget = new StudyBudget('.tools/research/usage.json');
budget.episode = 'retrieval-smoke-v1';
const http = httpTransport(),
  transport = budget.wrap(providerTransport(http));
const reader = JSON.parse(readFileSync('.tools/research/database-private.json', 'utf8')).readerUrl;
const store = JSON.parse(readFileSync('.tools/research/index-state.json', 'utf8')).store;
const retriever = new DocumentRetriever(
  new ResearchDatabase(reader, http),
  new GeminiResearchClient(process.env.GEMINI_API_KEY ?? '', transport),
  new JevResearchClient(process.env.TYPESAFE_API_KEY ?? '', transport),
  store,
);
const results = [];
for (const kind of ['lexical', 'hybrid', 'rerank', 'managed'] as const) {
  try {
    const docs = await retriever.retrieve('What payment terms apply to Acme Corp invoices?', kind);
    results.push({
      kind,
      ok: docs.some((d) => d.id === 'acme-contract'),
      retrieved: docs.map((d) => ({ id: d.id, rank: d.rank, score: d.retrievalScore })),
    });
  } catch (error) {
    results.push({ kind, ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' });
  }
  atomicJson('docs/evidence/research-retrieval-smoke.json', { results });
  console.log(JSON.stringify(results.at(-1)));
}
