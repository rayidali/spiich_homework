import type { ConversationCase } from '../../tests/conversation-acceptance/schema';
import oracle from './acceptance-oracles.json';

export const clock = '2026-11-03';
export { oracle };
export type ExpectedRow = {
  label: string;
  value: string | null;
  unit: 'USD' | 'ratio' | 'count';
  numerator?: string;
  denominator?: string;
};
export type Case = ConversationCase & {
  oracleRows: ExpectedRow[][];
  from: string;
  to: string;
  ordered: boolean;
};
const percent = (
  label: string,
  value: { display: string; numerator: string; denominator: string } | null,
): ExpectedRow => ({
  label,
  value: value?.display ?? null,
  unit: 'ratio',
  ...(value ? { numerator: value.numerator, denominator: String(BigInt(value.denominator) * 100n) } : {}),
});
const money = (label: string, value: number | string): ExpectedRow => ({
  label,
  value: Number(value).toFixed(2),
  unit: 'USD',
});
const monthly = oracle.monthly2025.map((r) => percent(r.month, r.rentSharePercent));
const ytd = Array.from({ length: 11 }, (_, i) => {
  const month = `2026-${String(i + 1).padStart(2, '0')}`;
  return percent(
    month,
    oracle.yearToDate2026.monthly.find((r) => r.month === month)?.rentSharePercent ?? null,
  );
});
const annualRent = () => [percent('rent', oracle.annualRentSharePercent)];
const annualSoftware = () => [percent('software', oracle.annualSoftwareShareExpensesPercent)];
const definitions: {
  id: string;
  title: string;
  users: string[];
  rows: ExpectedRow[][];
  from?: string;
  to?: string;
  ordered?: boolean;
}[] = [
  {
    id: 'F01',
    title: 'Year and denominator clarification',
    users: [
      'for a year how much % am I spending monthly on rent',
      'this year',
      'as a share of total expenses, through today',
    ],
    rows: [[], [], ytd],
    from: '2026-01-01',
    to: clock,
  },
  {
    id: 'F02',
    title: 'Twelve monthly rent percentages',
    users: [
      "For each month from January through December 2025, show rent divided by that month's net total expenses, as a percentage. Include quiet months.",
    ],
    rows: [monthly],
  },
  {
    id: 'F03',
    title: 'Annual weighted share',
    users: ['What percentage of all our 2025 net expenses was rent? One yearly percentage.'],
    rows: [annualRent()],
  },
  {
    id: 'F04',
    title: 'Mean of defined monthly ratios and count',
    users: [
      'What is the arithmetic mean of the defined monthly rent-to-net-expense percentages for 2025? Include negative ratios, exclude only zero denominators, and tell me how many months.',
    ],
    rows: [
      [
        percent('mean', oracle.meanDefinedMonthlyRentSharePercent),
        { label: 'months', value: '9', unit: 'count' },
      ],
    ],
  },
  {
    id: 'F05',
    title: 'Cumulative net expenses',
    users: [
      'Show cumulative net expenses at the end of each 2025 month, starting the running total at January 1.',
    ],
    rows: [oracle.monthly2025.map((r) => money(r.month, r.cumulativeExpenses))],
  },
  {
    id: 'F06',
    title: 'Trailing three calendar month average',
    users: [
      'Show a trailing three-calendar-month average of net expenses for 2025. Include zero months, and only show months with three months inside 2025.',
    ],
    rows: [
      oracle.trailingThreeMonthExpenses.map((r) => ({
        ...money(r.month, r.average.display),
        numerator: r.average.numerator,
        denominator: r.average.denominator,
      })),
    ],
  },
  {
    id: 'F07',
    title: 'Top three with deterministic ties',
    users: ['Which three 2025 months had the largest net expenses? Break ties by earlier month.'],
    rows: [oracle.topThreeExpenseMonths.map((r) => money(r.month, r.expenses))],
    ordered: true,
  },
  {
    id: 'F08',
    title: 'Rank quarters',
    users: ['Rank the 2025 quarters by total net expenses and show each total.'],
    rows: [oracle.rankedExpenseQuarters.map((r) => money(r.quarter, r.expenses))],
    ordered: true,
  },
  {
    id: 'F09',
    title: 'Median of all monthly totals',
    users: [
      'What is the median of the twelve monthly net-expense totals for 2025, including quiet and refund months?',
    ],
    rows: [[money('median', 150)]],
  },
  {
    id: 'F10',
    title: 'Filter ratios and list unavailable months',
    users: [
      'Which 2025 months had rent greater than half their net expenses? Use the ratio rent/net expenses greater than 50%, not just a dollar inequality. Separately list months where the ratio is undefined.',
    ],
    rows: [[monthly[3], monthly[10], monthly[0], monthly[6], monthly[7]]],
  },
  {
    id: 'F11',
    title: 'Profit margin',
    users: ['Calculate our 2025 net profit margin: revenue minus net expenses, divided by revenue.'],
    rows: [[percent('margin', oracle.profitMarginPercent)]],
  },
  {
    id: 'F12',
    title: 'Quarter percentage change',
    users: ['By what percentage did net expenses change from Q1 to Q4 of 2025?'],
    rows: [[percent('change', oracle.q1ToQ4ExpenseGrowthPercent)]],
  },
  {
    id: 'F13',
    title: 'Marketing share of quarterly revenue',
    users: ['For each 2025 quarter, show marketing as a percentage of revenue.'],
    rows: [oracle.quarters.map((r) => percent(r.quarter, r.marketingShareRevenuePercent))],
  },
  {
    id: 'F14',
    title: 'Counterparty and account numerator filters',
    users: [
      'What percentage of all October 2025 business expenses was Marketing with counterparty exactly Alpha?',
    ],
    rows: [[percent('alpha', oracle.octoberAlphaMarketingShareAllExpensesPercent)]],
    from: '2025-10-01',
    to: '2025-10-31',
  },
  {
    id: 'F15',
    title: 'Counterparty share of account expenses',
    users: ["For 2025, what share of Marketing's net expense belongs to counterparty exactly Alpha?"],
    rows: [[percent('alpha', oracle.annualAlphaShareMarketingPercent)]],
  },
  {
    id: 'F16',
    title: 'Change account in follow-up',
    users: ['What percentage of 2025 total net expenses was rent?', 'Same for software.'],
    rows: [annualRent(), annualSoftware()],
  },
  {
    id: 'F17',
    title: 'Change denominator in follow-up',
    users: [
      'What percentage of 2025 total net expenses was software?',
      'Now as a percentage of revenue instead.',
    ],
    rows: [annualSoftware(), [percent('software', oracle.annualSoftwareShareRevenuePercent)]],
  },
  {
    id: 'F18',
    title: 'Through today excludes future posting',
    users: ['From November 1 through today, what percentage of net expenses is rent?'],
    rows: [[percent('rent', { numerator: '50', denominator: '1', display: '50.00' })]],
    from: '2026-11-01',
    to: clock,
  },
  {
    id: 'F19',
    title: 'Different causes of zero denominator',
    users: [
      'Show January and August 2025 rent shares of net expenses, and explain why each percentage cannot be calculated.',
    ],
    rows: [[monthly[0], monthly[7]]],
  },
  {
    id: 'F20',
    title: 'Signed refunds and over-one ratios',
    users: [
      'Show June and November 2025 rent divided by net total expenses as percentages, keeping refund signs.',
    ],
    rows: [[monthly[5], monthly[10]]],
  },
  {
    id: 'F21',
    title: 'All four requested outputs',
    users: ['Give 2025 posted net expenses, revenue, profit and rent share of expenses in one answer.'],
    rows: [[money('expenses', 2050), money('revenue', 6000), money('profit', 3950), ...annualRent()]],
  },
  {
    id: 'F22',
    title: 'Amounts and share by counterparty',
    users: [
      "Break October 2025 Marketing down by counterparty, with each counterparty's amount and percentage of Marketing's total.",
    ],
    rows: [
      [
        money('alpha', 120),
        percent('alpha', { numerator: '60', denominator: '1', display: '60.00' }),
        money('beta', 80),
        percent('beta', { numerator: '40', denominator: '1', display: '40.00' }),
      ],
    ],
    from: '2025-10-01',
    to: '2025-10-31',
  },
];
export const cases: Case[] = definitions.map((d) => ({
  id: d.id,
  title: d.title,
  family: d.users.length > 1 ? 'context' : 'recorded_data',
  provenance: 'ai_authored_development',
  turns: d.users.map((user) => ({
    user,
    expected: {
      acceptableBehaviors: ['answer_recorded', 'clarify'],
      requiredFacts: [],
      requires: [
        {
          id: 'original_intent',
          requirement:
            'Answer every part of the actual original question, with the correct scope and formula.',
          rationale: 'A nearby calculation or valid program does not establish correctness.',
        },
      ],
      forbids: [
        {
          id: 'invented_claims',
          requirement: 'Do not invent financial facts, causes, assumptions or meanings.',
          rationale: 'Structured numerical checks do not verify arbitrary prose.',
        },
      ],
    },
  })),
  oracleRows: d.rows,
  from: d.from ?? '2025-01-01',
  to: d.to ?? '2025-12-31',
  ordered: d.ordered ?? false,
}));
export const totalTurns = cases.reduce((sum, c) => sum + c.turns.length, 0);
