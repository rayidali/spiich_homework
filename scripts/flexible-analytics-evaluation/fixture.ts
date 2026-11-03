import { oracle } from './specification';
export const accounts = [
  { code: '1000', name: 'Cash', type: 'ASSET', cash: true },
  { code: '3000', name: 'Owner capital', type: 'EQUITY', cash: false },
  { code: '4000', name: 'Sales', type: 'REVENUE', cash: false },
  { code: '5010', name: 'Rent', type: 'EXPENSE', cash: false },
  { code: '5020', name: 'Software', type: 'EXPENSE', cash: false },
  { code: '5030', name: 'Marketing', type: 'EXPENSE', cash: false },
] as const;
export type Entry = {
  id: string;
  date: string;
  account: string;
  amountCents: number;
  counterparty: string;
  kind: 'expense' | 'revenue' | 'capital';
  status: 'POSTED' | 'DRAFT';
  workspace: 'primary' | 'other';
};
export const entries: Entry[] = [
  {
    id: 'opening',
    date: '2024-12-31',
    account: '3000',
    amountCents: 500000,
    counterparty: 'Owner',
    kind: 'capital',
    status: 'POSTED',
    workspace: 'primary',
  },
];
const add = (
  id: string,
  date: string,
  account: string,
  amount: number,
  counterparty: string,
  kind: Entry['kind'] = 'expense',
  status: Entry['status'] = 'POSTED',
  workspace: Entry['workspace'] = 'primary',
) => {
  if (amount)
    entries.push({
      id,
      date,
      account,
      amountCents: Math.round(amount * 100),
      counterparty,
      kind,
      status,
      workspace,
    });
};
for (const r of oracle.monthly2025) {
  const date = `${r.month}-15`;
  add(`${r.month}-rent`, date, '5010', r.rent, 'Lessor');
  add(`${r.month}-software`, date, '5020', r.software, 'ToolCo');
  if (r.month === '2025-10') {
    add('oct-alpha', date, '5030', 120, 'Alpha');
    add('oct-beta', date, '5030', 80, 'Beta');
  } else
    add(
      `${r.month}-marketing`,
      date,
      '5030',
      r.marketing,
      ['2025-02', '2025-09', '2025-12'].includes(r.month) ? 'Alpha' : 'Beta',
    );
  add(`${r.month}-revenue`, date, '4000', r.revenue, 'Customers', 'revenue');
}
for (const r of oracle.yearToDate2026.monthly) {
  const date = `${r.month}-${r.month === '2026-11' ? '01' : '15'}`;
  add(`${r.month}-rent`, date, '5010', r.rent, 'Lessor');
  add(`${r.month}-software`, date, '5020', r.software, 'ToolCo');
  add(`${r.month}-revenue`, date, '4000', r.revenue, 'Customers', 'revenue');
}
add('future-rent', '2026-11-04', '5010', 500, 'Lessor');
add('draft-sentinel', '2025-10-15', '5010', 9999, 'Lessor', 'expense', 'DRAFT');
add('other-sentinel', '2025-10-15', '5010', 8888, 'Lessor', 'expense', 'POSTED', 'other');
export function entryLines(e: Entry) {
  const amount = (Math.abs(e.amountCents) / 100).toFixed(2);
  const expense = e.kind === 'expense' && e.amountCents > 0;
  return [
    { account: e.account, debit: expense ? amount : '0.00', credit: expense ? '0.00' : amount },
    { account: '1000', debit: expense ? '0.00' : amount, credit: expense ? amount : '0.00' },
  ];
}
