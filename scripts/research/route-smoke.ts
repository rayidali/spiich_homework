import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { questions } from '../../research/dataset';
import { executeRoute, type RouteId } from '../../research/routes';
import { ResearchDatabase } from '../../research/database';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { StudyBudget } from '../../research/budget';
import { EpisodeLimits } from '../../research/limits';
import { scoreEpisode, type StudyEpisode } from '../../research/scoring';
import { getReference } from '../../research/reference';
const route = (process.argv[2] ?? 'R1') as RouteId,
  q = questions.find((q) => q.id === (process.argv[3] ?? 'financial-01-1'))!;
if (!q || q.split !== 'development') throw new Error('Preflight requires a development question');
const id = `route-preflight-${route}-${q.id}-${Date.now()}`;
const http = httpTransport(),
  budget = new StudyBudget('.tools/research/usage.json');
budget.episode = id;
const reader = JSON.parse(readFileSync('.tools/research/database-private.json', 'utf8')).readerUrl;
const db = new ResearchDatabase(reader, http),
  snapshot = await db.fingerprint(),
  limits = new EpisodeLimits();
const transport = budget.wrap(providerTransport(limits.http(http)));
let episode: StudyEpisode = {
  id,
  route,
  questionId: q.id,
  groupId: q.groupId,
  family: q.family,
  split: q.split,
  repeat: 0,
  status: 'error',
  durationMs: 0,
  organizationId: q.organizationId,
};
const start = performance.now();
try {
  const result = await executeRoute(route, q, {
    db: new ResearchDatabase(reader, limits.http(http)),
    limits,
    snapshot,
    store: JSON.parse(readFileSync('.tools/research/index-state.json', 'utf8')).store,
    geminiKey: process.env.GEMINI_API_KEY ?? '',
    jevKey: process.env.TYPESAFE_API_KEY ?? '',
    transport: (request) => {
      limits.model(request);
      return transport(request);
    },
  });
  episode = { ...episode, ...result, status: 'ok' };
} catch (error) {
  episode.error = error instanceof Error ? error.message : 'UNKNOWN';
}
episode.durationMs = Math.round(performance.now() - start);
const score = scoreEpisode(episode, getReference(q.id));
atomicJson(`docs/evidence/${id}.json`, {
  purpose: 'Exploratory integration preflight; not held-out evidence',
  episode,
  score,
});
console.log(
  JSON.stringify({
    id,
    status: episode.status,
    error: episode.error,
    validation: episode.validation,
    score,
    answer: episode.answer,
  }),
);
