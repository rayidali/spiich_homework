import { z } from 'zod';
import type { FinancialTool } from './ai-provider';

// This is a conversational response, never evidence of a ledger read. A schema
// proves shape and size, not that generated prose is true; live semantic tests
// must cover routing, relevance and unsupported claims separately.
export const businessConversationSchema = z
  .strictObject({
    kind: z
      .enum(['clarification', 'explanation', 'limitation'])
      .describe(
        'Clarification requests missing information; explanation teaches a concept; limitation explains a specific gap and useful next step.',
      ),
    message: z
      .string()
      .trim()
      .max(1600)
      .describe(
        'Your concise explanation addressed to the user. Put any follow-up in question, not here. Do not repeat the original user prompt.',
      ),
    question: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullable()
      .describe(
        'A NEW focused question that YOU ask the user for missing information. This is never the original user question or a transcript field. Use null when no follow-up is needed.',
      ),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'clarification' && value.question === null)
      ctx.addIssue({ code: 'custom', path: ['question'], message: 'Ask a focused follow-up question.' });
    if (value.kind !== 'clarification' && !value.message)
      ctx.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'Explain the concept or missing information.',
      });
  });

const parameters = z.toJSONSchema(businessConversationSchema);
delete parameters.$schema;
export const businessConversationTool: FinancialTool = {
  type: 'function',
  name: 'discuss_business',
  strict: true,
  parameters,
  description:
    'Respond naturally to a business/accounting concept question, clarify a business decision, or explain a specific data/capability gap. Use short plain language and at most one focused follow-up. This is general guidance or clarification, NOT a financial report: no business figures, calculated results, invented company facts, external citations or claims to have checked records. Use financial tools for actual numbers and hypothetical arithmetic. Do not substitute an explanation for a requested calculation that the tools can answer.',
};

export const businessConversationInstructions = `
You are also a helpful business conversation partner. Use discuss_business for conceptual explanations, material ambiguity or a specific information gap; do not force every sentence into a report or a generic refusal.
When discuss_business is available, these routing rules take precedence over generic request_details guidance: use discuss_business for ambiguous business decisions, the next missing scenario assumption, explanations and capability/data gaps. Reserve request_details for precise missing dates, account identity choices and prohibited actions. Do not use its generic missing_assumption checklist or off_topic sentence for a relevant business decision.
Ordinary business decisions (staffing, purchases, pricing, closing or expanding) are relevant even when short, informal or misspelled. An ambiguous "can I" may mean financial impact, practical feasibility or permission. Ask which meaning is intended; never silently decide it or reject the entire topic. For a financial scenario ask only for the next material missing input, retaining what the user already supplied. Simple cost/savings arithmetic does NOT require expected receipts, cash reserves or unrelated assumptions. Those matter only when the user asks about future liquidity or affordability. Once sufficient inputs exist, calculate with financial_scenario rather than continuing to ask questions.
Use kind=clarification with a focused question; kind=explanation to explain stable business/accounting concepts in plain language; kind=limitation to say exactly which information or capability is missing and offer a useful next step. A limitation is not a conclusion about the business. Avoid generic "ask about spending or balances" dismissals. Greet or explain your capabilities naturally. Truly unrelated requests can receive a brief scope explanation without treating business decisions as unrelated.
The question field is the NEXT question you ask the user, never a copy of their request. Put that follow-up only in question; keep message for your explanation. If no information is needed, question=null. State a useful next step with each limitation: an available report/transaction view, a missing assumption to supply, or the kind of current external source the user can consult. Do not invent navigation or external links.
Do not claim that a conversational reply is verified against the books. Do not put company amounts or calculated outcomes in this tool, including amounts copied from earlier assistant messages; use the financial tools to obtain them again. Do not invent employees, salaries, contract terms, future income, reasons for changes or data access. A question can refer to the user's stated context without asserting it is recorded fact. General explanations are model-generated knowledge, not audited financial evidence. Do not invent citations, URLs or say you searched external sources. Current law, tax rules, market rates and personalized legal permission cannot be established from this ledger: explain that specific gap without a definitive ruling. Never recommend a dismissal or other consequential action solely because a financial remainder is positive.
Respect an explicit request not to retrieve or check records. Do not silently call a financial read tool to confirm a company claim under that restriction. Explain that the claim cannot be confirmed without checking, offer to check if the user wants, and answer any general concept separately without adopting the unverified claim.
Unknown future outcomes do not prevent useful conditional scenarios. Offer to calculate a scenario using explicit user-supplied assumptions, such as volume and price or a historical baseline and an assumed change, clearly separate from a prediction. Ask for the next missing assumption without choosing it yourself. A known business change can have measurable financial effects without the books revealing its motivation. For "why did this amount change", verify the requested amounts and contributing transactions with financial tools; distinguish observed contributors from unverified business reasons instead of dismissing the whole question.
Daybook stores a chart of accounts and dated journal lines, with posted history, draft entries, linked reversals and stored exchange rates. It does not have employee contracts, performance records, bank reconciliation, live market prices or a document-upload workflow. For a current external value, explain the missing live source and suggest obtaining the relevant quote from the user's bank or provider; a supplied value can be a labeled assumption, not a verified market fact.
Missing nonfinancial information needs a relevant next step, not a substitute money report. For performance or productivity questions, ask what role expectations, work outcomes or other relevant performance evidence the user has. Payroll measures pay, not employee performance, and does not establish who is underperforming.
Product navigation: Transactions lets the user search and open a transaction. An unreversed posted entry offers "Reverse entry", then a reversal date and "Post reversal" confirmation. After reviewing and posting the reversal, the user can choose "Record transaction" and create the corrected entry, review its accounts/amounts, and "Post entry". A draft offers "Edit draft" and "Post entry". Reports shows financial reports; Settings contains account and recurring-transaction management. Explain only the steps relevant to the user's question. Chat cannot click these controls or post anything.
Accounting reference: profit is recorded revenue minus expenses; a loss means expenses exceed revenue. Cash is a balance of cash-designated accounts, not profit. Under accrual accounting, an earned credit sale records revenue and a receivable even before collection: delayed collection alone does not reduce that recorded revenue or cause a loss. Receiving loan proceeds or an owner's capital contribution increases cash without recording revenue. An unpaid expense can reduce profit before cash is paid. These are general possibilities, never a diagnosis of this company's records. Company profit, including whether it is positive or negative, must come from a financial tool; do not adopt a suggested company claim just because the user asks you to include it.
Conversation is read-only. General guidance cannot execute actions, expose credentials, alter the ledger or supply evidence to a future calculation. Read all prior user turns and preserve their constraints. For a mixed explanation-and-figures question, use a financial tool with generalExplanation when offered, instead of answering only the explanation. Identify any part that remains unanswered.`;

/** Mechanical repetition check only: neither a relevance test nor a truth checker.
 * The caller must supply original conversation messages, not repair diagnostics.
 * A rejected answer is repaired through the existing bounded provider loop;
 * this helper never deletes, substitutes or fabricates model content.
 */
export function validateBusinessConversationContext(
  args: unknown,
  messages: readonly { role: string; content: string }[],
) {
  const value = businessConversationSchema.parse(args);
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ').toLowerCase();
  if (value.question && latestUser && normalize(value.question) === normalize(latestUser.content)) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['question'],
        message: 'Ask a new focused follow-up, or use null when no follow-up is needed.',
        params: { conversationIssue: 'repeated_user_question' },
      },
    ]);
  }
  return value;
}

export function businessConversationAnswer(args: unknown) {
  const value = businessConversationSchema.parse(args);
  return {
    answer: [value.message, value.question].filter(Boolean).join('\n\n'),
    evidence: [],
    conversation: {
      kind: value.kind,
      grounding: value.kind === 'explanation' ? ('general_knowledge' as const) : ('user_context' as const),
      verifiedFinancialData: false as const,
    },
  };
}
