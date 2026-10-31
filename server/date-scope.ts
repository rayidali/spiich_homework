import type { ModelMessages } from './ai-provider';

export const ALL_HISTORY_START = '0001-01-01';
export const recordedRange = (from: string, to: string) =>
  from === ALL_HISTORY_START ? `across all recorded history through ${to}` : `from ${from} to ${to}`;
export const recordedPeriod = (from: string, to: string) =>
  from === ALL_HISTORY_START ? `All recorded history through ${to}` : `${from} → ${to}`;
export type AllHistoryNormalization = {
  rule: 'explicit_all_history_v1';
  target: 'from' | 'queries[0].from';
  originalFrom: string;
  executedFrom: typeof ALL_HISTORY_START;
  to: string;
  changed: boolean;
  userMessageIndex: number;
  sourceStart: number;
  sourceEnd: number;
};

// Deliberately keep UTF-16 offsets: String.slice(), the returned evidence span
// and the original message all use that coordinate system (including emoji).
function outsideQuotes(text: string): string | undefined {
  const characters = text.split('');
  let close: string | undefined;
  const letter = (character: string | undefined) => !!character && /[\p{L}\p{N}]/u.test(character);
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (close) {
      characters[i] = ' ';
      if (character === '\\' && i + 1 < text.length) characters[++i] = ' ';
      else if (character === close) close = undefined;
      continue;
    }
    // An apostrophe inside a word is not a quoted account/merchant name.
    if ((character === "'" || character === '’') && letter(text[i - 1]) && letter(text[i + 1])) continue;
    const matching: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '`': '`' };
    if (matching[character]) {
      close = matching[character];
      characters[i] = ' ';
    } else if (character === '”' || character === '’') return undefined;
  }
  return close ? undefined : characters.join('');
}

/** Recognizes a small, affirmative temporal grammar, not arbitrary English
 * intent. Quoted data, negation and competing periods cannot widen a query. */
export function explicitAllHistory(messages: ModelMessages) {
  const userMessageIndex = messages.length - 1;
  const message = messages[userMessageIndex];
  if (!message || message.role !== 'user') return undefined;
  const text = outsideQuotes(message.content);
  if (text === undefined) return undefined;
  if (
    /\b(?:not|never|no|don['’]t|doesn['’]t|isn['’]t|exclude|excluding|except|without|instead)\b/i.test(text)
  )
    return undefined;
  const phrase =
    '(?:all[ -]time|alltime|all (?:recorded )?history|(?:the )?entire (?:recorded )?history|since (?:the )?beginning)';
  if ([...text.matchAll(new RegExp(`\\b${phrase}\\b`, 'gi'))].length !== 1) return undefined;
  const standalone = new RegExp(`^\\s*(${phrase})\\s*[.!?]*\\s*$`, 'i').exec(text);
  const matches = standalone
    ? [standalone]
    : [
        ...text.matchAll(
          new RegExp(
            `\\b(?:across|over|throughout|for|during)\\s+(${phrase})(?=\\s*(?:[.!?]*$|(?:through|until|to|up to|as of)\\b))`,
            'gi',
          ),
        ),
      ];
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  const sourceStart = match.index! + match[0].indexOf(match[1]);
  const sourceEnd = sourceStart + match[1].length;
  const upperDate =
    '(?:\\d{4}(?:-\\d{2}-\\d{2})?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s*\\d{1,2}(?:st|nd|rd|th)?[,]?\\s*\\d{4}|today|now)';
  if (
    !new RegExp(`^\\s*(?:[.!?]*|(?:through|until|to|up to|as of)\\s*${upperDate}[.!?]*)\\s*$`, 'i').test(
      text.slice(sourceEnd),
    )
  )
    return undefined;
  const rest = text.slice(0, sourceStart) + ' '.repeat(sourceEnd - sourceStart) + text.slice(sourceEnd);
  // A lower date or another period means there is no single proved global
  // all-history range. Keep the original plan; never resolve that conflict by
  // silently erasing the user's bounded date instruction.
  const dateWord =
    '(?:\\d|january|february|march|april|may|june|july|august|september|october|november|december|jan\\b|feb\\b|mar\\b|apr\\b|jun\\b|jul\\b|aug\\b|sep\\b|oct\\b|nov\\b|dec\\b|q[1-4]\\b|today|yesterday|last|this|next|the\\s+(?:year|month|quarter))';
  if (
    new RegExp(`\\b(?:from|after|in|during|for|of|since|between)\\s*["'“‘\x60]\\s*${dateWord}`, 'i').test(
      message.content,
    ) ||
    /\b(?:from|after|since|starting|start|between|compare|compared|versus|vs|difference|relative|last|previous|next|past|ytd|mtd|q[1-4])(?=\b|\d)/i.test(
      rest,
    ) ||
    /\b(?:this|current|prior)\s+(?:week|month|quarter|year)\b/i.test(rest) ||
    /\b(?:year|month)[ -]to[ -]date\b/i.test(rest) ||
    new RegExp(`\\b(?:from|after|in|during|for|of)\\s*${dateWord}`, 'i').test(rest) ||
    /\b(?:19|20)\d{2}\s*[-–/]\s*(?:19|20)\d{2}\b/.test(rest)
  )
    return undefined;
  return { userMessageIndex, sourceStart, sourceEnd };
}

/** Called only after the selected tool arguments have passed their strict
 * schema. Only one simple flow range is eligible; all other fields are copied. */
export function normalizeAllHistoryFlow(
  name: string,
  args: Record<string, unknown>,
  messages: ModelMessages,
): {
  args: Record<string, unknown>;
  normalization?: AllHistoryNormalization;
} {
  const proof = explicitAllHistory(messages);
  if (!proof) return { args };
  const narrow = ['expense_by_account', 'expense_summary', 'income_summary', 'find_transactions'].includes(
    name,
  );
  const queries = Array.isArray(args.queries) ? args.queries : undefined;
  const composable = name === 'financial_analysis' && queries?.length === 1;
  const range = narrow ? args : composable ? (queries[0] as Record<string, unknown>) : undefined;
  if (!range || typeof range.from !== 'string' || typeof range.to !== 'string') return { args };
  if (
    composable &&
    ![
      'net_expense',
      'net_revenue',
      'net_profit',
      'net_cash_movement',
      'journal_total',
      'journal_count',
    ].includes(String(range.metric))
  )
    return { args };
  const normalization: AllHistoryNormalization = {
    rule: 'explicit_all_history_v1',
    target: narrow ? 'from' : 'queries[0].from',
    originalFrom: range.from,
    executedFrom: ALL_HISTORY_START,
    to: range.to,
    changed: range.from !== ALL_HISTORY_START,
    ...proof,
  };
  return {
    args: narrow
      ? { ...args, from: ALL_HISTORY_START }
      : { ...args, queries: [{ ...range, from: ALL_HISTORY_START }] },
    normalization,
  };
}
