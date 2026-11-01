/** Entirely fictional, independently specified acceptance data. No app/database imports. */
export const clock = '2026-11-01';
export const accounts = [
  { code: '1000', name: 'Operating bank', type: 'ASSET', currency: 'USD', cash: true },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', currency: 'USD', cash: false },
  { code: '3000', name: 'Owner capital', type: 'EQUITY', currency: 'USD', cash: false },
  { code: '4000', name: 'Service revenue', type: 'REVENUE', currency: 'USD', cash: false },
  { code: '5010', name: 'Rent', type: 'EXPENSE', currency: 'USD', cash: false },
  { code: '5020', name: 'Payroll', type: 'EXPENSE', currency: 'USD', cash: false },
  { code: '5030', name: 'Office supplies', type: 'EXPENSE', currency: 'USD', cash: false },
  { code: '5040', name: 'Software', type: 'EXPENSE', currency: 'USD', cash: false },
  { code: '6100', name: 'Travel', type: 'EXPENSE', currency: 'USD', cash: false },
  { code: '6110', name: 'Travel', type: 'EXPENSE', currency: 'EUR', cash: false },
] as const;

type Line = { account: string; baseDebitCents: string; baseCreditCents: string };
type Entry = {
  id: string;
  date: string;
  status: 'POSTED' | 'DRAFT';
  description: string;
  counterparty: string;
  lines: Line[];
};

function entry(
  id: string,
  date: string,
  description: string,
  counterparty: string,
  debitAccount: string,
  creditAccount: string,
  baseCents: string,
  status: 'POSTED' | 'DRAFT' = 'POSTED',
): Entry {
  return {
    id,
    date,
    description,
    counterparty,
    status,
    lines: [
      { account: debitAccount, baseDebitCents: baseCents, baseCreditCents: '0' },
      { account: creditAccount, baseDebitCents: '0', baseCreditCents: baseCents },
    ],
  };
}

// Base values are integer US cents. The EUR purchase has native EUR200 and saved FX1.10;
// those native fields are not needed by these base-USD questions. A future DB adapter
// must preserve them if it seeds this fixture rather than asserting EUR220 was spent.
export const entries: Entry[] = [
  entry('opening', '2026-09-01', 'Owner funding', 'Owner', '1000', '3000', '2000000'),
  entry('sep-supplies', '2026-09-05', 'Paper and pens', 'Acme', '5030', '1000', '17000'),
  entry('sep-refund', '2026-09-12', 'Returned paper', 'Acme', '1000', '5030', '7000'),
  entry('sep-software', '2026-09-16', 'Software subscription', 'Soft Co', '5040', '1000', '6000'),
  entry('oct-rent', '2026-10-01', 'October rent', 'Landlord', '5010', '1000', '240000'),
  entry('oct-payroll', '2026-10-04', 'October payroll', 'Payroll provider', '5020', '1000', '400000'),
  entry('oct-acme', '2026-10-10', 'Office supplies', 'Acme', '5030', '1000', '14000'),
  entry('oct-beta', '2026-10-11', 'Office supplies', 'Beta', '5030', '1000', '20000'),
  entry('oct-sale', '2026-10-15', 'Consulting paid', 'Client', '1000', '4000', '1000000'),
  entry('oct-software', '2026-10-16', 'Software subscription', 'Soft Co', '5040', '1000', '4000'),
  entry('oct-travel', '2026-10-20', 'EUR200 travel at stored FX1.10', 'Rail Co', '6110', '1000', '22000'),
  entry(
    'draft-payroll',
    '2026-10-25',
    'Unposted payroll proposal',
    'Payroll provider',
    '5020',
    '1000',
    '888800',
    'DRAFT',
  ),
  entry('oct-unpaid', '2026-10-26', 'Unpaid client invoice', 'Client', '1100', '4000', '600000'),
  entry('future-supplies', '2026-11-02', 'Later supplies', 'Acme', '5030', '1000', '5000'),
];
