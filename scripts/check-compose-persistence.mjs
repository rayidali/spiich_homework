import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Run after `docker compose up --build --wait` on a Docker-enabled host.
// Recreates the app/database containers, preserving their existing named volume.
// Reads existing posted history; never creates, edits, reverses or deletes entries.
if (!process.argv.includes('--execute')) {
  console.error('Use --execute to recreate the Compose app/database containers and check persistence.');
  process.exit(2);
}

function compose(args, capture = false) {
  const result = spawnSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Docker Compose ${args[0]} failed. Check that Docker is running and the stack is healthy.`,
    );
  }
  return result.stdout?.trim() ?? '';
}

async function run() {
  // Resolve the published port from Compose rather than accidentally checking a native dev server.
  const port = compose(['port', 'app', '3001'], true);
  const address = port.split('\n')[0];
  assert.match(address, /:\d+$/u, 'Compose app must publish a local HTTP port.');
  const base = new URL(`http://${address.replace(/^0\.0\.0\.0:/u, '127.0.0.1:')}`);
  async function get(path) {
    // Containers are deliberately destroyed between reads. Do not retain a socket
    // to the old app while synchronous Compose commands block the Node event loop.
    const response = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(15_000),
      headers: { Connection: 'close' },
    });
    assert.ok(response.ok, `HTTP ${response.status} while checking ${path}`);
    return response.json();
  }
  const meta = await get('/api/meta');
  const list = await get('/api/entries?status=POSTED&limit=1');
  assert.ok(
    list.items?.length,
    'At least one posted entry is required; enable the demo seed for this check.',
  );
  const entry = await get(`/api/entries/${list.items[0].id}`);
  assert.equal(entry.status, 'POSTED');

  compose(['up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '120', 'db', 'app']);

  const afterMeta = await get('/api/meta');
  const afterEntry = await get(`/api/entries/${entry.id}`);
  assert.equal(afterMeta.organization.id, meta.organization.id, 'The workspace changed after recreation.');
  assert.deepEqual(afterEntry, entry, 'A posted entry changed or disappeared after container recreation.');
  console.log(
    'PASS: workspace and complete posted entry persisted across app/database container recreation.',
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : 'Compose persistence check failed.';
  console.error(message);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const diagnostic = error instanceof Error ? (error.stack ?? message) : message;
    const annotation = diagnostic.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    console.log(`::error title=Compose persistence::${annotation}`);
  }
  process.exitCode = 1;
});
