import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Decimal } from '../../shared/money';
import { config } from '../../server/config';
import { parseInsightArgs, runInsightTool } from '../../server/ai';
import { executeFinancialAnalysis } from '../../server/financial-analysis';
import { executeFinancialScenario } from '../../server/financial-calculation';
import { clarificationAnswer } from '../../server/chat-clarification';
import { hash } from './io';
import { sourceFingerprint } from './controller';
import { normalizeAnalysis } from './normalize';
import { scoreCase, type Execution, type ScoredFact } from './scoring';
import type { EvaluationCase, Fixture, RecordedCall, RecordedOutcome } from './types';

export type ReplayBundle = {
  version: 'daybook-chat-replay-v1';
  sourceHash: string;
  fixture: Fixture;
  fixtureHash: string;
  cases: EvaluationCase[];
  outcomes: RecordedOutcome[];
};
/** A second barrier beyond "test": this seed accepts only the disposable GitHub Actions Postgres service. */
export function assertReplayDatabase(runtime: string, owner: string, env = process.env) {
  const r = new URL(runtime),
    o = new URL(owner);
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.NODE_ENV !== 'test' ||
    !['127.0.0.1', 'localhost'].includes(r.hostname) ||
    r.hostname !== o.hostname ||
    r.port !== o.port ||
    r.pathname !== '/spiich' ||
    o.pathname !== '/spiich' ||
    decodeURIComponent(r.username) !== 'spiich_app' ||
    decodeURIComponent(o.username) !== 'spiich' ||
    r.protocol !== 'postgres:' ||
    o.protocol !== 'postgres:'
  )
    throw Error('CHAT_REPLAY_REQUIRES_DISPOSABLE_CI_DATABASE');
}
async function fingerprint(client: pg.Client, orgs: string[]) {
  const result = await client.query(
    `SELECT jsonb_build_object(
 'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM accounts a WHERE organization_id=ANY($1::uuid[])),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM journal_entries e WHERE organization_id=ANY($1::uuid[])),
 'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM journal_lines l WHERE organization_id=ANY($1::uuid[]))) AS data`,
    [orgs],
  );
  return hash(JSON.stringify(result.rows[0].data));
}
async function seedFixture(client: pg.Client, fixture: Fixture) {
  const ids = new Map<string, string>();
  for (const o of fixture.organizations) ids.set(o.id, randomUUID());
  for (const a of fixture.accounts) ids.set(a.id, randomUUID());
  for (const e of fixture.entries) {
    ids.set(e.id, randomUUID());
    for (const l of e.lines) ids.set(l.id, randomUUID());
  }
  const id = (v: string) => {
    const m = ids.get(v);
    if (!m) throw Error('CHAT_FIXTURE_REFERENCE');
    return m;
  };
  await client.query('BEGIN');
  try {
    for (const o of fixture.organizations)
      await client.query('INSERT INTO organizations(id,name,base_currency,timezone) VALUES($1,$2,$3,$4)', [
        id(o.id),
        `Chat evaluation ${o.name}`,
        o.base_currency,
        o.timezone,
      ]);
    const todo = [...fixture.accounts],
      created = new Set<string>();
    while (todo.length) {
      const i = todo.findIndex((a) => a.parent_id === null || created.has(a.parent_id));
      if (i < 0) throw Error('CHAT_FIXTURE_TREE');
      const a = todo.splice(i, 1)[0];
      await client.query(
        'INSERT INTO accounts(id,organization_id,code,name,type,currency,is_cash,is_group,archived,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id(a.id),
          id(a.organization_id),
          a.code,
          a.name,
          a.type,
          a.currency,
          a.is_cash,
          a.is_group,
          a.archived,
          a.parent_id ? id(a.parent_id) : null,
        ],
      );
      created.add(a.id);
    }
    for (const e of fixture.entries) {
      await client.query(
        'INSERT INTO journal_entries(id,organization_id,date,description,counterparty,reference,source,reverses_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id(e.id),
          id(e.organization_id),
          e.date,
          e.description,
          e.counterparty,
          e.reference,
          e.source,
          e.reverses_entry_id ? id(e.reverses_entry_id) : null,
        ],
      );
      for (const l of e.lines)
        await client.query(
          'INSERT INTO journal_lines(id,organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate,memo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            id(l.id),
            id(l.organization_id),
            id(l.entry_id),
            id(l.account_id),
            l.position,
            l.currency,
            l.debit,
            l.credit,
            l.exchange_rate,
            l.memo,
          ],
        );
      if (e.status === 'POSTED')
        await client.query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [
          id(e.id),
        ]);
    }
    // Stored generated amounts, status and all business fields are checked against the bound fixture, not assumed from inserts.
    const rows = (
      await client.query(
        `SELECT e.id AS entry_id,e.organization_id,e.date::text,e.description,e.counterparty,e.reference,e.status,e.source,e.reverses_entry_id,
   l.id,l.account_id,l.position,l.currency,l.debit::text,l.credit::text,l.exchange_rate::text,l.base_debit::text,l.base_credit::text,l.memo
   FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.organization_id=ANY($1::uuid[]) ORDER BY e.id,l.position`,
        [fixture.organizations.map((o) => id(o.id))],
      )
    ).rows;
    if (rows.length !== fixture.entries.reduce((s, e) => s + e.lines.length, 0))
      throw Error('CHAT_FIXTURE_ROW_COUNT');
    for (const e of fixture.entries)
      for (const l of e.lines) {
        const r = rows.find((r) => r.id === id(l.id));
        if (!r) throw Error('CHAT_FIXTURE_MISSING_LINE');
        for (const key of ['date', 'description', 'counterparty', 'reference', 'status', 'source'] as const)
          if (r[key] !== e[key]) throw Error('CHAT_FIXTURE_CONTENT');
        for (const key of ['position', 'currency', 'memo'] as const)
          if (r[key] !== l[key]) throw Error('CHAT_FIXTURE_CONTENT');
        for (const key of ['debit', 'credit', 'exchange_rate', 'base_debit', 'base_credit'] as const)
          if (!new Decimal(r[key]).eq(l[key])) throw Error('CHAT_FIXTURE_AMOUNT');
        if (
          r.entry_id !== id(e.id) ||
          r.account_id !== id(l.account_id) ||
          r.organization_id !== id(e.organization_id) ||
          r.reverses_entry_id !== (e.reverses_entry_id ? id(e.reverses_entry_id) : null)
        )
          throw Error('CHAT_FIXTURE_SCOPE');
      }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  const mapped: Fixture = {
    ...fixture,
    primaryOrganizationId: id(fixture.primaryOrganizationId),
    foreignOrganizationId: id(fixture.foreignOrganizationId),
    accounts: fixture.accounts.map((a) => ({
      ...a,
      id: id(a.id),
      organization_id: id(a.organization_id),
      parent_id: a.parent_id ? id(a.parent_id) : null,
    })),
    organizations: fixture.organizations.map((o) => ({ ...o, id: id(o.id) })),
  };
  return { mapped, ids, orgs: fixture.organizations.map((o) => id(o.id)) };
}
const amount = (v: string) => {
  if (!/^-?\$[0-9,]+(?:\.\d{2})?$/.test(v)) throw Error('CHAT_EVIDENCE_FORMAT');
  return new Decimal(v.replaceAll(',', '').replace('$', '')).toFixed(2);
};
function authoredFacts(
  call: RecordedCall,
  rows: { label: string; value: string }[],
  answer: string,
): ScoredFact[] {
  const p = call.args,
    scope = { from: p.from ?? null, to: p.to ?? null, asOf: null, status: 'POSTED', currencyMode: 'base' };
  const sum = () => rows.reduce((s, r) => s.plus(amount(r.value)), new Decimal(0)).toFixed(2);
  const f = (metric: string, value: string, s: Record<string, unknown>): ScoredFact => ({
    metric,
    value,
    unit: 'USD',
    scope: s,
    proof: { tool: call.name, args: p },
  });
  if (call.name === 'expense_by_account')
    return [f('net_expense', sum(), { ...scope, accountCodes: [p.accountCode] })];
  if (call.name === 'cash_position')
    return [f('cash_balance', sum(), { ...scope, from: null, to: null, asOf: p.asOf })];
  if (call.name === 'income_summary')
    return [f(`net_${p.metric === 'expenses' ? 'expense' : p.metric}`, amount(rows[0].value), scope)];
  if (call.name === 'expense_summary' && p.view === 'total')
    return [f('net_expense', amount(rows[0].value), scope)];
  if (call.name === 'period_comparison' || call.name === 'revenue_comparison') {
    const metric = call.name === 'revenue_comparison' ? 'revenue' : p.metric,
      kind = `net_${metric === 'expenses' ? 'expense' : metric}`;
    const a = amount(rows[0].value),
      b = amount(rows[1].value),
      delta = new Decimal(a).minus(b).toFixed(2);
    const rendered = answer.match(/-?\$[0-9,]+(?:\.\d{2})?/g);
    if (!rendered || rendered.length < 3 || amount(rendered[2]) !== delta)
      throw Error('CHAT_COMPARISON_RENDER');
    return [
      f(kind, a, scope),
      f(kind, b, { ...scope, from: p.previousFrom, to: p.previousTo }),
      f('difference', delta, { ...scope, previousFrom: p.previousFrom, previousTo: p.previousTo }),
    ];
  }
  return [];
}
export async function executeRecorded(
  fixture: Fixture,
  call: RecordedCall,
  messages: EvaluationCase['messages'],
): Promise<Execution> {
  const args = parseInsightArgs(call.name, call.args),
    org = fixture.primaryOrganizationId;
  if (call.name === 'request_details')
    return {
      facts: [],
      answer: clarificationAnswer(
        args,
        fixture.accounts.filter((a) => a.organization_id === org),
      ),
      truncated: false,
      clarification: args as Execution['clarification'],
    };
  if (call.name === 'ask_clarification')
    return { facts: [], answer: String(args.question), truncated: false };
  if (call.name === 'financial_analysis' || call.name === 'financial_scenario') {
    const result =
      call.name === 'financial_analysis'
        ? await executeFinancialAnalysis(org, args)
        : await executeFinancialScenario(org, args, messages);
    const analysis = result.facts.filter((f) => 'queryId' in f);
    return {
      facts: normalizeAnalysis(analysis, fixture),
      answer: result.answer,
      truncated: analysis.some((f) => f.truncated),
      ...(call.name === 'financial_scenario' ? { scenario: result.facts.filter((f) => 'kind' in f) } : {}),
    };
  }
  const result = await runInsightTool(org, call.name, args);
  return {
    facts: authoredFacts({ ...call, args }, result.evidence.rows, result.answer),
    answer: result.answer,
    truncated: false,
  };
}
export async function replay(bundle: ReplayBundle) {
  assertReplayDatabase(config.databaseUrl, config.migrationUrl);
  if (
    bundle.version !== 'daybook-chat-replay-v1' ||
    sourceFingerprint().hash !== bundle.sourceHash ||
    hash(JSON.stringify(bundle.fixture)) !== bundle.fixtureHash
  )
    throw Error('CHAT_REPLAY_BINDING');
  if (
    bundle.outcomes.some((o) => o.sourceHash !== bundle.sourceHash) ||
    new Set(bundle.outcomes.map((o) => o.slot)).size !== bundle.outcomes.length
  )
    throw Error('CHAT_REPLAY_SOURCE_OR_DUPLICATE');
  const client = new pg.Client({ connectionString: config.migrationUrl });
  await client.connect();
  try {
    const { mapped, ids, orgs } = await seedFixture(client, bundle.fixture),
      before = await fingerprint(client, orgs),
      results = [];
    const reverseIds = new Map([...ids].map(([old, current]) => [current, old]));
    for (const outcome of bundle.outcomes) {
      const c = bundle.cases.find((c) => c.id === outcome.caseId);
      if (!c) throw Error('CHAT_REPLAY_CASE');
      const started = performance.now();
      let execution: Execution | undefined;
      if (outcome.status === 'valid_plan' && outcome.call)
        try {
          execution = await executeRecorded(mapped, outcome.call, c.messages);
          for (const f of execution.facts)
            if (typeof f.scope.entryId === 'string')
              f.scope.entryId = reverseIds.get(f.scope.entryId) ?? f.scope.entryId;
        } catch {
          execution = {
            facts: [],
            answer: '',
            truncated: false,
            errorCode: 'ACTUAL_PRODUCT_EXECUTION_FAILED',
          };
        }
      results.push({
        slot: outcome.slot,
        route: outcome.route,
        executionMs: performance.now() - started,
        execution,
        score: scoreCase(c, outcome.call, execution),
      });
    }
    const after = await fingerprint(client, orgs);
    if (before !== after) throw Error('CHAT_REPLAY_MUTATED_FIXTURE');
    return {
      version: 'daybook-chat-replay-result-v1',
      sourceHash: bundle.sourceHash,
      before,
      after,
      unchanged: true,
      temporaryOrganizations: orgs.length,
      results,
    };
  } finally {
    await client.end();
  }
}
