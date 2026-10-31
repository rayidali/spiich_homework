import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// This creates synthetic postings. Run only against the disposable Compose job in CI.
// No configurable URL, owner database connection, provider call or manual worker invocation.
if (
  !process.argv.includes('--execute') ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.GITHUB_JOB !== 'compose'
) {
  console.error('RUNTIME_ACCEPTANCE_REFUSED: requires --execute in the disposable Compose CI job.');
  process.exit(2);
}

const receiptPath = 'docs/evidence/core-runtime-workflows.json';
const started = performance.now();
const deadline = started + 85_000;
const runId = randomUUID();
const checks = [];
let stage = 'preflight',
  requests = 0,
  sequence = 0,
  base;
class AcceptanceFailure extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function requireThat(condition, code) {
  if (!condition) throw new AcceptanceFailure(code);
}
function compose(args) {
  const result = spawnSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  requireThat(!result.error && result.status === 0, 'COMPOSE_DISCOVERY_FAILED');
  return result.stdout.trim();
}
function remaining() {
  const value = Math.floor(deadline - performance.now());
  if (value <= 0) throw new AcceptanceFailure('RUNTIME_DEADLINE_EXCEEDED');
  return value;
}
async function api(path, { method = 'GET', body, status = 200 } = {}) {
  requireThat(path.startsWith('/api/') && !path.startsWith('/api/ai/'), 'UNEXPECTED_API_PATH');
  requireThat(path !== '/api/recurring/generate' && path !== '/api/cron', 'MANUAL_WORKER_FORBIDDEN');
  requests++;
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'POST' ? { 'Idempotency-Key': `runtime-${runId}-${++sequence}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(Math.min(5000, remaining())),
      redirect: 'error',
    });
  } catch {
    throw new AcceptanceFailure('LOCAL_HTTP_REQUEST_FAILED');
  }
  if (response.status !== status) {
    await response.body?.cancel().catch(() => {});
    throw new AcceptanceFailure('UNEXPECTED_HTTP_STATUS', response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new AcceptanceFailure('INVALID_API_JSON');
  }
}
async function poll(observe, complete) {
  while (true) {
    remaining();
    const value = await observe();
    if (complete(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, Math.min(2000, remaining())));
  }
}
function cents(value) {
  requireThat(typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value), 'INVALID_REPORT_AMOUNT');
  return BigInt(value.replace('.', ''));
}
function totals(reports) {
  return {
    income: [reports.income.totalRevenue, reports.income.totalExpenses, reports.income.netIncome],
    balance: [reports.balance.totalAssets, reports.balance.totalLiabilities, reports.balance.totalEquity],
    trial: [reports.trial.totalDebits, reports.trial.totalCredits],
  };
}
async function reportsFor(date) {
  const period = new URLSearchParams({ from: `${date.slice(0, 7)}-01`, to: date });
  const [income, balance, trial] = await Promise.all([
    api(`/api/reports/income?${period}`),
    api(`/api/reports/balance?${period}`),
    api(`/api/reports/trial?${period}`),
  ]);
  requireThat(balance.balanced && balance.difference === '0.00', 'BALANCE_SHEET_NOT_BALANCED');
  requireThat(trial.balanced && trial.difference === '0.00', 'TRIAL_BALANCE_NOT_BALANCED');
  return { income, balance, trial };
}
function daysBefore(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}
async function run() {
  requireThat(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''), 'MISSING_CI_SOURCE_COMMIT');
  const container = compose(['ps', '--status', 'running', '--quiet', 'app']);
  requireThat(/^[a-f0-9]{12,64}$/.test(container), 'COMPOSE_APP_NOT_RUNNING');
  const address = compose(['port', 'app', '3001']);
  requireThat(/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(address), 'NON_LOOPBACK_COMPOSE_PORT');
  base = new URL(`http://${address}`);
  requireThat(Number(base.port) <= 65535, 'INVALID_COMPOSE_PORT');
  requireThat((await api('/api/health')).status === 'ok', 'HEALTH_CHECK_FAILED');
  const meta = await api('/api/meta');
  requireThat(
    meta.demo === true &&
      meta.organization?.id === '00000000-0000-4000-8000-000000000001' &&
      meta.organization.base_currency === 'USD' &&
      /^\d{4}-\d{2}-\d{2}$/.test(meta.today),
    'UNEXPECTED_CI_WORKSPACE',
  );
  const chart = await api('/api/accounts');
  const bank = chart.find((account) => account.code === '1010');
  const rent = chart.find((account) => account.code === '5010');
  requireThat(bank?.currency === 'USD' && bank.is_cash && !bank.archived, 'MISSING_DEMO_BANK');
  requireThat(rent?.currency === 'USD' && rent.type === 'EXPENSE' && !rent.archived, 'MISSING_DEMO_RENT');
  const lines = (amount) => [
    { accountId: rent.id, debit: amount, credit: '0', exchangeRate: '1', memo: '' },
    { accountId: bank.id, debit: '0', credit: amount, exchangeRate: '1', memo: '' },
  ];
  const before = await reportsFor(meta.today);

  stage = 'automatic_recurring_draft';
  const scheduleLabel = `Runtime schedule ${runId}`;
  const schedule = await api('/api/recurring', {
    method: 'POST',
    status: 201,
    body: {
      name: scheduleLabel,
      description: scheduleLabel,
      counterparty: scheduleLabel,
      frequency: 'MONTHLY',
      anchorDate: meta.today,
      endDate: meta.today,
      lines: lines('12.34'),
    },
  });
  const search = `/api/entries?${new URLSearchParams({ search: scheduleLabel })}`;
  const scheduled = await poll(
    () => api(search),
    (page) => page.items?.length > 0,
  );
  requireThat(scheduled.items.length === 1 && !scheduled.nextCursor, 'DUPLICATE_SCHEDULE_OCCURRENCE');
  const draft = await api(`/api/entries/${scheduled.items[0].id}`);
  requireThat(
    draft.status === 'DRAFT' &&
      draft.source === 'RECURRING' &&
      draft.date === meta.today &&
      draft.recurring_template_id === schedule.id &&
      draft.occurrence_date === meta.today,
    'INVALID_AUTOMATIC_DRAFT',
  );
  requireThat(
    JSON.stringify(totals(await reportsFor(meta.today))) === JSON.stringify(totals(before)),
    'DRAFT_CHANGED_REPORTS',
  );
  checks.push({ name: 'normal scheduler created one due draft without manual generation', passed: true });
  checks.push({ name: 'unposted recurring draft leaves all three report totals unchanged', passed: true });

  stage = 'reviewed_recurring_post';
  const posted = await api(`/api/entries/${draft.id}/post`, {
    method: 'POST',
    body: { expectedRevision: draft.revision },
  });
  requireThat(posted.status === 'POSTED', 'REVIEWED_POST_FAILED');
  const after = await reportsFor(meta.today);
  requireThat(
    cents(after.income.totalExpenses) - cents(before.income.totalExpenses) === 1234n,
    'POSTED_EXPENSE_DELTA_WRONG',
  );
  requireThat(
    cents(after.balance.totalAssets) - cents(before.balance.totalAssets) === -1234n,
    'POSTED_ASSET_DELTA_WRONG',
  );
  requireThat(
    cents(after.balance.totalEquity) - cents(before.balance.totalEquity) === -1234n,
    'POSTED_EQUITY_DELTA_WRONG',
  );
  requireThat((await api(search)).items.length === 1, 'POSTING_DUPLICATED_OCCURRENCE');
  checks.push({ name: 'explicit posting changes expenses/assets/equity by exactly USD 12.34', passed: true });

  stage = 'automatic_anomaly_detection';
  const vendor = `Runtime history ${runId}`;
  async function postExpense(amount, date) {
    const saved = await api('/api/entries', {
      method: 'POST',
      status: 201,
      body: {
        date,
        description: vendor,
        counterparty: vendor,
        reference: '',
        source: 'MANUAL',
        lines: lines(amount),
      },
    });
    return api(`/api/entries/${saved.id}/post`, {
      method: 'POST',
      body: { expectedRevision: saved.revision },
    });
  }
  for (const days of [40, 30, 20, 10]) await postExpense('1000', daysBefore(meta.today, days));
  const unusual = await postExpense('2000', meta.today);
  const rule = `UNUSUAL_AMOUNT:${rent.id}`;
  const open = await poll(
    () => api('/api/alerts?status=OPEN'),
    (rows) => rows.some((alert) => alert.entry_id === unusual.id && alert.rule === rule),
  );
  const alert = open.find((row) => row.entry_id === unusual.id && row.rule === rule);
  requireThat(
    alert.status === 'OPEN' &&
      alert.evidence?.median === '1000.00' &&
      alert.evidence.observed === '2000.00' &&
      alert.evidence.sampleCount === 4,
    'ANOMALY_EVIDENCE_WRONG',
  );
  checks.push({
    name: 'normal background worker detected doubled rent from four real posted samples',
    passed: true,
  });

  stage = 'automatic_anomaly_resolution';
  const reversal = await api(`/api/entries/${unusual.id}/reverse`, {
    method: 'POST',
    status: 201,
    body: { date: meta.today },
  });
  const beforeResolution = await reportsFor(meta.today);
  const resolved = await poll(
    () => api('/api/alerts?status=RESOLVED'),
    (rows) => rows.some((row) => row.id === alert.id),
  );
  const historical = resolved.find((row) => row.id === alert.id);
  requireThat(
    historical.resolution_reason === 'ENTRY_REVERSED' &&
      historical.resolution_entry_id === reversal.id &&
      Boolean(historical.resolved_at) &&
      JSON.stringify(historical.evidence) === JSON.stringify(alert.evidence),
    'RESOLUTION_HISTORY_WRONG',
  );
  requireThat(
    JSON.stringify((await api(`/api/entries/${unusual.id}`)).lines) === JSON.stringify(unusual.lines),
    'WORKER_CHANGED_POSTED_LINES',
  );
  requireThat(
    JSON.stringify(totals(await reportsFor(meta.today))) === JSON.stringify(totals(beforeResolution)),
    'WORKER_CHANGED_FINANCIAL_REPORTS',
  );
  const rejected = await api(`/api/alerts/${alert.id}`, {
    method: 'PATCH',
    status: 409,
    body: { status: 'OPEN' },
  });
  requireThat(rejected.error?.code === 'ALERT_RESOLVED', 'RESOLVED_ALERT_REOPEN_NOT_REJECTED');
  checks.push({
    name: 'reversal job automatically resolved the same alert with retained evidence',
    passed: true,
  });
  checks.push({ name: 'worker preserved posted lines and financial report totals', passed: true });
  checks.push({ name: 'automatically resolved signal cannot be manually reopened', passed: true });
}

let failure;
try {
  await run();
} catch (error) {
  failure = {
    stage,
    code: error instanceof AcceptanceFailure ? error.code : 'ACCEPTANCE_CHECK_FAILED',
    ...(error instanceof AcceptanceFailure && Number.isInteger(error.status) ? { status: error.status } : {}),
  };
}
const receipt = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  sourceCommit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : 'unknown',
  runId,
  environment: 'Disposable GitHub Actions Compose workspace; real PostgreSQL and application timers',
  passed: !failure,
  durationMs: Math.round(performance.now() - started),
  httpRequests: requests,
  manualSchedulerOrWorkerCalls: 0,
  providerEndpointCalls: 0,
  checks,
  ...(failure ? { failure } : {}),
  limitations: [
    'Observed normal monthly scheduling and anomaly processing in CI, not hosted Vercel cron firing.',
    'Weekly/yearly calendar boundaries and crash/lease recovery have separate database tests.',
    'This is synthetic acceptance evidence, not model accuracy, load testing or real-user usability.',
  ],
};
await mkdir('docs/evidence', { recursive: true });
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(
  JSON.stringify({
    event: 'runtime_acceptance',
    passed: receipt.passed,
    checks: checks.length,
    durationMs: receipt.durationMs,
    ...(failure ? { failure } : {}),
  }),
);
if (failure) process.exitCode = 1;
