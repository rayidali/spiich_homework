import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, FileText, LockKeyhole } from 'lucide-react';
import type { incomeStatement, trialBalance, balanceSheet } from '../../server/reports';
import { useWorkspace } from './context';
import { downloadCsv, params, useResource } from './api';
import { BalanceCheck, ErrorState, Loading, PageHeader, formatMoney, shortDate } from './ui';
type Income = Awaited<ReturnType<typeof incomeStatement>>;
type Trial = Awaited<ReturnType<typeof trialBalance>>;
type Balance = Awaited<ReturnType<typeof balanceSheet>>;
export function Reports() {
  const { meta, revision } = useWorkspace(),
    [url, setUrl] = useSearchParams(),
    navigate = useNavigate();
  const tab = ['income', 'trial', 'balance'].includes(url.get('tab') ?? '') ? url.get('tab')! : 'income',
    from = url.get('from') ?? meta!.today.slice(0, 7) + '-01',
    to = url.get('to') ?? meta!.today;
  const resource = useResource<Income | Trial | Balance>(`/reports/${tab}?${params({ from, to })}`, revision),
    data = resource.data;
  function change(key: string, value: string) {
    const next = new URLSearchParams(url);
    next.set(key, value);
    setUrl(next);
  }
  function exportReport() {
    if (!data) return;
    if ('items' in data)
      downloadCsv(
        'daybook-trial-balance.csv',
        [
          'Code',
          'Account',
          'Opening USD',
          'Debits USD',
          'Credits USD',
          'Closing debit USD',
          'Closing credit USD',
        ],
        data.items.map((r) => [
          r.code,
          r.name,
          r.opening,
          r.debits,
          r.credits,
          r.debitBalance,
          r.creditBalance,
        ]),
      );
    else if ('netIncome' in data)
      downloadCsv(
        'daybook-profit-and-loss.csv',
        ['Account', 'Amount USD'],
        [
          ...data.revenue.map((r) => [r.name, r.amount]),
          ['Total revenue', data.totalRevenue],
          ...data.expenses.map((r) => [r.name, r.amount]),
          ['Total expenses', data.totalExpenses],
          ['Net profit', data.netIncome],
        ],
      );
    else
      downloadCsv(
        'daybook-balance-sheet.csv',
        ['Account', 'Amount USD'],
        [
          ...data.assets.map((r) => [r.name, r.amount]),
          ['Total assets', data.totalAssets],
          ...data.liabilities.map((r) => [r.name, r.amount]),
          ...data.equity.map((r) => [r.name, r.amount]),
          ['Unclosed earnings', data.earnings],
          ['Total liabilities', data.totalLiabilities],
          ['Total equity', data.totalEquity],
        ],
      );
  }
  const openAccount = (id: string) => navigate(`/accounts?${params({ account: id, from, to })}`);
  return (
    <>
      <PageHeader
        title="Financial reports"
        description="Financial statements calculated from your posted entries."
        actions={
          <button
            className="button secondary"
            disabled={!data || resource.loading || Boolean(resource.error)}
            onClick={exportReport}
          >
            <Download size={16} />
            Export CSV
          </button>
        }
      />
      <section className="card reports-card">
        <div className="report-toolbar">
          <div className="tabs">
            <button className={tab === 'income' ? 'selected' : ''} onClick={() => change('tab', 'income')}>
              Profit & loss
            </button>
            <button className={tab === 'balance' ? 'selected' : ''} onClick={() => change('tab', 'balance')}>
              Balance sheet
            </button>
            <button className={tab === 'trial' ? 'selected' : ''} onClick={() => change('tab', 'trial')}>
              Trial balance
            </button>
          </div>
          <div className="report-filters">
            {tab !== 'balance' && (
              <label className="date-field">
                <span>From</span>
                <input
                  aria-label="Report start date"
                  type="date"
                  value={from}
                  onChange={(e) => change('from', e.target.value)}
                />
              </label>
            )}
            <label className="date-field">
              <span>{tab === 'balance' ? 'As of' : 'To'}</span>
              <input
                aria-label="Report end date"
                type="date"
                value={to}
                onChange={(e) => change('to', e.target.value)}
              />
            </label>
          </div>
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : resource.loading || !data ? (
          <Loading />
        ) : (
          <div className="report-body">
            <div className="report-title">
              <span className="report-icon">
                <FileText size={23} />
              </span>
              <span className="eyebrow">{meta?.organization.name}</span>
              <h2>{{ income: 'Profit & loss', balance: 'Balance sheet', trial: 'Trial balance' }[tab]}</h2>
              <p>{tab === 'balance' ? `As of ${shortDate(to)}` : `${shortDate(from)} – ${shortDate(to)}`}</p>
              <span className="report-meta">
                Accrual basis <i /> USD <i /> Posted entries only
              </span>
            </div>
            {'netIncome' in data ? (
              <div className="statement">
                <StatementSection
                  title="Revenue"
                  rows={data.revenue}
                  total={data.totalRevenue}
                  totalLabel="Total revenue"
                  onAccount={openAccount}
                />
                <StatementSection
                  title="Expenses"
                  rows={data.expenses}
                  total={data.totalExpenses}
                  totalLabel="Total expenses"
                  onAccount={openAccount}
                />
                <div className="net-income">
                  <div>
                    <span>NET PROFIT</span>
                    <p>What remains after your business expenses</p>
                  </div>
                  <strong>{formatMoney(data.netIncome)}</strong>
                </div>
              </div>
            ) : 'items' in data ? (
              <>
                <div className="table-scroll">
                  <table className="data-table trial-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="amount">Opening</th>
                        <th className="amount">Period debits</th>
                        <th className="amount">Period credits</th>
                        <th className="amount">Closing debit</th>
                        <th className="amount">Closing credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => openAccount(row.id)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') openAccount(row.id);
                          }}
                        >
                          <td>
                            <span className="account-code">{row.code}</span>
                            {row.name}
                          </td>
                          <td className="amount muted">{formatMoney(row.opening)}</td>
                          <td className="amount muted">{formatMoney(row.debits)}</td>
                          <td className="amount muted">{formatMoney(row.credits)}</td>
                          <td className="amount">
                            {Number(row.debitBalance) ? formatMoney(row.debitBalance) : '—'}
                          </td>
                          <td className="amount">
                            {Number(row.creditBalance) ? formatMoney(row.creditBalance) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>Total closing balances</td>
                        <td className="amount">{formatMoney(data.totalDebits)}</td>
                        <td className="amount">{formatMoney(data.totalCredits)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <BalanceCheck balanced={data.balanced} difference={data.difference} />
                <p className="report-note">
                  Opening balances use debit-positive signs. Closing balances include all posted history
                  through the end date.
                </p>
              </>
            ) : (
              <>
                <div className="balance-sheet-grid">
                  <StatementSection
                    title="Assets"
                    rows={data.assets}
                    total={data.totalAssets}
                    totalLabel="Total assets"
                    onAccount={openAccount}
                  />
                  <div>
                    <StatementSection
                      title="Liabilities"
                      rows={data.liabilities}
                      total={data.totalLiabilities}
                      totalLabel="Total liabilities"
                      onAccount={openAccount}
                    />
                    <StatementSection
                      title="Equity"
                      rows={[
                        ...data.equity,
                        { id: 'earnings', code: '', name: 'Unclosed earnings', amount: data.earnings },
                      ]}
                      total={data.totalEquity}
                      totalLabel="Total equity"
                      onAccount={(id) => {
                        if (id !== 'earnings') openAccount(id);
                      }}
                    />
                  </div>
                </div>
                <div className={`balance-check ${data.balanced ? 'good' : 'bad'}`}>
                  <CheckCircle2 size={17} />
                  {data.balanced
                    ? 'Assets equal liabilities plus equity'
                    : `Difference: ${formatMoney(data.difference)}`}
                </div>
                <p className="report-note">
                  Equity includes all unclosed revenue less expenses through this date. Foreign balances use
                  recorded exchange rates; automatic period-end revaluation is not included.
                </p>
              </>
            )}
            <div className="report-bottom">
              <LockKeyhole size={13} />
              Prepared from your posted journal. Draft entries are excluded.
            </div>
          </div>
        )}
      </section>
    </>
  );
}
function StatementSection({
  title,
  rows,
  total,
  totalLabel,
  onAccount,
}: {
  title: string;
  rows: { id: string; code: string; name: string; amount: string }[];
  total: string;
  totalLabel: string;
  onAccount: (id: string) => void;
}) {
  return (
    <section className="statement-section">
      <h3>
        {title}
        <span>USD</span>
      </h3>
      {rows.length ? (
        rows.map((row) => (
          <button
            className="statement-row"
            key={row.id}
            onClick={() => onAccount(row.id)}
            disabled={row.id === 'earnings'}
          >
            <span>
              {row.code && <span className="account-code">{row.code}</span>}
              {row.name}
            </span>
            <strong>{formatMoney(row.amount)}</strong>
          </button>
        ))
      ) : (
        <p className="empty-statement">No recorded activity in this period.</p>
      )}
      <div className="statement-total">
        <span>{totalLabel}</span>
        <strong>{formatMoney(total)}</strong>
      </div>
    </section>
  );
}
