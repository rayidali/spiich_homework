import { z } from 'zod';
import { publicFinancialQuerySchema } from './financial-analysis';
import { financialScenarioSchema } from './financial-calculation';

const id = publicFinancialQuerySchema.shape.id;
const query = publicFinancialQuerySchema.omit({ id: true }).extend({
  currencyMode: publicFinancialQuerySchema.shape.currencyMode.removeDefault(),
  currency: publicFinancialQuerySchema.shape.currency.removeDefault(),
});
export const answerValueScopeSchema = query.omit({ groupBy: true, order: true, limit: true });
const assumption = financialScenarioSchema.shape.assumptions.element.omit({ id: true });
const operand = z.union([
  z.strictObject({ source: z.literal('output'), id }),
  assumption.extend({ source: z.literal('assumption') }),
  z.strictObject({ source: z.literal('month_count'), query }),
]);
const requirement = z.union([
  z.strictObject({
    kind: z.literal('value'),
    scope: answerValueScopeSchema,
    counterpartyFrom: id.nullable(),
    selectedAccountCode: z
      .string()
      .regex(/^\d{3,8}$/)
      .nullable()
      .default(null),
  }),
  z.strictObject({
    kind: z.literal('table'),
    query,
    coverage: z.enum(['all', 'top']),
    counterpartyFrom: id.nullable(),
  }),
  z.strictObject({
    kind: z.literal('selected_identity'),
    query: query.extend({
      groupBy: z.enum(['account', 'counterparty']),
      order: z.enum(['value_desc', 'value_asc']),
    }),
    tiePolicy: z.enum(['unique', 'any_one']),
  }),
  z.strictObject({
    kind: z.literal('arithmetic'),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    operands: z.array(operand).length(2),
  }),
]);
export const answerContractSchema = z.strictObject({
  outputs: z
    .array(
      z.strictObject({
        id,
        sourceQuotes: z
          .array(
            z.strictObject({
              messageIndex: z.number().int().min(0).max(99),
              quote: z.string().min(1).max(500),
            }),
          )
          .min(1)
          .max(3),
        requirement,
      }),
    )
    .min(1)
    .max(8),
});
export const outputBindingsSchema = z
  .array(
    z.strictObject({
      outputId: id,
      source: z.union([
        z.strictObject({ kind: z.literal('query_row'), queryId: id, rowId: z.string().min(1).max(1024) }),
        z.strictObject({ kind: z.literal('query_result'), queryId: id }),
        z.strictObject({ kind: z.literal('calculation'), calculationId: id }),
      ]),
    }),
  )
  .max(8);
export type AnswerContract = z.infer<typeof answerContractSchema>;
export type RequestedOutput = AnswerContract['outputs'][number];
export type AnswerRequirement = RequestedOutput['requirement'];
export type OutputBinding = z.infer<typeof outputBindingsSchema>[number];
export type AnswerOperand = Extract<AnswerRequirement, { kind: 'arithmetic' }>['operands'][number];
