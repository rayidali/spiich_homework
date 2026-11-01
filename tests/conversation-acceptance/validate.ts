import { accounts, entries } from './book';
import { conversationCaseSchema, oracleSchema, type ConversationCase, type Oracle } from './schema';

/** Check fixture integrity, not model answers. No production query compiler or evaluator is reused. */
export function validateSpecification(
  candidateCases: ConversationCase[],
  candidateOracles: Oracle[],
  candidateEntries = entries,
): string[] {
  const errors: string[] = [];
  const caseIds = new Set<string>();
  const facts = new Map<string, Oracle>();
  const chart = new Map<string, (typeof accounts)[number]>(accounts.map((a) => [a.code, a]));

  for (const c of candidateCases) {
    if (!conversationCaseSchema.safeParse(c).success) errors.push(`Invalid case schema: ${c.id}`);
    if (caseIds.has(c.id)) errors.push(`Duplicate case: ${c.id}`);
    caseIds.add(c.id);
    for (const [turnIndex, turn] of c.turns.entries()) {
      const criteria = [...turn.expected.requires, ...turn.expected.forbids];
      if (new Set(criteria.map((item) => item.id)).size !== criteria.length)
        errors.push(`Duplicate criterion: ${c.id}/${turnIndex}`);
      if (new Set(turn.expected.requiredFacts).size !== turn.expected.requiredFacts.length)
        errors.push(`Duplicate required fact: ${c.id}/${turnIndex}`);
    }
  }
  for (const oracle of candidateOracles) {
    if (!oracleSchema.safeParse(oracle).success) errors.push(`Invalid oracle schema: ${oracle.id}`);
    if (facts.has(oracle.id)) errors.push(`Duplicate oracle: ${oracle.id}`);
    facts.set(oracle.id, oracle);
  }
  // Avoid processing arbitrary malformed shapes or decimal strings after a schema error.
  if (errors.length) return errors;

  const entryIds = new Set<string>();
  for (const entry of candidateEntries) {
    if (entryIds.has(entry.id)) errors.push(`Duplicate entry: ${entry.id}`);
    entryIds.add(entry.id);
    let balance = 0n;
    for (const line of entry.lines) {
      if (!chart.has(line.account)) errors.push(`Unknown account: ${entry.id}/${line.account}`);
      const debit = BigInt(line.baseDebitCents);
      const credit = BigInt(line.baseCreditCents);
      if (debit < 0n || credit < 0n || (debit > 0n && credit > 0n))
        errors.push(`Invalid line: ${entry.id}/${line.account}`);
      balance += debit - credit;
    }
    if (balance !== 0n) errors.push(`Unbalanced entry: ${entry.id}`);
  }
  for (const c of candidateCases)
    for (const [index, turn] of c.turns.entries())
      for (const id of turn.expected.requiredFacts) {
        const oracle = facts.get(id);
        if (!oracle) errors.push(`Unknown required fact: ${c.id}/${index}/${id}`);
        if (oracle?.kind === 'scenario') {
          if (oracle.caseId !== c.id) errors.push(`Cross-conversation scenario: ${c.id}/${index}/${id}`);
          if (oracle.sources.some((source) => source.turn > index))
            errors.push(`Future assumption: ${c.id}/${index}/${id}`);
        }
      }

  for (const oracle of candidateOracles) {
    let calculated = 0n;
    if (oracle.kind === 'recorded') {
      if (oracle.from !== null && oracle.from > oracle.to) errors.push(`Reversed period: ${oracle.id}`);
      for (const code of oracle.accountCodes)
        if (!chart.has(code)) errors.push(`Unknown oracle account: ${oracle.id}/${code}`);
      for (const entry of candidateEntries) {
        if (
          entry.status !== 'POSTED' ||
          entry.date > oracle.to ||
          (oracle.from !== null && entry.date < oracle.from) ||
          (oracle.counterparty !== null && entry.counterparty !== oracle.counterparty)
        )
          continue;
        for (const line of entry.lines) {
          const account = chart.get(line.account);
          if (!account) continue;
          if (oracle.accountCodes.length && !oracle.accountCodes.includes(line.account)) continue;
          const debitNet = BigInt(line.baseDebitCents) - BigInt(line.baseCreditCents);
          if (oracle.metric === 'net_expense' && account.type === 'EXPENSE') calculated += debitNet;
          if (oracle.metric === 'cash_balance' && account.cash) calculated += debitNet;
          if (oracle.metric === 'profit' && ['REVENUE', 'EXPENSE'].includes(account.type))
            calculated -= debitNet;
        }
      }
    } else if (oracle.kind === 'recorded_difference') {
      const left = facts.get(oracle.left);
      const right = facts.get(oracle.right);
      if (left?.kind !== 'recorded' || right?.kind !== 'recorded') {
        errors.push(`Invalid difference sources: ${oracle.id}`);
        continue;
      }
      calculated = BigInt(left.expectedCents) - BigInt(right.expectedCents);
    } else {
      calculated = BigInt(oracle.monthlyCents) * BigInt(oracle.months) - BigInt(oracle.oneOffCents);
      const c = candidateCases.find((item) => item.id === oracle.caseId);
      if (new Set(oracle.sources.map((source) => source.field)).size !== 3)
        errors.push(`Missing scenario operand source: ${oracle.id}`);
      for (const source of oracle.sources) {
        const user = c?.turns[source.turn]?.user;
        if (!user?.includes(source.quote)) errors.push(`Missing user quote: ${oracle.id}/${source.field}`);
        const numeric = source.quote.match(/[\d,]+/g);
        if (!numeric || numeric.length !== 1) {
          errors.push(`Ambiguous fixture quantity: ${oracle.id}/${source.field}`);
          continue;
        }
        const expected = BigInt(oracle[source.field]);
        const quoted = BigInt(numeric[0].replaceAll(',', '')) * (source.field === 'months' ? 1n : 100n);
        if (quoted !== expected) errors.push(`Wrong quoted quantity: ${oracle.id}/${source.field}`);
      }
    }
    if (calculated !== BigInt(oracle.expectedCents)) errors.push(`Wrong expected amount: ${oracle.id}`);
  }
  return errors;
}
