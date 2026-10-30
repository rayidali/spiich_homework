import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { atomicJson, httpTransport, providerTransport } from '../../research/io';
import { StudyBudget } from '../../research/budget';
import { GeminiResearchClient } from '../../research/providers';
import { ResearchDatabase } from '../../research/database';
import { documents, primaryOrganizationId } from '../../research/dataset';
import { corpusHash } from '../../research/retrieval';
const mode = process.argv[2] ?? 'vectors';
if (!['vectors', 'files'].includes(mode)) throw new Error('Choose vectors or files');
const http = httpTransport(),
  budget = new StudyBudget('.tools/research/usage.json');
budget.episode = `index:${mode}`;
const gemini = new GeminiResearchClient(
  process.env.GEMINI_API_KEY ?? '',
  budget.wrap(providerTransport(http)),
);
// Administrative connection is restricted to this fixture/index CLI; never used for query routes.
const owner =
  process.env.RESEARCH_OWNER_URL ||
  JSON.parse(readFileSync('.tools/vercel-session/deployment-env.json', 'utf8')).build.env
    .MIGRATION_DATABASE_URL;
const db = new ResearchDatabase(owner, http);
const path = '.tools/research/index-state.json';
const state: {
  corpusHash: string;
  vectors: string[];
  files: string[];
  store?: string;
  operations: Record<string, string>;
} = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : { corpusHash: corpusHash(documents), vectors: [], files: [], operations: {} };
if (state.corpusHash !== corpusHash(documents)) throw new Error('RESEARCH_CORPUS_CHANGED');
if (mode === 'vectors') {
  const stored = new Set(
    (await db.execute('SELECT id FROM research.documents WHERE embedding IS NOT NULL')).rows.map((row) =>
      String(row.id),
    ),
  );
  state.vectors = state.vectors.filter((id) => stored.has(id));
  for (const doc of documents) {
    if (state.vectors.includes(doc.id)) continue;
    const embedded = await gemini.embed(doc.text, { task: 'RETRIEVAL_DOCUMENT', title: doc.title });
    await db.execute('UPDATE research.documents SET embedding=$1::vector WHERE id=$2 AND content_hash=$3', [
      JSON.stringify(embedded.data),
      doc.id,
      (await import('node:crypto')).createHash('sha256').update(doc.text).digest('hex'),
    ]);
    state.vectors.push(doc.id);
    atomicJson(path, state);
    console.log(`Embedded ${state.vectors.length}/${documents.length}`);
  }
} else {
  if (!state.store) {
    state.store = (await gemini.createStore('Daybook synthetic research v1')).data.name;
    atomicJson(path, state);
  }
  const scoped = documents.filter((doc) => doc.organizationId === primaryOrganizationId);
  for (const doc of scoped) {
    if (state.files.includes(doc.id)) continue;
    if (!state.operations[doc.id]) {
      const text = `${doc.id} | ${doc.title}\nVersion ${doc.version}; valid from ${doc.effectiveFrom} through ${doc.effectiveTo ?? 'open'}.\n${doc.text}`;
      const uploaded = await gemini.uploadText(state.store, `${doc.id} | ${doc.title}`, text, [
        { key: 'source_id', stringValue: doc.id },
        { key: 'organization_id', stringValue: doc.organizationId },
      ]);
      state.operations[doc.id] = uploaded.data.name;
      atomicJson(path, state);
    }
    let done = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const operation = await gemini.pollOperation(state.operations[doc.id]);
      if (operation.data.done) {
        done = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!done) throw new Error('RESEARCH_INDEX_NOT_READY');
    state.files.push(doc.id);
    atomicJson(path, state);
    console.log(`Indexed ${state.files.length}/${scoped.length}`);
  }
}
console.log(JSON.stringify({ mode, complete: true, corpusHash: state.corpusHash }));
