import { readdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { QUEUE_COMPLETION_MARKER } from '../../research/io';
const root = resolve('.tools/research/queue');
const count = Number(process.argv[2] ?? '4');
if (!Number.isSafeInteger(count) || count < 1 || count > 16) throw new Error('Invalid batch size');
const files = readdirSync(root)
  .filter((name) => name.endsWith('.ready'))
  .sort()
  .slice(0, count);
const requestClasses: string[] = [];
const blocks = files.flatMap((name) => {
  const stem = `${root}/${name.slice(0, -6)}`;
  const metadata = JSON.parse(readFileSync(`${stem}.ready`, 'utf8')) as { expiresAt?: number };
  const remaining = metadata.expiresAt === undefined ? null : metadata.expiresAt - Date.now();
  if (remaining !== null && remaining <= 0) {
    unlinkSync(`${stem}.ready`);
    writeFileSync(`${stem}.done`, `000 0 28 ${QUEUE_COMPLETION_MARKER}\n`, { mode: 0o600 });
    return [];
  }
  renameSync(`${stem}.ready`, `${stem}.claimed`);
  let configuration = readFileSync(`${stem}.curl`, 'utf8');
  if (remaining !== null)
    configuration = configuration.replace(
      /^max-time = .+$/m,
      `max-time = ${Math.max(0.001, remaining / 1000)}`,
    );
  try {
    const body = JSON.parse(readFileSync(`${stem}.body`, 'utf8'));
    const model = typeof body.model === 'string' ? body.model : '';
    requestClasses.push(
      configuration.includes('generativelanguage.googleapis.com') &&
        (configuration.includes(':generateContent') || configuration.includes('/interactions'))
        ? 'gemini_generation'
        : model.startsWith('gemini-') && !model.includes('embedding')
          ? 'gemini_generation'
          : model.includes('embedding')
            ? 'gemini_embedding'
            : model.startsWith('jev')
              ? 'jev'
              : 'other',
    );
  } catch {
    requestClasses.push('other');
  }
  return [configuration];
});
writeFileSync('.tools/research/batch.curl', blocks.join('\nnext\n'), { mode: 0o600 });
console.log(JSON.stringify({ queued: blocks.length, requestClasses }));
