import { createHash } from 'node:crypto';
import { parse, deparse } from 'pgsql-parser';
import type { PoolClient } from 'pg';

export const ANALYST_SQL_LIMITS = Object.freeze({
  sqlBytes: 24_000,
  nodes: 4000,
  depth: 80,
  queries: 4,
  rows: 200,
  columns: 40,
  valueBytes: 16_000,
  resultBytes: 384_000,
  params: 64,
  statementMs: 3500,
  lockMs: 750,
  batchMs: 12_000,
  cleanupMs: 750,
});
export type AnalystSqlQuery = { id: string; sql: string; params?: (string | number | boolean | null)[] };
export type AnalystSqlRunOptions = {
  signal?: AbortSignal;
  /** Absolute performance.now() deadline; never a wall-clock or persisted time. */
  deadline?: number;
};
export type AnalystSqlColumn = {
  name: string;
  oid: number;
  kind: 'decimal' | 'integer' | 'float' | 'boolean' | 'date' | 'timestamp' | 'json' | 'text';
};
export type AnalystSqlResult = {
  id: string;
  sql: string;
  params: NonNullable<AnalystSqlQuery['params']>;
  organizationId: string;
  executedAt: string;
  columns: AnalystSqlColumn[];
  rows: (string | null)[][];
  rowCount: number;
  truncated: boolean;
  hash: string;
};
export class AnalystSqlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly sqlState?: string,
  ) {
    super(message);
    this.name = 'AnalystSqlError';
  }
}
const fail = (code: string, message: string): never => {
  throw new AnalystSqlError(code, message);
};
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const names = (value: unknown): string[] =>
  list(value).map((item) => String(obj(obj(item).String).sval ?? ''));
const views = new Set([
  'organization',
  'currencies',
  'accounts',
  'entries',
  'lines',
  'ledger',
  'recurring',
  'alerts',
]);
const functions = new Set([
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'abs',
  'round',
  'trunc',
  'ceil',
  'ceiling',
  'floor',
  'sign',
  'mod',
  'power',
  'sqrt',
  'ln',
  'log',
  'exp',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'corr',
  'covar_pop',
  'covar_samp',
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  'percentile_cont',
  'percentile_disc',
  'mode',
  'grouping',
  'date_trunc',
  'date_part',
  'extract',
  'age',
  'make_date',
  'make_interval',
  'to_date',
  'to_char',
  'timezone',
  'lower',
  'upper',
  'length',
  'char_length',
  'character_length',
  'octet_length',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'substring',
  'substr',
  'position',
  'strpos',
  'replace',
  'regexp_replace',
  'regexp_match',
  'regexp_matches',
  'regexp_split_to_array',
  'similar_to_escape',
  'split_part',
  'concat',
  'concat_ws',
  'left',
  'right',
  'string_agg',
  'array_agg',
  'array_length',
  'cardinality',
  'unnest',
  'generate_series',
  'jsonb_array_elements',
  'jsonb_array_elements_text',
  'jsonb_each',
  'jsonb_each_text',
  'jsonb_array_length',
  'jsonb_extract_path',
  'jsonb_extract_path_text',
  'jsonb_typeof',
  'jsonb_build_object',
  'jsonb_build_array',
  'jsonb_agg',
  'json_array_elements',
  'json_array_elements_text',
  'json_each',
  'json_each_text',
  'json_array_length',
  'json_extract_path',
  'json_extract_path_text',
  'json_typeof',
  'json_build_object',
  'json_build_array',
  'json_agg',
  'to_json',
  'to_jsonb',
  'bool_and',
  'bool_or',
  'every',
]);
const types = new Set([
  'text',
  'varchar',
  'bpchar',
  'name',
  'bool',
  'boolean',
  'int2',
  'int4',
  'int8',
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'decimal',
  'float4',
  'float8',
  'real',
  'double precision',
  'date',
  'timestamp',
  'timestamptz',
  'time',
  'timetz',
  'interval',
  'uuid',
  'json',
  'jsonb',
]);
const operators = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '||',
  '~~',
  '!~~',
  '~~*',
  '!~~*',
  '->',
  '->>',
  '#>',
  '#>>',
  '@>',
  '<@',
  '?',
  '?|',
  '?&',
  '&&',
  '~',
  '~*',
  '!~',
  '!~*',
]);
const nodes = new Set([
  'SelectStmt',
  'ResTarget',
  'ColumnRef',
  'A_Star',
  'A_Const',
  'FuncCall',
  'TypeCast',
  'A_Expr',
  'BoolExpr',
  'NullTest',
  'BooleanTest',
  'CaseExpr',
  'CaseWhen',
  'CoalesceExpr',
  'MinMaxExpr',
  'SQLValueFunction',
  'SubLink',
  'RangeSubselect',
  'RangeFunction',
  'JoinExpr',
  'RangeVar',
  'RowExpr',
  'A_ArrayExpr',
  'A_Indirection',
  'A_Indices',
  'ParamRef',
  'GroupingSet',
  'GroupingFunc',
  'WindowDef',
  'SortBy',
  'String',
  'List',
  'Integer',
  'Float',
  'Boolean',
  'BitString',
  'NamedArgExpr',
  'Alias',
  'CollateClause',
]);
const sqlValues = new Set([
  'SVFOP_CURRENT_DATE',
  'SVFOP_CURRENT_TIME',
  'SVFOP_CURRENT_TIME_N',
  'SVFOP_CURRENT_TIMESTAMP',
  'SVFOP_CURRENT_TIMESTAMP_N',
  'SVFOP_LOCALTIME',
  'SVFOP_LOCALTIME_N',
  'SVFOP_LOCALTIMESTAMP',
  'SVFOP_LOCALTIMESTAMP_N',
]);

/** SQL syntax/capabilities, not a financial-question classifier. DB views enforce workspace scope. */
export async function validateAnalystSql(
  input: AnalystSqlQuery,
): Promise<AnalystSqlQuery & { params: NonNullable<AnalystSqlQuery['params']> }> {
  if (!input || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.id ?? ''))
    fail('ANALYST_SQL_INPUT', 'Use a short unique query ID.');
  if (
    typeof input.sql !== 'string' ||
    !input.sql.trim() ||
    Buffer.byteLength(input.sql) > ANALYST_SQL_LIMITS.sqlBytes
  )
    fail('ANALYST_SQL_LIMIT', 'The SQL is empty or exceeds its size limit.');
  const params = input.params ?? [];
  if (
    !Array.isArray(params) ||
    params.length > ANALYST_SQL_LIMITS.params ||
    params.some(
      (p) =>
        (p !== null && !['string', 'number', 'boolean'].includes(typeof p)) ||
        (typeof p === 'number' && !Number.isSafeInteger(p)) ||
        (typeof p === 'string' && Buffer.byteLength(p) > ANALYST_SQL_LIMITS.valueBytes),
    )
  )
    fail(
      'ANALYST_SQL_INPUT',
      'SQL parameters must be bounded scalar values. Use exact decimal strings for fractional amounts; numeric parameters must be safe integers.',
    );
  let tree: Awaited<ReturnType<typeof parse>>;
  try {
    tree = await parse(input.sql);
  } catch {
    return fail('ANALYST_SQL_PARSE', 'PostgreSQL could not parse this SQL. Correct its syntax and retry.');
  }
  const statements = list(obj(tree).stmts);
  if (statements.length !== 1 || !obj(obj(statements[0]).stmt).SelectStmt)
    fail('ANALYST_SQL_POLICY', 'Only one read-only SELECT, including SELECT CTEs, is allowed.');
  let count = 0;
  const checkComplexity = (depth: number) => {
    if (depth > ANALYST_SQL_LIMITS.depth || ++count > ANALYST_SQL_LIMITS.nodes)
      fail('ANALYST_SQL_LIMIT', 'This query is too complex. Split the investigation into smaller queries.');
  };
  const qualify = (parts: string[], allowed: Set<string>, description: string) => {
    if (
      !(parts.length === 1 || (parts.length === 2 && parts[0] === 'pg_catalog')) ||
      !allowed.has(parts.at(-1) ?? '')
    )
      fail('ANALYST_SQL_POLICY', `This ${description} is not available in the read-only analyst.`);
  };
  const select = (value: Obj, scope: Set<string>, depth: number) => {
    checkComplexity(depth);
    if (value.intoClause || list(value.lockingClause).length)
      fail('ANALYST_SQL_POLICY', 'SELECT INTO and row locking are not allowed.');
    const withClause = obj(value.withClause),
      ctes = list(withClause.ctes).map((c) => obj(obj(c).CommonTableExpr));
    const local = new Set(scope);
    if (withClause.recursive) for (const cte of ctes) local.add(String(cte.ctename));
    for (const cte of ctes) {
      if (typeof cte.ctename !== 'string' || !obj(cte.ctequery).SelectStmt)
        fail('ANALYST_SQL_POLICY', 'Every CTE must contain a read-only SELECT.');
      visit(cte.ctequery, local, depth + 1);
      for (const [key, item] of Object.entries(cte)) {
        if (key !== 'ctequery') visit(item, local, depth + 1);
      }
      local.add(cte.ctename as string);
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'withClause') continue;
      if ((key === 'larg' || key === 'rarg') && item) select(obj(item), local, depth + 1);
      else visit(item, local, depth + 1);
    }
  };
  const visit = (value: unknown, scope: Set<string>, depth: number): void => {
    checkComplexity(depth);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, scope, depth + 1);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Obj;
    for (const [key, item] of Object.entries(record)) {
      if (/^[A-Z]/.test(key) && !nodes.has(key))
        fail('ANALYST_SQL_POLICY', `SQL node ${key} is not supported by this read-only boundary.`);
      const node = obj(item);
      if (key === 'SelectStmt') {
        select(node, scope, depth + 1);
        continue;
      }
      if (key === 'RangeVar') {
        if (
          node.catalogname ||
          (node.schemaname && node.schemaname !== 'analytics') ||
          !(node.schemaname
            ? views.has(String(node.relname))
            : scope.has(String(node.relname)) || views.has(String(node.relname)))
        )
          fail('ANALYST_SQL_POLICY', 'Use only the available analytics views or a SELECT CTE.');
      }
      if (key === 'FuncCall') qualify(names(node.funcname), functions, 'function');
      if (key === 'TypeCast') qualify(names(obj(node.typeName).names), types, 'type cast');
      if (key === 'A_Expr') {
        const between: Record<string, string> = {
          AEXPR_BETWEEN: 'BETWEEN',
          AEXPR_NOT_BETWEEN: 'NOT BETWEEN',
          AEXPR_BETWEEN_SYM: 'BETWEEN SYMMETRIC',
          AEXPR_NOT_BETWEEN_SYM: 'NOT BETWEEN SYMMETRIC',
        };
        const expected = between[String(node.kind)];
        if (expected) {
          if (
            JSON.stringify(names(node.name)) !== JSON.stringify([expected]) ||
            list(obj(node.rexpr).List ? obj(obj(node.rexpr).List).items : []).length !== 2
          )
            fail('ANALYST_SQL_POLICY', 'The BETWEEN expression has an unsupported shape.');
        } else qualify(names(node.name), operators, 'operator');
      }
      if (key === 'CollateClause')
        qualify(names(node.collname), new Set(['C', 'POSIX', 'default']), 'collation');
      if (key === 'SortBy' && list(node.useOp).length) qualify(names(node.useOp), operators, 'sort operator');
      if (key === 'SQLValueFunction' && !sqlValues.has(String(node.op)))
        fail('ANALYST_SQL_POLICY', 'Session identity is not financial data.');
      if (
        key === 'ParamRef' &&
        (!Number.isSafeInteger(node.number) || Number(node.number) < 1 || Number(node.number) > params.length)
      )
        fail('ANALYST_SQL_INPUT', 'A SQL parameter is missing.');
      visit(item, scope, depth + 1);
    }
  };
  visit(obj(statements[0]).stmt, new Set(), 0);
  // Re-serialize the validated AST. This makes wrapping independent of comments,
  // Unicode byte offsets and trailing semicolons in the model's source text.
  let sql: string;
  try {
    sql = (await deparse(tree)).trim().replace(/;\s*$/, '');
  } catch {
    return fail('ANALYST_SQL_PARSE', 'This SQL could not be serialized safely. Simplify its syntax.');
  }
  // Check the exact serialized SQL that will execute as well as the input AST.
  let canonical: Awaited<ReturnType<typeof parse>>;
  try {
    canonical = await parse(sql);
  } catch {
    return fail('ANALYST_SQL_PARSE', 'SQL serialization could not be parsed safely.');
  }
  const canonicalStatements = list(obj(canonical).stmts);
  if (canonicalStatements.length !== 1 || !obj(obj(canonicalStatements[0]).stmt).SelectStmt)
    fail('ANALYST_SQL_POLICY', 'SQL serialization did not retain one read-only SELECT.');
  count = 0;
  visit(obj(canonicalStatements[0]).stmt, new Set(), 0);
  return { id: input.id, sql, params: [...params] };
}

const kind = (oid: number): AnalystSqlColumn['kind'] =>
  oid === 1700
    ? 'decimal'
    : [20, 21, 23].includes(oid)
      ? 'integer'
      : [700, 701].includes(oid)
        ? 'float'
        : oid === 16
          ? 'boolean'
          : oid === 1082
            ? 'date'
            : [1114, 1184].includes(oid)
              ? 'timestamp'
              : [114, 3802].includes(oid)
                ? 'json'
                : 'text';
const resultHash = (value: Omit<AnalystSqlResult, 'executedAt' | 'hash'>) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function executionError(error: unknown): AnalystSqlError {
  if (error instanceof AnalystSqlError) return error;
  const code = String(obj(error).code ?? '');
  const safe = new Set([
    '42703',
    '42P01',
    '42883',
    '42601',
    '42804',
    '42803',
    '22P02',
    '22012',
    '22003',
    '42P10',
  ]);
  const message =
    safe.has(code) && typeof obj(error).message === 'string'
      ? String(obj(error).message).slice(0, 600)
      : code === '57014'
        ? 'The query exceeded its time limit. Narrow or simplify it.'
        : code === '42501'
          ? 'The read-only analyst cannot access that database object.'
          : 'The financial query could not be completed.';
  return new AnalystSqlError('ANALYST_SQL_EXECUTION', message, /^[A-Z0-9]{5}$/.test(code) ? code : undefined);
}

export function createAnalystSql(options: {
  connect: () => Promise<PoolClient>;
  now?: () => Date;
  monotonicNow?: () => number;
}) {
  const batch = async (
    organizationId: string,
    inputs: AnalystSqlQuery[],
    run: AnalystSqlRunOptions = {},
  ): Promise<AnalystSqlResult[]> => {
    const monotonicNow = options.monotonicNow ?? (() => performance.now());
    if (run.deadline !== undefined && !Number.isFinite(run.deadline))
      fail('ANALYST_SQL_INPUT', 'The analysis deadline must be finite.');
    const deadline = Math.min(monotonicNow() + ANALYST_SQL_LIMITS.batchMs, run.deadline ?? Infinity);
    if (!uuid.test(organizationId)) fail('ANALYST_SQL_INPUT', 'A valid workspace is required.');
    if (
      !Array.isArray(inputs) ||
      !inputs.length ||
      inputs.length > ANALYST_SQL_LIMITS.queries ||
      new Set(inputs.map((q) => q.id)).size !== inputs.length
    )
      fail('ANALYST_SQL_LIMIT', 'Use one to four queries with unique IDs.');
    let client: PoolClient | undefined;
    let released = false;
    let stopError: AnalystSqlError | undefined;
    let rejectStop: (error: AnalystSqlError) => void = () => {};
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStop = reject;
    });
    // The stop may arrive during parser setup, before the first await races it.
    void stopped.catch(() => undefined);
    const release = (discard: boolean) => {
      if (client && !released) {
        released = true;
        client.release(discard);
      }
    };
    const stop = (error: AnalystSqlError) => {
      if (stopError) return;
      stopError = error;
      // pg removes this PoolClient and calls end(). An active, non-pipelined
      // query causes its underlying socket to be destroyed, not reused. The
      // server statement_timeout remains the backstop behind pooled proxies.
      try {
        release(true);
      } finally {
        rejectStop(error);
      }
    };
    const timedOut = () =>
      stop(
        new AnalystSqlError(
          'ANALYST_SQL_TIMEOUT',
          'The analysis query allowance expired. Narrow the queries and try again.',
        ),
      );
    const abort = () => stop(new AnalystSqlError('ANALYST_SQL_CANCELLED', 'The analysis was stopped.'));
    const check = () => {
      if (run.signal?.aborted) abort();
      if (monotonicNow() >= deadline) timedOut();
      if (stopError) throw stopError;
    };
    const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
      check();
      const result = await Promise.race([work(), stopped]);
      check();
      return result;
    };
    const timer = setTimeout(timedOut, Math.max(0, deadline - monotonicNow()));
    run.signal?.addEventListener('abort', abort, { once: true });
    let transactionOpen = false,
      discard = false;
    try {
      check();
      const plans = [];
      for (const input of inputs) plans.push(await bounded(() => validateAnalystSql(input)));
      await bounded(async () => {
        client = await options.connect();
        // A pool acquisition cannot be cancelled. Dispose any late delivery
        // before it can issue BEGIN or read data after this operation stopped.
        if (stopError) {
          release(true);
          throw stopError;
        }
      });
      const connection = client!;
      const query = <T extends import('pg').QueryResultRow = import('pg').QueryResultRow>(
        text: string,
        values?: unknown[],
      ) => bounded(() => connection.query<T>(text, values));
      await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transactionOpen = true;
      await query(
        "SELECT set_config('daybook.organization_id',$1,true),set_config('statement_timeout',$2,true),set_config('lock_timeout',$3,true)",
        [organizationId, `${ANALYST_SQL_LIMITS.statementMs}ms`, `${ANALYST_SQL_LIMITS.lockMs}ms`],
      );
      await query("SET LOCAL work_mem='4MB'");
      await query('SET LOCAL ROLE daybook_analyst_reader');
      await query('SET LOCAL search_path=pg_catalog,analytics,pg_temp');
      // Use the same scoped capability as every data read; the app role may have
      // no base-table visibility in isolated fixtures or future RLS deployments.
      const scope = await query(
        "SELECT set_config('TimeZone',timezone,true) AS timezone FROM analytics.organization",
      );
      if (scope.rows.length !== 1)
        fail('ANALYST_SQL_SCOPE', 'The selected business is not available for analysis.');
      const executedAt = (options.now?.() ?? new Date()).toISOString();
      const results: AnalystSqlResult[] = [];
      let totalBytes = 0;
      for (const plan of plans) {
        check();
        await query("SELECT set_config('statement_timeout',$1,true)", [
          `${Math.max(1, Math.floor(Math.min(ANALYST_SQL_LIMITS.statementMs, deadline - monotonicNow())))}ms`,
        ]);
        const raw = await bounded(() =>
          connection.query({
            text: `SELECT * FROM (${plan.sql}) AS analyst_result LIMIT ${ANALYST_SQL_LIMITS.rows + 1}`,
            values: plan.params,
            rowMode: 'array',
            types: { getTypeParser: () => (value: string) => value },
          }),
        );
        if (raw.fields.length > ANALYST_SQL_LIMITS.columns)
          fail('ANALYST_SQL_LIMIT', 'Return fewer columns.');
        const columns = raw.fields.map((f) => ({
          name: f.name,
          oid: f.dataTypeID,
          kind: kind(f.dataTypeID),
        }));
        if (new Set(columns.map((c) => c.name)).size !== columns.length)
          fail('ANALYST_SQL_INPUT', 'Give each output column a unique name.');
        const rows = raw.rows.slice(0, ANALYST_SQL_LIMITS.rows).map((row: unknown[]) =>
          row.map((value) => {
            if (value === null) return null;
            if (typeof value !== 'string' || Buffer.byteLength(value) > ANALYST_SQL_LIMITS.valueBytes)
              fail(
                'ANALYST_SQL_LIMIT',
                'A result value exceeds the supported preview size. Aggregate or narrow the query.',
              );
            return value as string;
          }),
        );
        const content = {
          id: plan.id,
          sql: plan.sql,
          params: plan.params,
          organizationId,
          columns,
          rows,
          rowCount: rows.length,
          truncated: raw.rows.length > ANALYST_SQL_LIMITS.rows,
        };
        totalBytes += Buffer.byteLength(JSON.stringify(content));
        if (totalBytes > ANALYST_SQL_LIMITS.resultBytes)
          fail('ANALYST_SQL_LIMIT', 'The result set is too large. Aggregate or narrow the queries.');
        results.push({ ...content, executedAt, hash: resultHash(content) });
      }
      await query('COMMIT');
      transactionOpen = false;
      return results;
    } catch (error) {
      if (transactionOpen && client && !released) {
        const cleanup = setTimeout(timedOut, ANALYST_SQL_LIMITS.cleanupMs);
        try {
          const connection = client;
          await bounded(() => connection.query('ROLLBACK'));
        } catch {
          discard = true;
        } finally {
          clearTimeout(cleanup);
        }
      }
      throw stopError ?? executionError(error);
    } finally {
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', abort);
      release(discard);
    }
  };
  return {
    batch,
    query: async (organizationId: string, input: AnalystSqlQuery, run?: AnalystSqlRunOptions) =>
      (await batch(organizationId, [input], run))[0],
    reexecute: async (organizationId: string, previous: AnalystSqlResult[], run?: AnalystSqlRunOptions) => {
      if (previous.some((result) => result.organizationId !== organizationId))
        fail('ANALYST_SQL_INPUT', 'These query results belong to another workspace.');
      const results = await batch(
        organizationId,
        previous.map(({ id, sql, params }) => ({ id, sql, params })),
        run,
      );
      return {
        results,
        changedQueryIds: results
          .filter((result, index) => result.hash !== previous[index].hash)
          .map((result) => result.id),
      };
    },
  };
}
