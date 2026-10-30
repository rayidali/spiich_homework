import pg from 'pg';
import { config } from '../server/config';
import { query, pool } from '../server/db';
import { createEntry, accounts } from '../server/ledger';
import { createRecurring } from '../server/recurring';
import { analyzeEntry } from '../server/anomalies';
import { monthStart, addMonths, today } from '../server/reports';
import { Decimal } from '../shared/money';

export const defaultAccounts = [
  { code: '1000', name: 'Assets', type: 'ASSET', group: true },
  { code: '1010', name: 'Operating bank', type: 'ASSET', parent: '1000', cash: true },
  { code: '1020', name: 'Euro bank', type: 'ASSET', parent: '1000', cash: true, currency: 'EUR' },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', parent: '1000' },
  { code: '1200', name: 'Equipment', type: 'ASSET', parent: '1000' },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY', group: true },
  { code: '2010', name: 'Accounts payable', type: 'LIABILITY', parent: '2000' },
  { code: '2100', name: 'Company credit card', type: 'LIABILITY', parent: '2000' },
  { code: '3000', name: 'Equity', type: 'EQUITY', group: true },
  { code: '3010', name: 'Owner capital', type: 'EQUITY', parent: '3000' },
  { code: '4000', name: 'Revenue', type: 'REVENUE', group: true },
  { code: '4010', name: 'Design services', type: 'REVENUE', parent: '4000' },
  { code: '4020', name: 'Consulting', type: 'REVENUE', parent: '4000' },
  { code: '4090', name: 'Foreign exchange gains', type: 'REVENUE', parent: '4000' },
  { code: '5000', name: 'Operating expenses', type: 'EXPENSE', group: true },
  { code: '5010', name: 'Rent', type: 'EXPENSE', parent: '5000' },
  { code: '5020', name: 'Software & subscriptions', type: 'EXPENSE', parent: '5000' },
  { code: '5030', name: 'Office supplies', type: 'EXPENSE', parent: '5000' },
  { code: '5040', name: 'Marketing', type: 'EXPENSE', parent: '5000' },
  { code: '5050', name: 'Contractors', type: 'EXPENSE', parent: '5000' },
  { code: '5060', name: 'Travel & meals', type: 'EXPENSE', parent: '5000' },
  { code: '5090', name: 'Foreign exchange losses', type: 'EXPENSE', parent: '5000' },
] as const;

export async function seedChart(org: string) {
  for (const raw of defaultAccounts) {
    const a = raw as {
      code: string;
      name: string;
      type: string;
      group?: boolean;
      parent?: string;
      cash?: boolean;
      currency?: string;
    };
    const parent = a.parent
      ? (await query('SELECT id FROM accounts WHERE organization_id=$1 AND code=$2', [org, a.parent]))[0]?.id
      : null;
    await query(
      `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_group,is_cash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,code) DO NOTHING`,
      [org, a.code, a.name, a.type, a.currency ?? 'USD', parent, a.group ?? false, a.cash ?? false],
    );
  }
}
export async function seed() {
  const org = config.organizationId;
  const admin = new pg.Client({ connectionString: config.migrationUrl });
  await admin.connect();
  try {
    await admin.query("SELECT pg_advisory_lock(hashtextextended($1 || ':seed',0))", [org]);
    await admin.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Northstar Studio') ON CONFLICT DO NOTHING",
      [org],
    );
    await seedChart(org);
    if (process.env.SEED_DEMO === 'false') return;
    const state = (
      await admin.query(
        'UPDATE organizations SET demo_seed_date=coalesce(demo_seed_date,$2) WHERE id=$1 RETURNING demo_seed_date::text,demo_seed_complete',
        [org, today()],
      )
    ).rows[0];
    if (state.demo_seed_complete) return;
    // Persist the anchor before writes so retries across midnight or month-end use identical payloads.
    const seedDate = state.demo_seed_date as string,
      seedMonth = monthStart(seedDate);
    const demoDate = (month: string, day: string) =>
      month === seedMonth.slice(0, 7)
        ? `${month}-${String(Math.min(Number(day), Number(seedDate.slice(-2)))).padStart(2, '0')}`
        : `${month}-${day}`;
    const chart = await accounts(org),
      ids = Object.fromEntries(chart.map((a) => [a.code, a.id]));
    const lines = (debit: string, credit: string, amount: string) => [
      { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ];
    async function entry(
      key: string,
      date: string,
      description: string,
      counterparty: string,
      debit: string,
      credit: string,
      amount: string,
      reference = '',
    ) {
      return createEntry(
        org,
        { date, description, counterparty, reference, source: 'MANUAL', lines: lines(debit, credit, amount) },
        `seed:${key}`,
        { post: true, source: 'SEED' },
      );
    }
    const first = addMonths(seedMonth, -5);
    await entry('capital', first, 'Initial owner investment', 'Owner', '1010', '3010', '40000');
    for (let i = 0; i < 6; i++) {
      const month = addMonths(first, i).slice(0, 7),
        date = (day: string) => demoDate(month, day);
      await entry(
        `${month}:rent`,
        date('01'),
        'Monthly studio rent',
        'Hudson Properties',
        '5010',
        '1010',
        '2400',
      );
      await entry(`${month}:figma`, date('03'), 'Figma team subscription', 'Figma', '5020', '2100', '180');
      await entry(`${month}:github`, date('05'), 'GitHub team subscription', 'GitHub', '5020', '2100', '49');
      await entry(
        `${month}:design`,
        date('06'),
        'Brand identity and website design',
        'Acme Corp',
        '1100',
        '4010',
        String(14000 + i * 1750),
        `INV-${1040 + i}`,
      );
      await entry(
        `${month}:acme-payment`,
        date('10'),
        `Payment for invoice #${1040 + i}`,
        'Acme Corp',
        '1010',
        '1100',
        String(14000 + i * 1750),
        `INV-${1040 + i}`,
      );
      await entry(
        `${month}:consulting`,
        date('12'),
        'Product strategy workshop',
        'Linear Labs',
        '1010',
        '4020',
        String(4200 + i * 380),
      );
      await entry(
        `${month}:contractor`,
        date('14'),
        'Freelance design support',
        'Morgan Chen',
        '5050',
        '1010',
        String(4100 + i * 210),
      );
      await entry(
        `${month}:marketing`,
        date('15'),
        'Search campaign',
        'Google Ads',
        '5040',
        '2100',
        String(820 + i * 80),
      );
      await entry(
        `${month}:supplies`,
        date('17'),
        'Studio supplies used this month',
        'Staples',
        '5030',
        '2100',
        String(240 + i * 20),
      );
      await entry(
        `${month}:travel`,
        date('18'),
        'Client workshop travel',
        'Amtrak',
        '5060',
        '2100',
        String(180 + i * 14),
      );
      const cardTotal = new Decimal(180 + 49 + 820 + i * 80 + 240 + i * 20 + 180 + i * 14).toFixed(2);
      await entry(
        `${month}:card-payment`,
        date('20'),
        'Company credit card payment',
        'Company card',
        '2100',
        '1010',
        cardTotal,
      );
    }
    const current = seedMonth.slice(0, 7),
      monthName = new Date(`${seedMonth}T12:00:00Z`).toLocaleString('en-US', {
        month: 'long',
        timeZone: 'UTC',
      });
    await entry(
      'open-invoice',
      demoDate(current, '22'),
      `${monthName} design retainer`,
      'Aster & Co',
      '1100',
      '4010',
      '6800',
      'INV-1050',
    );
    await createEntry(
      org,
      {
        date: demoDate(current, '23'),
        description: 'European brand consultation',
        counterparty: 'Atelier Oslo',
        reference: 'INV-1051',
        source: 'MANUAL',
        lines: [
          { accountId: ids['1020'], debit: '1800', credit: '0', exchangeRate: '1.08', memo: 'USD per EUR' },
          { accountId: ids['4020'], debit: '0', credit: '1944', exchangeRate: '1', memo: '' },
        ],
      },
      'seed:eur-revenue',
      { post: true, source: 'SEED' },
    );
    await entry(
      'unusual-rent',
      demoDate(current, '24'),
      'Additional studio rent charge',
      'Hudson Properties',
      '5010',
      '1010',
      '4800',
    );
    await entry(
      'duplicate-one',
      demoDate(current, '25'),
      'Stock photography subscription',
      'Adobe Stock',
      '5020',
      '2100',
      '89',
    );
    await entry(
      'duplicate-two',
      demoDate(current, '26'),
      'Stock photography subscription',
      'Adobe Stock',
      '5020',
      '2100',
      '89',
    );
    await createEntry(
      org,
      {
        date: seedDate,
        description: 'Website accessibility review',
        counterparty: 'Access Studio',
        reference: '',
        source: 'MANUAL',
        lines: lines('5050', '2010', '1200'),
      },
      'seed:pending-review',
    );
    if (
      !(
        await query('SELECT id FROM recurring_templates WHERE organization_id=$1 AND name=$2', [
          org,
          'Studio rent',
        ])
      ).length
    )
      await createRecurring(org, {
        name: 'Studio rent',
        description: 'Monthly studio rent',
        counterparty: 'Hudson Properties',
        frequency: 'MONTHLY',
        anchorDate: addMonths(seedMonth, 1),
        endDate: null,
        lines: lines('5010', '1010', '2400'),
      });
    if (
      !(
        await query('SELECT id FROM recurring_templates WHERE organization_id=$1 AND name=$2', [
          org,
          'Figma team plan',
        ])
      ).length
    )
      await createRecurring(org, {
        name: 'Figma team plan',
        description: 'Figma team subscription',
        counterparty: 'Figma',
        frequency: 'MONTHLY',
        anchorDate: `${addMonths(seedMonth, 1).slice(0, 7)}-03`,
        endDate: null,
        lines: lines('5020', '2100', '180'),
      });
    // Make the intentional review examples visible immediately on first launch.
    // The outbox can safely analyze them again; alert keys preserve dismissals.
    const reviewEntries = await query<{ id: string }>(
      'SELECT id FROM journal_entries WHERE organization_id=$1 AND idempotency_key=ANY($2::text[])',
      [org, ['seed:unusual-rent', 'seed:duplicate-one', 'seed:duplicate-two']],
    );
    await Promise.all(reviewEntries.map((entry) => analyzeEntry(org, entry.id)));
    await admin.query('UPDATE organizations SET demo_seed_complete=true WHERE id=$1', [org]);
    console.log(
      'Demo seeded: six months of posted activity, a foreign-currency receipt, review alerts, a draft and recurring templates.',
    );
  } finally {
    await admin.end();
  }
}
if (process.argv[1]?.endsWith('/scripts/seed.ts'))
  seed()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
      void pool.end();
    });
