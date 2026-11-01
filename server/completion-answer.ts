import { AppError } from './errors';
import { diagnostic } from './diagnostics';
import { finalizeAnswerContract, type PreparedAnswerContract, type OutputBinding } from './answer-completion';
import type { AnalysisAccount, AnalysisFacts } from './financial-analysis';
import type { ScenarioCalculationFact } from './financial-calculation';
import type { InsightEvidence } from '../shared/financial-evidence';

export type AnswerCompletionSession = {
  prepared: PreparedAnswerContract;
  bindings: OutputBinding[];
  // Captured privately from successful financial execution, not the planning chart.
  executionChart?: AnalysisAccount[];
};
type FinancialAnswer = {
  answer: string;
  evidence: InsightEvidence[];
  facts?: (AnalysisFacts | ScenarioCalculationFact)[];
};
type RowReference = { handle: string; queryId: string; rowId: string };

export const unassessedCompletion = () => ({
  completionBasis: 'model_declared' as const,
  userIntentVerified: false as const,
  status: 'unassessed' as const,
  outputs: [],
});

/** The financial executor owns the values and source links. This boundary only
 * verifies delivery of the frozen declaration and presents those existing rows. */
export function completeFinancialAnswer<T extends FinancialAnswer>(
  organizationId: string,
  session: AnswerCompletionSession,
  result: T,
  rowReferences: RowReference[] = [],
) {
  if (session.executionChart === undefined && result.facts?.some((fact) => !('kind' in fact))) {
    diagnostic('ai_answer_completion', {
      operation: 'financial_tool',
      completionStatus: 'unassessed',
      fulfilledOutputs: 0,
      missingOutputs: session.prepared.contract.outputs.length,
      invalidOutputs: 0,
    });
    return {
      ...result,
      answer:
        "I couldn't verify the accounts used for these results, so I haven't shown a financial answer. Please try the request again.",
      facts: [],
      evidence: [],
      limitation: { code: 'INVALID_ANSWER_BINDING' },
      answerContract: { hash: session.prepared.hash, contract: session.prepared.contract },
      outputBindings: structuredClone(session.bindings),
      completion: {
        ...unassessedCompletion(),
        outputs: session.prepared.contract.outputs.map((output) => ({
          outputId: output.id,
          status: 'unsupported' as const,
          reason: 'Execution-snapshot account metadata is unavailable.',
          evidence: [],
        })),
      },
    };
  }
  const completion = finalizeAnswerContract(session.prepared, {
    organizationId,
    chart: session.executionChart ?? [],
    facts: result.facts ?? [],
    evidence: result.evidence,
    bindings: session.bindings,
    resolveRowReference: (queryId, rowId) => {
      if (!rowId.startsWith('r_')) return rowId;
      const binding = rowReferences.find((item) => item.handle === rowId && item.queryId === queryId);
      if (!binding)
        throw new AppError(422, 'INVALID_ANSWER_BINDING', 'The result reference is not part of this query.');
      return binding.rowId;
    },
  });
  const invalid = completion.outputs.filter((output) => output.status === 'invalid');
  const fulfilled = completion.outputs.filter((output) => output.status === 'fulfilled');
  const unfinished = completion.outputs.filter((output) => output.status !== 'fulfilled');
  diagnostic('ai_answer_completion', {
    operation: 'financial_tool',
    completionStatus: invalid.length ? 'unassessed' : completion.status,
    fulfilledOutputs: invalid.length ? 0 : fulfilled.length,
    missingOutputs: invalid.length ? completion.outputs.length - invalid.length : unfinished.length,
    invalidOutputs: invalid.length,
  });
  const audit = {
    completion,
    answerContract: { hash: session.prepared.hash, contract: session.prepared.contract },
    outputBindings: structuredClone(session.bindings),
  };
  if (invalid.length) {
    return {
      ...result,
      answer:
        "I couldn't verify that the results match the requested accounts, dates or calculations, so I haven't shown a financial answer. Please clarify the part you want to check.",
      facts: [],
      evidence: [],
      limitation: { code: 'INVALID_ANSWER_BINDING' },
      ...audit,
      completion: {
        ...completion,
        status: 'unassessed' as const,
        outputs: completion.outputs.map((output) => ({
          ...output,
          ...(output.status === 'fulfilled' ? { status: 'missing' as const, reason: 'answer_withheld' } : {}),
          evidence: [],
        })),
      },
    };
  }

  // Copy only server-produced evidence. No model-authored amounts, labels,
  // source types or precision conversions enter the requested-result display.
  const requested: InsightEvidence[] = [];
  for (const output of fulfilled) {
    const position = session.prepared.contract.outputs.findIndex((item) => item.id === output.outputId);
    const grouped = new Map<number, Set<number> | null>();
    for (const ref of output.evidence) {
      if (ref.rowIndex === undefined) grouped.set(ref.tableIndex, null);
      else if (!grouped.has(ref.tableIndex) || grouped.get(ref.tableIndex) !== null) {
        const rows = grouped.get(ref.tableIndex) ?? new Set<number>();
        rows.add(ref.rowIndex);
        grouped.set(ref.tableIndex, rows);
      }
    }
    for (const [tableIndex, rowIndices] of grouped) {
      const table = result.evidence[tableIndex];
      if (!table)
        throw new AppError(422, 'INVALID_ANSWER_BINDING', 'A checked result is no longer available.');
      requested.push({
        ...structuredClone(table),
        title: `Requested result ${position + 1} · ${table.title}`,
        rows:
          rowIndices === null
            ? structuredClone(table.rows)
            : table.rows.filter((_, index) => rowIndices.has(index)).map((row) => structuredClone(row)),
        // A selected cell is not the complete query result table.
        ...(rowIndices === null ? {} : { factSource: undefined }),
      });
    }
  }
  const missing = unfinished.map((output) => {
    const item = session.prepared.contract.outputs.find((item) => item.id === output.outputId)!;
    return `“${item.sourceQuotes[0].quote}”`;
  });
  return {
    ...result,
    answer: unfinished.length
      ? `I could only complete part of this request. Still unresolved: ${missing.join('; ')}. Any available supporting results are shown below.`
      : 'Here are the results, with their accounts, dates and sources.',
    evidence: [...requested, ...result.evidence],
    ...(unfinished.length ? { limitation: { code: 'ANSWER_INCOMPLETE' } } : {}),
    ...audit,
    completion: {
      ...completion,
      outputs: completion.outputs.map((output) => ({
        ...output,
        evidence: output.evidence.map((ref) => ({ ...ref, tableIndex: ref.tableIndex + requested.length })),
      })),
    },
  };
}
