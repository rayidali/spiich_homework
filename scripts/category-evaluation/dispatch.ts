import { existsSync, readFileSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { privateJson } from './transport';

// Operator-side control only. Does not itself call a provider or print credentials.
const [command, run, ...arguments_] = process.argv.slice(2);
const root = resolve('.tools/category-evaluation');
if (!run || !/^[a-z0-9-]{1,60}$/.test(run)) throw new Error('DISPATCH_RUN');
const directory = join(root, run);
const pendingFile = join(directory, 'pending.json');
if (command === 'claim') {
  // This environment only permits the existing `curl -fsSL` command prefix.
  // Since curl's -q must be first to suppress defaults, refuse an implicit rc
  // instead of pretending a later -q disabled it. Dispatch adds explicit bounds.
  const curlConfigs = [
    join(homedir(), '.curlrc'),
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'curlrc'),
  ];
  if (process.env.CURL_HOME) curlConfigs.push(join(process.env.CURL_HOME, '.curlrc'));
  if (curlConfigs.some((path) => existsSync(path))) throw new Error('DISPATCH_IMPLICIT_CURL_CONFIG');
  if (!existsSync(pendingFile))
    console.log(
      JSON.stringify({ state: existsSync(join(directory, 'finished.json')) ? 'finished' : 'waiting' }),
    );
  else {
    const row = JSON.parse(readFileSync(pendingFile, 'utf8'));
    if (row.state !== 'queued')
      console.log(
        JSON.stringify({ state: existsSync(join(directory, 'finished.json')) ? 'finished' : row.state }),
      );
    else {
      if (
        !/^[a-zA-Z0-9:_-]{1,100}$/.test(row.id) ||
        dirname(resolve(row.directory)) !== directory ||
        !['gemini', 'jev'].includes(row.provider) ||
        row.timeoutMs !== 25000 ||
        row.maxResponseBytes !== 131072 ||
        !Number.isSafeInteger(row.deadline) ||
        row.deadline - Date.now() < 3000
      )
        throw new Error('DISPATCH_STALE_OR_INVALID');
      const expected =
        row.provider === 'jev'
          ? 'https://api.typesafe.ai/v1/systemone'
          : 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
      if (row.url !== expected) throw new Error('DISPATCH_TARGET');
      closeSync(openSync(join(row.directory, 'claimed'), 'wx', 0o600));
      row.state = 'dispatched';
      row.dispatchedAt = new Date().toISOString();
      privateJson(pendingFile, row);
      console.log(
        JSON.stringify({
          state: 'claimed',
          id: row.id,
          provider: row.provider,
          directory: row.directory,
          url: row.url,
          maxSeconds: Math.min(20, Math.floor((row.deadline - Date.now()) / 1000)),
        }),
      );
    }
  }
} else if (command === 'complete') {
  const [id, exitText, statusText, secondsText] = arguments_;
  if (!id || !/^[a-zA-Z0-9:_-]{1,100}$/.test(id)) throw new Error('DISPATCH_ID');
  const exitCode = Number(exitText),
    httpStatus = Number(statusText),
    seconds = Number(secondsText);
  if (
    !Number.isSafeInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > 255 ||
    !Number.isInteger(httpStatus) ||
    httpStatus < 0 ||
    httpStatus > 599 ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > 30
  )
    throw new Error('DISPATCH_RESULT');
  const callDirectory = join(directory, id.replaceAll(':', '-'));
  if (!existsSync(join(callDirectory, 'claimed')) || existsSync(join(callDirectory, 'completion.json')))
    throw new Error('DISPATCH_NOT_CLAIMED_OR_USED');
  closeSync(openSync(join(callDirectory, 'completion-claimed'), 'wx', 0o600));
  const responseFile = join(callDirectory, 'response.json');
  if (!existsSync(responseFile)) writeFileSync(responseFile, '', { mode: 0o600, flag: 'wx' });
  privateJson(join(callDirectory, 'completion.json'), {
    dispatched: true,
    exitCode,
    httpStatus,
    networkMs: Math.round(seconds * 1000),
  });
  console.log(JSON.stringify({ state: 'completed', id, httpStatus, exitCode }));
} else throw new Error('DISPATCH_COMMAND');
