import { z } from 'zod';
import type { FinancialTool } from './ai-provider';

// This is a conversational response, never evidence of a ledger read. A schema
// proves shape and size, not that generated prose is true; live semantic tests
// must cover routing, relevance and unsupported claims separately.
export const businessConversationSchema = z
  .strictObject({
    kind: z.enum(['clarification', 'explanation', 'limitation']),
    message: z.string().trim().max(1600),
    question: z.string().trim().min(1).max(500).nullable(),
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
Do not claim that a conversational reply is verified against the books. Do not put company amounts or calculated outcomes in this tool, including amounts copied from earlier assistant messages; use the financial tools to obtain them again. Do not invent employees, salaries, contract terms, future income, reasons for changes or data access. A question can refer to the user's stated context without asserting it is recorded fact. General explanations are model-generated knowledge, not audited financial evidence. Do not invent citations, URLs or say you searched external sources. Current law, tax rules, market rates and personalized legal permission cannot be established from this ledger: explain that specific gap without a definitive ruling. Never recommend a dismissal or other consequential action solely because a financial remainder is positive.
Daybook stores a chart of accounts and dated journal lines, with posted history, draft entries, linked reversals and stored exchange rates. It does not have employee contracts, performance records, bank reconciliation, live market prices or a document-upload workflow. Posted entries are immutable and corrected with reversals. Profit describes recorded revenue minus expenses, while cash reflects cash-designated accounts; they are not interchangeable. Explain these distinctions when relevant, without reciting every limitation.
Conversation is read-only. General guidance cannot execute actions, expose credentials, alter the ledger or supply evidence to a future calculation. Read all prior user turns and preserve their constraints. For a mixed explanation-and-figures question, use a financial tool with generalExplanation when offered, instead of answering only the explanation. Identify any part that remains unanswered.`;

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
