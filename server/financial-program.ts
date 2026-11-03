import { z } from 'zod';
import type { FinancialTool, ModelMessages } from './ai-provider';
import { financialScenarioSchema, scenarioAssumptionEvidence } from './financial-calculation';
import {
  executeFinancialAnalysis,
  financialQuerySchema,
  publicFinancialQuerySchema,
  type AnalysisFacts,
  type FinancialAnalysisOptions,
} from './financial-analysis';
import { executeAnalysisProgram, type AnalysisProgramInputTable } from './analysis-program';
import { AppError } from './errors';
import type { InsightEvidence } from '../shared/financial-evidence';
import { diagnostic } from './diagnostics';

export const financialProgramSchema = z.strictObject({
  queries: z.array(financialQuerySchema).min(1).max(4),
  code: z.string().min(1).max(16384),
  parameters: z
    .array(
      financialScenarioSchema.shape.assumptions.element.extend({
        unit: z.enum(['USD', 'count', 'ratio']),
      }),
    )
    .max(8)
    .default([]),
});
export const financialProgramRepairSchema = financialProgramSchema.pick({ code: true });
const repairParameters = z.toJSONSchema(financialProgramRepairSchema);
delete repairParameters.$schema;
export const financialProgramRepairTool: FinancialTool = {
  type: 'function',
  name: 'repair_financial_program',
  strict: true,
  parameters: repairParameters,
  description:
    'Correct only the JavaScript function body using the supplied execution error and original question. The already-read queries and records are frozen. Return code only; preserve the requested meaning, output, scope and all financial constraints. No other tool or database access is available during repair.',
};

const parameters = z.toJSONSchema(
  financialProgramSchema.extend({ queries: z.array(publicFinancialQuerySchema).min(1).max(4) }),
);
delete parameters.$schema;

export const financialProgramTool: FinancialTool = {
  type: 'function',
  name: 'financial_program',
  strict: true,
  parameters,
  description: `Write a JavaScript analysis function over exact ledger query results. Use this for percentages, repeated calculations across months/categories, cumulative amounts, medians, rankings, changes and combinations not expressed by a single report. This is general generated computation, not a predefined list of business formulas. Supply queries and a code string containing a synchronous FUNCTION BODY (no enclosing function declaration required). The server queries a consistent snapshot, then runs the body in an isolated interpreter with tables and calc arguments. No database, network, files, modules, credentials, eval of host code, or writes are available.
tables is an array: [{id,rows:[{id,label,from,to,dimensions,value}],truncated:false}]. Find tables by their query id. A row's value is an opaque exact-value HANDLE, never a JavaScript number. Do all financial arithmetic with calc: add(a,b),sub(a,b),mul(a,b),div(a,b),abs(a),sum(handles),mean(handles),median(handles),min(handles),max(handles),compare(a,b),isNull(a),count(handles). These return handles except compare (-1/0/1) and isNull (boolean). count accepts only distinct ORIGINAL source-row value handles, never repeated or derived values; count empty sources is zero. JavaScript functions, loops, map/filter/reduce/sort and conditional logic may compose them. No invented numeric financial inputs. Structural array indexes and slice limits are allowed. For an explicit user threshold or rate, supply parameters:[{id,value,unit,sourceText}] with an exact ORIGINAL USER quote, such as {id:"threshold",value:"0.5",unit:"ratio",sourceText:"50%"}. Use parameters:[] when none are needed. The application validates the quoted quantity and exposes its handle at tables.find(t=>t.id==='user_inputs').rows.find(r=>r.id==='threshold').value. These inputs are not recorded facts; any arithmetic result derived from them is labeled hypothetical. Do not construct constants by repeating source handles. Use financial_scenario for monthly-cost/duration units not supported here.
Return an array of 1..2 output tables: [{title:'short description',rows:[{label:'row label',value:HANDLE,format:'money'|'number'|'percent'}]}]. At most 64 output rows total. Money format requires USD; percent requires ratio and multiplies by100 only for display; number is for counts/ratios. Equal-unit div yields ratio. Zero denominators yield an explicit unavailable value; never replace with zero or drop quiet months. Output numeric literals or constructed handle strings are rejected. Labels are descriptions, not a place for invented numbers or conclusions.
For period-by-period calculations use calc.align(leftRows,rightRows), returning {left,right} pairs matched by actual period/dimension identities and dates, never array position. Missing or duplicate periods reject alignment. Example for a monthly share after confirming the denominator: const a=tables.find(t=>t.id==='category'); const b=tables.find(t=>t.id==='expenses'); return [{title:'Category share of total expenses by month',rows:calc.align(a.rows,b.rows).map(({left,right})=>({label:left.label,value:calc.div(left.value,right.value),format:'percent'}))}];
For a median: return [{title:'Median monthly spending',rows:[{label:'Median',value:calc.median(tables[0].rows.map(r=>r.value)),format:'money'}]}]; For cumulative sums sort actual period keys and compute calc.sum(prefix.map(r=>r.value)). Annual share is sum(numerators)/sum(denominators), not an unweighted mean of monthly shares. A requested percentage change is div(sub(current,previous),previous), with undefined zero baseline. Preserve signed refunds and explain negative-denominator interpretation if material.
All input queries must be complete, untruncated, in one posting status, and use stored base USD or counts. Raw account_balance arithmetic and per-entry averages are not supported; use approved flow metrics or cash_balance. Native-currency arithmetic needs a different tool. Keep every requested account, vendor, date, grain and output. A program cannot recover omitted rows or establish a causal business reason. Program provenance verifies where values came from, not whether your interpretation is correct.`,
};

export const financialProgramInstructions = `
Use financial_program when a requested calculation needs generated functions, repeating arithmetic over a table, percentages, cumulative amounts, ranks, median or other compositions over available ledger metrics. The eight scalar-step limit of financial_scenario does not apply to generated functions. Preserve the requested OUTPUT as well as the input filters across follow-ups: if the user asks for percentages and later supplies only "this year", still produce percentages for the original question. Two operand tables do not answer a percentage question. A request for both amounts and a derived result needs both; the program returns the derived table, and the application also displays its input evidence.
Clarify the denominator if a share/percentage question has not established it: expenses, revenue and annual spending answer different questions. For "for a year", ask which year or whether the user means the last twelve months; do not repeat a generic month/year menu after the duration has been supplied. Use discuss_business for a focused conversational clarification when available. This year means year to date unless a full calendar year is requested. Keep partial-current-month dates and distinguish no recorded spending from a real zero percentage. Do not refuse a supported computation merely because there is no named business function. Write a program from the available records, or explain the specific missing data. Never substitute a retrieval-only answer for requested arithmetic. User-supplied thresholds and rates require source-quoted parameters; other hypothetical units use financial_scenario.
Only the financial_program tool executes generated code, inside its isolated interpreter. Other tools never accept arbitrary SQL or code. General explanations must not claim a program or a query answered every part merely because it ran.`;

function invalid(message: string): never {
  throw new AppError(422, 'INVALID_ANALYSIS_PROGRAM', message);
}

/** Only server-produced facts enter the interpreter; the model supplies code,
 * never input amounts. This adapter keeps money scope and posting provenance. */
export function analysisProgramTables(org: string, facts: AnalysisFacts[]): AnalysisProgramInputTable[] {
  if (!facts.length || new Set(facts.map((fact) => fact.queryId)).size !== facts.length)
    invalid('The analysis requires unique recorded query results.');
  if (new Set(facts.map((fact) => fact.scope.plan.status)).size !== 1)
    invalid('Posted entries and drafts must be analysed separately.');
  return facts.map((fact) => {
    if (fact.scope.organizationId !== org) invalid('The analysis does not belong to this workspace.');
    if (fact.truncated) invalid('The input table is incomplete. Narrow the query before calculating.');
    if (fact.unit !== 'USD' && fact.unit !== 'count')
      invalid('Generated financial calculations require stored base USD or counts.');
    if (fact.scope.plan.currencyMode !== 'base')
      invalid('Generated financial calculations require one consistent base-currency view.');
    if (fact.metric === 'account_balance' || fact.aggregation !== 'sum')
      invalid(
        'Use flow totals, counts or a cash balance; do not combine account balances or per-entry averages.',
      );
    return {
      id: fact.queryId,
      truncated: fact.truncated,
      rows: fact.rows.map((row) => ({
        id: row.rowId,
        label: row.label,
        from: row.from,
        to: row.to,
        ...(row.balanceAsOf ? { balanceAsOf: row.balanceAsOf } : {}),
        ...(row.dimensions ? { dimensions: row.dimensions } : {}),
        value: row.value,
        unit: fact.unit as 'USD' | 'count',
        source: fact.scope.plan.status === 'POSTED' ? ('posted' as const) : ('draft' as const),
      })),
    };
  });
}

type ProgramOptions = FinancialAnalysisOptions & { messages?: ModelMessages };
export async function executeFinancialProgram(org: string, args: unknown, options: ProgramOptions = {}) {
  const prepared = await prepareFinancialProgram(org, args, options);
  return prepared.run(prepared.code);
}

export async function prepareFinancialProgram(org: string, args: unknown, options: ProgramOptions = {}) {
  const plan = financialProgramSchema.parse(args);
  if (plan.queries.some((query) => query.id === 'user_inputs'))
    invalid('The user_inputs table name is reserved for quoted user parameters.');
  if (new Set(plan.parameters.map((parameter) => parameter.id)).size !== plan.parameters.length)
    invalid('User parameter IDs must be unique.');
  const parameters = plan.parameters.map((parameter) =>
    scenarioAssumptionEvidence(parameter, options.messages ?? []),
  );
  if (plan.queries.some((query) => query.metric === 'account_balance' || query.aggregation !== 'sum'))
    invalid(
      'Use flow totals, counts or a cash balance; do not combine account balances or per-entry averages.',
    );
  if (new Set(plan.queries.map((query) => query.status)).size !== 1)
    invalid('Posted entries and drafts must be analysed separately.');
  if (plan.queries.some((query) => query.currencyMode !== 'base'))
    invalid('Generated financial calculations require one consistent base-currency view.');
  const queried = await executeFinancialAnalysis(org, { queries: plan.queries }, undefined, options);
  const tables = analysisProgramTables(org, queried.facts);
  if (parameters.length)
    tables.push({
      id: 'user_inputs',
      truncated: false,
      rows: parameters.map((parameter) => ({
        id: parameter.id,
        label: parameter.sourceText,
        value: parameter.value,
        unit: parameter.unit as 'USD' | 'count' | 'ratio',
        source: 'scenario' as const,
      })),
    });
  return {
    code: plan.code,
    // Shapes contain no amounts; repairs reuse the same materialized records.
    shapes: tables.map((table) => ({ id: table.id, rows: table.rows.length })),
    run: async (code: string) => renderProgram(code, tables, queried, plan, options.deadline, parameters),
  };
}

async function renderProgram(
  code: string,
  tables: AnalysisProgramInputTable[],
  queried: Awaited<ReturnType<typeof executeFinancialAnalysis>>,
  plan: z.infer<typeof financialProgramSchema>,
  deadline?: number,
  parameters: ReturnType<typeof scenarioAssumptionEvidence>[] = [],
) {
  const result = await executeAnalysisProgram({
    code,
    tables,
    deadline,
  });
  const source = plan.queries[0].status === 'POSTED' ? ('posted' as const) : ('draft' as const);
  const periods = [...new Set(queried.evidence.map((item) => item.period))].join('; ');
  const evidence: InsightEvidence[] = result.tables.map((table, tableIndex) => ({
    title: table.title,
    period: periods,
    source: table.rows.some((row) => row.source === 'scenario') ? 'scenario' : source,
    scope: 'Calculated from the source records below. A percentage with a zero denominator is unavailable.',
    rows: table.rows.map((row, rowIndex) => ({
      label: row.label,
      value: row.value,
      factRef: { kind: 'program_result' as const, programHash: result.codeHash, tableIndex, rowIndex },
    })),
    href: '/reports',
  }));
  diagnostic('ai_analysis_program', {
    tool: 'financial_program',
    operation: 'financial_tool',
    programHash: result.codeHash,
    generatedCalculationCount: result.operationCount,
    outputRows: result.tables.reduce((sum, table) => sum + table.rows.length, 0),
  });
  return {
    answer: `Calculated ${result.tables.map((table) => table.title).join('; ')}. ${parameters.length ? 'User-supplied inputs are identified in the calculation.' : source === 'draft' ? 'These figures use unposted drafts.' : 'These figures use recorded entries.'} The calculation and its source amounts are shown below.`,
    evidence: [...evidence, ...queried.evidence],
    facts: queried.facts,
    program: { ...result, code, parameters, interpretationVerified: false as const },
  };
}
