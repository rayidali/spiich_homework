import { z } from 'zod';
import type { FinancialQuery } from './financial-analysis';

const scalarGrouping = z.enum(['total', 'account', 'month', 'quarter', 'counterparty', 'entry']);
const compoundDimension = z.enum(['account', 'counterparty', 'month', 'quarter']);
export type CompoundDimension = z.infer<typeof compoundDimension>;
export const groupingSchema = z.union([
  scalarGrouping,
  z
    .array(compoundDimension)
    .min(2)
    .max(3)
    .refine(
      (dimensions) =>
        new Set(dimensions).size === dimensions.length &&
        dimensions.filter((dimension) => dimension === 'month' || dimension === 'quarter').length <= 1,
      'Compound grouping needs unique dimensions and at most one time grain.',
    ),
]);
export type FinancialGrouping = z.infer<typeof groupingSchema>;
export type GroupDimension = {
  kind: CompoundDimension;
  key: string;
  label: string;
  accountId?: string;
};
export const MAX_COMPOUND_CELLS = 30_000;
export const groupingDimensions = (grouping: FinancialGrouping) =>
  Array.isArray(grouping) ? grouping : [grouping];
export const groupingPeriod = (grouping: FinancialGrouping): 'month' | 'quarter' | undefined =>
  groupingDimensions(grouping).find((dimension) => dimension === 'month' || dimension === 'quarter');
// Codes are unique within the execution snapshot and visible in the planner's
// chart. Actual immutable account IDs remain separate in dimension evidence.
// JSON tuple encoding is collision-free without URI expansion or label parsing.
export const compoundRowId = (dimensions: Pick<GroupDimension, 'kind' | 'key'>[]) =>
  `compound:${JSON.stringify(dimensions.map(({ kind, key }) => [kind, key]))}`;

/** Appends only code-owned SQL syntax to the existing validated ledger scope.
 * Every user value is already bound in the supplied prefix's parameters. */
export function compileCompoundGrouping(
  prefix: string,
  plan: FinancialQuery,
  isBalance: boolean,
  periodCount: number,
) {
  const dimensions = plan.groupBy as CompoundDimension[];
  const period = groupingPeriod(dimensions);
  const categories = dimensions.filter((dimension) => dimension !== 'month' && dimension !== 'quarter');
  const maxTuples = Math.floor(MAX_COMPOUND_CELLS / periodCount);
  const allAccounts = !!period && categories.length === 1 && categories[0] === 'account';
  const columns = categories.map((dimension, index) => {
    if (dimension === 'account')
      return allAccounts
        ? `a.id::text AS k${index},a.code AS key${index},a.code || ' · ' || a.name AS label${index}`
        : `m.account_id::text AS k${index},m.account_code AS key${index},m.account_code || ' · ' || m.account_name AS label${index}`;
    // Quoting named counterparties distinguishes a literal '(No counterparty)'
    // from the empty-header placeholder, without merging either identity.
    return `m.counterparty AS k${index},m.counterparty AS key${index},CASE WHEN m.counterparty='' THEN '(No counterparty)' ELSE to_jsonb(m.counterparty)::text END AS label${index}`;
  });
  const tupleSource = allAccounts ? 'account_scope a' : 'qualified_lines m';
  const timeKey = (date: string) =>
    period === 'month'
      ? `to_char(${date},'YYYY-MM')`
      : `to_char(${date},'YYYY') || '-Q' || to_char(${date},'Q')`;
  const periodSql = period
    ? `, periods AS (
        SELECT ${timeKey('bucket')} AS period_key,greatest(bucket::date,$2::date) AS period_from,
          least((bucket+interval '${period === 'month' ? '1 month' : '3 months'}'-interval '1 day')::date,$3::date) AS period_to
        FROM generate_series(date_trunc('${period}',$2::date),date_trunc('${period}',$3::date),interval '${period === 'month' ? '1 month' : '3 months'}') bucket)`
    : '';
  const categoryKeys = categories.map(
    (dimension, index) => `${dimension === 'account' ? 'm.account_id::text' : 'm.counterparty'} AS k${index}`,
  );
  const groupingKeys = [
    ...categories.map((dimension) => (dimension === 'account' ? 'm.account_id::text' : 'm.counterparty')),
    ...(period ? [timeKey('m.date')] : []),
  ];
  const joins = [
    ...categories.map((_dimension, index) => `v.k${index}=g.k${index}`),
    ...(period ? ['v.period_key=g.period_key'] : []),
  ];
  const aggregates = isBalance
    ? `, grid_values AS (
        SELECT g.*,v.value,v.entry_count FROM grid g CROSS JOIN LATERAL (
          SELECT coalesce(sum(m.amount),0) AS value,count(DISTINCT m.entry_id)::numeric AS entry_count
          FROM metric_lines m WHERE m.account_id::text=g.k${categories.indexOf('account')} AND m.date<=g.period_to
        ) v)`
    : `, grouped AS (
        SELECT ${categoryKeys.join(',')}${period ? `,${timeKey('m.date')} AS period_key` : ''},
          ${plan.metric === 'journal_count' ? 'count(DISTINCT m.entry_id)::numeric' : 'coalesce(sum(m.amount),0)'} AS value,
          count(DISTINCT m.entry_id)::numeric AS entry_count
        FROM qualified_lines m GROUP BY ${groupingKeys.join(',')}
      ), grid_values AS (
        SELECT g.*,coalesce(v.value,0) AS value,coalesce(v.entry_count,0) AS entry_count
        FROM grid g LEFT JOIN grouped v ON ${joins.join(' AND ')})`;
  const dimensionJson = dimensions.map((dimension) => {
    if (dimension === 'month' || dimension === 'quarter')
      return `jsonb_build_object('kind','${dimension}','key',g.period_key,'label',g.period_key)`;
    const index = categories.indexOf(dimension);
    return `jsonb_build_object('kind','${dimension}','key',g.key${index},'label',g.label${index}${dimension === 'account' ? `,'accountId',g.k${index}` : ''})`;
  });
  const labels = dimensions.map((dimension) =>
    dimension === 'month' || dimension === 'quarter'
      ? 'g.period_key'
      : `g.label${categories.indexOf(dimension)}`,
  );
  const order =
    plan.order === 'label_asc'
      ? 'label ASC,dimensions::text ASC'
      : `result_value ${plan.order === 'value_desc' ? 'DESC' : 'ASC'} NULLS LAST,label ASC,dimensions::text ASC`;
  const value =
    plan.aggregation === 'average_per_entry'
      ? 'CASE WHEN g.entry_count=0 THEN NULL ELSE g.value/g.entry_count END'
      : 'g.value';
  return `${prefix},
    qualified_lines AS (SELECT m.* FROM metric_lines m JOIN qualified_entries q ON q.entry_id=m.entry_id),
    tuples AS (SELECT DISTINCT ${columns.join(',')} FROM ${tupleSource} LIMIT ${maxTuples + 1}),
    tuple_capacity AS (SELECT count(*)>${maxTuples} AS scope_overflow FROM tuples)
    ${periodSql},
    grid AS (SELECT t.*${period ? ',p.period_key,p.period_from,p.period_to' : ',NULL::date AS period_from,NULL::date AS period_to'}
      FROM tuples t ${period ? 'CROSS JOIN periods p' : ''} CROSS JOIN tuple_capacity capacity WHERE NOT capacity.scope_overflow)
    ${aggregates},
    results AS (SELECT concat_ws(' · ',${labels.join(',')}) AS label,${value} AS result_value,g.entry_count,
      g.period_from,g.period_to,jsonb_build_array(${dimensionJson.join(',')}) AS dimensions FROM grid_values g),
    output AS (
      SELECT label,result_value,entry_count,period_from,period_to,dimensions,false AS scope_overflow FROM results
      UNION ALL SELECT ''::text,NULL::numeric,0::numeric,NULL::date,NULL::date,NULL::jsonb,true FROM tuple_capacity WHERE scope_overflow
    )
    SELECT ''::text AS row_id,label,result_value::text AS value,entry_count::text,period_from::text,period_to::text,dimensions,scope_overflow
    FROM output ORDER BY ${order} LIMIT $11`;
}
