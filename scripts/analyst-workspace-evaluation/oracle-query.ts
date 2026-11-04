/** Authored reference SQL, independent of every product tool/compiler/calculator. */
export const oracleQuery = `
WITH context AS (
  SELECT $1::uuid AS org,$2::date AS today,date_trunc('year',$2::date)::date AS year_start
), ledger AS (
  SELECT e.id AS entry_id,e.reference AS key,e.date,e.status,e.description,e.counterparty,
    a.code,a.name,a.type,a.is_cash,l.currency,
    l.base_debit-l.base_credit AS net,l.debit-l.credit AS native,l.credit
  FROM public.journal_entries e
  JOIN public.journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
  JOIN public.accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
  CROSS JOIN context c WHERE e.organization_id=c.org
), posted AS (
  SELECT l.* FROM ledger l CROSS JOIN context c WHERE l.status='POSTED' AND l.date<=c.today
), ytd AS (
  SELECT p.* FROM posted p CROSS JOIN context c WHERE p.date>=c.year_start
), cash_accounts AS (
  SELECT code,name,currency,SUM(native) AS native,SUM(net) AS base
  FROM posted WHERE is_cash AND type='ASSET' GROUP BY code,name,currency
), totals AS (
  SELECT COALESCE(SUM(net) FILTER(WHERE type='EXPENSE'),0) AS expenses,
    COALESCE(SUM(net) FILTER(WHERE code='5030'),0) AS supplies,
    COALESCE(SUM(net) FILTER(WHERE code='5050'),0) AS contractors,
    COALESCE(SUM(net) FILTER(WHERE code='5010'),0) AS rent,
    (SELECT COALESCE(SUM(base),0) FROM cash_accounts) AS cash FROM ytd
), calendar AS (
  SELECT m::date AS month FROM context c,
    generate_series(c.year_start,date_trunc('month',c.today),'1 month') m
), monthly AS (
  SELECT c.month,
    COALESCE(SUM(y.net) FILTER(WHERE y.code='5010'),0) AS rent,
    COALESCE(SUM(y.net) FILTER(WHERE y.type='EXPENSE'),0) AS expenses
  FROM calendar c LEFT JOIN ytd y ON date_trunc('month',y.date)::date=c.month GROUP BY c.month
), shares AS (
  SELECT *,rent*100/NULLIF(expenses,0) AS pct FROM monthly
), trailing AS (
  SELECT m.* FROM monthly m CROSS JOIN context c
  WHERE m.month>=date_trunc('month',c.today)-interval '3 months'
    AND m.month<date_trunc('month',c.today)
), trailing_stats AS (
  SELECT AVG(expenses) AS mean,
    (SELECT expenses FROM trailing ORDER BY expenses OFFSET 1 LIMIT 1) AS median FROM trailing
), october AS (
  SELECT COALESCE(SUM(-net) FILTER(WHERE type='REVENUE'),0) AS revenue,
    COALESCE(SUM(net) FILTER(WHERE type='EXPENSE'),0) AS expenses,
    COALESCE(SUM(net) FILTER(WHERE is_cash AND type='ASSET'),0) AS cash,
    COALESCE(SUM(-net) FILTER(WHERE code='2100'),0) AS card
  FROM ytd WHERE date BETWEEN '2026-10-01' AND '2026-10-31'
), invoice_periods AS (
  SELECT m.month,
    COALESCE(SUM(-l.net) FILTER(WHERE l.type='REVENUE'),0) AS revenue,
    COALESCE(SUM(l.net) FILTER(WHERE l.is_cash AND l.type='ASSET'),0) AS receipt
  FROM (VALUES ('2026-03-01'::date),('2026-04-01'::date)) m(month)
  LEFT JOIN ytd l ON date_trunc('month',l.date)::date=m.month AND l.counterparty='Client Co'
  GROUP BY m.month
), native_travel AS (
  SELECT currency,SUM(native) AS amount FROM ytd WHERE code IN ('5060','5061') GROUP BY currency
), category_change AS (
  SELECT name,COALESCE(SUM(net) FILTER(WHERE date BETWEEN '2026-09-01' AND '2026-09-30'),0) AS september,
    COALESCE(SUM(net) FILTER(WHERE date BETWEEN '2026-10-01' AND '2026-10-31'),0) AS october
  FROM ytd WHERE type='EXPENSE' AND date BETWEEN '2026-09-01' AND '2026-10-31' GROUP BY name
), vendor_totals AS (
  SELECT counterparty,SUM(net) AS amount FROM ytd WHERE type='EXPENSE' GROUP BY counterparty
), top_vendors AS (
  SELECT *,SUM(amount) OVER(ORDER BY amount DESC,counterparty ROWS UNBOUNDED PRECEDING) AS cumulative
  FROM vendor_totals ORDER BY amount DESC,counterparty LIMIT 3
), alerts AS (
  SELECT a.status,e.reference AS entry_key FROM public.alerts a
  JOIN public.journal_entries e ON e.id=a.entry_id AND e.organization_id=a.organization_id
  CROSS JOIN context c WHERE a.organization_id=c.org
), rent_draft AS (
  SELECT e.date,e.status,COALESCE(SUM(l.base_debit-l.base_credit) FILTER(WHERE a.code='5010'),0) AS amount
  FROM public.journal_entries e JOIN public.journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
  JOIN public.accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
  CROSS JOIN context c WHERE e.organization_id=c.org AND e.reference='draft-rent' GROUP BY e.date,e.status
), regular_rent AS (
  SELECT COALESCE(SUM(((line->>'debit')::numeric-(line->>'credit')::numeric)*(line->>'exchangeRate')::numeric),0) AS amount
  FROM public.recurring_templates t CROSS JOIN LATERAL jsonb_array_elements(t.lines) line
  JOIN public.accounts a ON a.id=(line->>'accountId')::uuid AND a.organization_id=t.organization_id
  CROSS JOIN context c WHERE t.organization_id=c.org AND t.name='Studio rent' AND a.code='5010'
), figma AS (
  SELECT COUNT(DISTINCT entry_id) FILTER(WHERE status='POSTED') AS posted,
    COUNT(DISTINCT entry_id) FILTER(WHERE status='DRAFT') AS drafts,
    COALESCE(SUM(net) FILTER(WHERE status='DRAFT' AND type='EXPENSE'),0) AS draft_amount,
    MIN(code) FILTER(WHERE status='DRAFT' AND credit>0) AS credit_account
  FROM ledger CROSS JOIN context c WHERE lower(counterparty)='figma' AND date=c.today
)
SELECT jsonb_build_object(
 'cash.total',(SELECT ROUND(cash,2)::text FROM totals),
 'cash.accounts',(SELECT jsonb_agg(jsonb_build_object('code',code,'name',name,'currency',currency,
     'native',ROUND(native,2)::text,'base_usd',ROUND(base,2)::text) ORDER BY code) FROM cash_accounts),
 'cash.after_rent_draft',(SELECT ROUND(cash+(SELECT COALESCE(SUM(net),0) FROM ledger
     WHERE key='draft-rent' AND status='DRAFT' AND is_cash AND type='ASSET'),2)::text FROM totals),
 'spend.total',(SELECT ROUND(expenses,2)::text FROM totals),
 'spend.supplies',(SELECT ROUND(supplies,2)::text FROM totals),
 'spend.contractors',(SELECT ROUND(contractors,2)::text FROM totals),
 'share.supplies',(SELECT ROUND(supplies*100/NULLIF(expenses,0),6)::text FROM totals),
 'share.contractors',(SELECT ROUND(contractors*100/NULLIF(expenses,0),6)::text FROM totals),
 'consulting.account',(SELECT jsonb_build_object('code',a.code,'type',a.type) FROM public.accounts a
     CROSS JOIN context c WHERE a.organization_id=c.org AND a.name='Consulting'),
 'contractors.draft',(SELECT ROUND(COALESCE(SUM(net),0),2)::text FROM ledger WHERE status='DRAFT' AND code='5050'),
 'rent.regular',(SELECT ROUND(amount,2)::text FROM regular_rent),
 'rent.extra',(SELECT ROUND(COALESCE(SUM(net),0),2)::text FROM posted WHERE key='extra-rent' AND code='5010'),
 'rent.october',(SELECT ROUND(rent,2)::text FROM monthly WHERE month='2026-10-01'),
 'rent.draft',(SELECT jsonb_build_object('date',date::text,'amount',ROUND(amount,2)::text,'status',status) FROM rent_draft),
 'figma.nov3',(SELECT jsonb_build_object('posted_matches',posted,'draft_matches',drafts,
     'draft_amount',ROUND(draft_amount,2)::text,'credit_account',credit_account) FROM figma),
 'rent.monthly_shares',(SELECT jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM'),
     'rent',ROUND(rent,2)::text,'expenses',ROUND(expenses,2)::text,'rent_pct',ROUND(pct,6)::text) ORDER BY month) FROM shares),
 'rent.annual_share',(SELECT ROUND(rent*100/NULLIF(expenses,0),6)::text FROM totals),
 'rent.mean_monthly_share',(SELECT jsonb_build_object('percent',ROUND(AVG(pct),6)::text,
     'defined_months',COUNT(pct),'undefined_months',COUNT(*)-COUNT(pct)) FROM shares),
 'expenses.trailing_three',(SELECT jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM'),
     'expenses',ROUND(expenses,2)::text) ORDER BY month) FROM trailing),
 'expenses.trailing_mean',(SELECT ROUND(mean,6)::text FROM trailing_stats),
 'expenses.trailing_median',(SELECT ROUND(median,2)::text FROM trailing_stats),
 'october.profit_cash_bridge',(SELECT jsonb_build_object('revenue',ROUND(revenue,2)::text,
     'expenses',ROUND(expenses,2)::text,'profit',ROUND(revenue-expenses,2)::text,
     'cash_change',ROUND(cash,2)::text,'card_liability_increase',ROUND(card,2)::text) FROM october),
 'invoice.revenue_vs_receipts',(SELECT jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM'),
     'revenue',ROUND(revenue,2)::text,'cash_received',ROUND(receipt,2)::text) ORDER BY month) FROM invoice_periods),
 'invoice.remaining_receivable',(SELECT ROUND(COALESCE(SUM(net),0),2)::text FROM posted WHERE code='1100'),
 'travel.native',(SELECT jsonb_object_agg(currency,ROUND(amount,2)::text ORDER BY currency) FROM native_travel),
 'travel.base',(SELECT ROUND(COALESCE(SUM(net),0),2)::text FROM ytd WHERE code IN ('5060','5061')),
 'scenario.runway_500',(SELECT jsonb_build_object('monthly_spending',ROUND(s.mean+500,6)::text,
     'runway_months',ROUND(t.cash/(s.mean+500),6)::text) FROM totals t CROSS JOIN trailing_stats s),
 'scenario.runway_700',(SELECT jsonb_build_object('monthly_spending',ROUND(s.mean+700,6)::text,
     'runway_months',ROUND(t.cash/(s.mean+700),6)::text) FROM totals t CROSS JOIN trailing_stats s),
 'expenses.sep_oct_bridge',(SELECT jsonb_agg(jsonb_build_object('category',name,'september',ROUND(september,2)::text,
     'october',ROUND(october,2)::text,'difference',ROUND(october-september,2)::text) ORDER BY name) FROM category_change),
 'expenses.sep_oct_increase',(SELECT ROUND(o.expenses-m.expenses,2)::text FROM october o CROSS JOIN monthly m WHERE m.month='2026-09-01'),
 'supplies.all_history',(SELECT jsonb_agg(jsonb_build_object('key',key,'date',date::text,'amount',ROUND(net,2)::text) ORDER BY date,key)
     FROM posted WHERE code='5030'),
 'supplies.all_history_total',(SELECT ROUND(COALESCE(SUM(net),0),2)::text FROM posted WHERE code='5030'),
 'noteworks.records',(SELECT jsonb_agg(jsonb_build_object('key',key,'date',date::text,'description',description,
     'expense',ROUND(net,2)::text) ORDER BY date,key) FROM posted WHERE counterparty='NoteWorks' AND type='EXPENSE'),
 'supplies.august',(SELECT ROUND(COALESCE(SUM(net),0),2)::text FROM ytd WHERE code='5030' AND date BETWEEN '2026-08-01' AND '2026-08-31'),
 'board_games.account_matches',(SELECT COUNT(*) FROM public.accounts a CROSS JOIN context c WHERE a.organization_id=c.org AND lower(a.name) LIKE '%board games%'),
 'alerts.open',(SELECT jsonb_agg(entry_key ORDER BY entry_key) FROM (SELECT DISTINCT entry_key FROM alerts WHERE status='OPEN') a),
 'alerts.history',(SELECT jsonb_build_object('OPEN',COUNT(*) FILTER(WHERE status='OPEN'),
     'DISMISSED',COUNT(*) FILTER(WHERE status='DISMISSED'),'RESOLVED',COUNT(*) FILTER(WHERE status='RESOLVED')) FROM alerts),
 'vendors.top_three',(SELECT jsonb_agg(jsonb_build_object('vendor',v.counterparty,'expense',ROUND(v.amount,2)::text,
     'share_pct',ROUND(v.amount*100/NULLIF(t.expenses,0),6)::text,
     'cumulative_pct',ROUND(v.cumulative*100/NULLIF(t.expenses,0),6)::text) ORDER BY v.amount DESC,v.counterparty)
     FROM top_vendors v CROSS JOIN totals t)
) AS facts
`;
