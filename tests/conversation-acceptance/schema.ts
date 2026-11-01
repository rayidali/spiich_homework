import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const text = z.string().trim().min(1);
const date = z.iso.date();
const cents = z.string().regex(/^-?\d+$/);

export const reviewCriterionSchema = z.strictObject({
  id,
  requirement: text,
  rationale: text,
});

export const turnExpectationSchema = z.strictObject({
  acceptableBehaviors: z
    .array(
      z.enum([
        'clarify',
        'answer_recorded',
        'calculate_scenario',
        'explain_concept',
        'explain_unavailable',
        'refuse_action',
        'answer_general',
        'offer_financial_help',
      ]),
    )
    .min(1),
  // References are grader-only. Never include expectations or oracle IDs in a model prompt.
  requiredFacts: z.array(id),
  requires: z.array(reviewCriterionSchema).min(1),
  forbids: z.array(reviewCriterionSchema).min(1),
});

export const conversationCaseSchema = z.strictObject({
  id: z.string().regex(/^C\d{2}$/),
  title: text,
  family: z.enum([
    'business_decision',
    'recorded_data',
    'context',
    'ambiguity',
    'scenario',
    'explanation',
    'unavailable_information',
    'boundary',
  ]),
  provenance: z.enum(['user_reported_regression', 'ai_authored_development']),
  turns: z
    .array(
      z.strictObject({
        user: text.max(4000),
        expected: turnExpectationSchema,
      }),
    )
    .min(1)
    .max(4),
});

export const recordedOracleSchema = z.strictObject({
  id,
  kind: z.literal('recorded'),
  metric: z.enum(['net_expense', 'cash_balance', 'profit']),
  accountCodes: z.array(z.string()),
  from: date.nullable(),
  to: date,
  counterparty: text.nullable(),
  status: z.literal('POSTED'),
  currency: z.literal('USD'),
  expectedCents: cents,
});

export const derivedOracleSchema = z.strictObject({
  id,
  kind: z.literal('recorded_difference'),
  left: id,
  right: id,
  currency: z.literal('USD'),
  expectedCents: cents,
});

export const scenarioOracleSchema = z.strictObject({
  id,
  kind: z.literal('scenario'),
  caseId: z.string().regex(/^C\d{2}$/),
  monthlyCents: cents,
  months: z.number().int().positive(),
  oneOffCents: cents,
  currency: z.literal('USD'),
  expectedCents: cents,
  sources: z
    .array(
      z.strictObject({
        field: z.enum(['monthlyCents', 'months', 'oneOffCents']),
        turn: z.number().int().nonnegative(),
        quote: text,
      }),
    )
    .length(3),
});

export const oracleSchema = z.discriminatedUnion('kind', [
  recordedOracleSchema,
  derivedOracleSchema,
  scenarioOracleSchema,
]);

export type ConversationCase = z.infer<typeof conversationCaseSchema>;
export type TurnExpectation = z.infer<typeof turnExpectationSchema>;
export type Oracle = z.infer<typeof oracleSchema>;
