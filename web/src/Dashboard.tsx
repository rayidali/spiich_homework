import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronDown, Plus, FilePenLine, ArrowRight, Bell, BookOpen } from 'lucide-react';
import type { dashboard } from '../../server/reports';
import type { Entry } from '../../shared/schema';
import { Decimal } from '../../shared/money';
import { useResource, params } from './api';
import { useWorkspace } from './context';
import { Badge, Empty, ErrorState, Loading, PageHeader, formatMoney, shortDate, LinkButton } from './ui';

type DashboardData = Awaited<ReturnType<typeof dashboard>>;
function shiftMonth(date: string, n: number) {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 10);
}

// Number is used only for drawing coordinates. Displayed amounts retain decimal precision.
export function RevenueChart({ data }: { data: DashboardData['trend'] }) {
  const titleId = useId();
  const chartRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    // Draw at the available pixel width so phone labels stay readable.
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(260, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = data.flatMap((row) => [Number(row.revenue), Number(row.expenses)]);
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const rawStep = (max - min) / 4,
    magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= rawStep) ?? 10) * magnitude;
  const low = Math.floor(min / step) * step,
    high = Math.ceil(max / step) * step;
  const left = width < 500 ? 44 : 58,
    right = width - 16,
    top = 16,
    bottom = 184;
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const zero = y(0),
    groupWidth = (right - left) / Math.max(data.length, 1),
    barWidth = Math.min(27, groupWidth / 4);
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => low + i * step);
  const axisMoney = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return (
    <>
      <svg
        ref={chartRef}
        className="revenue-chart"
        viewBox={`0 0 ${width} 220`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          Monthly revenue and expenses in US dollars. Exact amounts are available in Chart data below.
        </title>
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={right}
              y1={y(value)}
              y2={y(value)}
              className={value === 0 ? 'chart-baseline' : 'chart-gridline'}
            />
            <text x={left - 12} y={y(value) + 4} textAnchor="end" className="chart-label">
              {axisMoney.format(value)}
            </text>
          </g>
        ))}
        {data.map((row, i) => {
          const center = left + groupWidth * (i + 0.5);
          return (
            <g key={row.month}>
              <title>
                {row.month}: revenue {formatMoney(row.revenue)}, expenses {formatMoney(row.expenses)}
              </title>
              {(['revenue', 'expenses'] as const).map((key, series) => {
                const value = Number(row[key]);
                return (
                  <rect
                    key={key}
                    x={center + (series === 0 ? -barWidth - 3 : 3)}
                    y={Math.min(zero, y(value))}
                    width={barWidth}
                    height={Math.abs(y(value) - zero)}
                    rx="2"
                    className={`chart-bar ${key}`}
                  />
                );
              })}
              <text x={center} y="210" textAnchor="middle" className="chart-label">
                {row.label}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="chart-data">
        <summary>
          Chart data <ChevronDown size={13} />
        </summary>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">Monthly revenue and expenses in USD</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="amount">
                  Revenue
                </th>
                <th scope="col" className="amount">
                  Expenses
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{row.month}</th>
                  <td className="amount">{formatMoney(row.revenue)}</td>
                  <td className="amount">{formatMoney(row.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function Dashboard() {
  const { meta, revision, openComposer, openEntry, openAlerts } = useWorkspace(),
    navigate = useNavigate();
  const [period, setPeriod] = useState('month');
  const today = meta!.today,
    month = today.slice(0, 7) + '-01';
  let from = month,
    to = today;
  if (period === 'last') {
    from = shiftMonth(month, -1);
    to = new Date(Date.parse(month + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  }
  if (period === 'quarter')
    from = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  if (period === 'year') from = today.slice(0, 4) + '-01-01';
  const resource = useResource<DashboardData>(`/dashboard?${params({ from, to })}`, revision),
    recent = useResource<{ items: Entry[] }>(`/entries?${params({ from, to, limit: '6' })}`, revision),
    data = resource.data;
  const expenses = [...(data?.income.expenses ?? [])]
    .sort((a, b) => new Decimal(b.amount).cmp(a.amount))
    .slice(0, 5);
  return (
    <>
      <PageHeader
        title="Home"
        description="Your books, at a glance."
        actions={
          <label className="period-select">
            <CalendarDays size={15} />
            <select aria-label="Dashboard period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="month">This month</option>
              <option value="last">Last month</option>
              <option value="quarter">This quarter</option>
              <option value="year">This year</option>
            </select>
            <ChevronDown size={13} />
          </label>
        }
      />
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : !data || resource.loading ? (
        <Loading />
      ) : (
        <div className="dashboard-results home-results" aria-busy={resource.loading}>
          <div className="metrics-grid home-metrics">
            {[
              {
                label: 'Cash balance',
                value: data.cash.total,
                note: `Bank and cash accounts as of ${shortDate(to)}`,
              },
              {
                label: 'Period profit',
                value: data.income.netIncome,
                note: `${shortDate(from)} – ${shortDate(to)} · Revenue less expenses`,
              },
            ].map((metric) => (
              <section className="metric-card" key={metric.label}>
                <h2 className="metric-label">{metric.label}</h2>
                <div className="metric-value">{formatMoney(metric.value)}</div>
                <div className="metric-note">{metric.note}</div>
              </section>
            ))}
          </div>
          <button className="record-action" onClick={() => openComposer({ mode: 'simple' })}>
            <span className="record-symbol">
              <Plus size={22} />
            </span>
            <span>
              <strong>Record money in or out</strong>
              <small>A short form, or describe what happened.</small>
            </span>
            <ArrowRight size={20} />
          </button>
          <section className="home-review" aria-label="Things to review">
            <div className="rail-heading">
              <h2>Needs your review</h2>
              <span className="queue-count">{data.counts.drafts + (meta?.alertCount ?? 0)}</span>
            </div>
            <div className="review-options">
              <button className="review-row" onClick={() => navigate('/transactions?status=DRAFT')}>
                <FilePenLine size={19} />
                <span>
                  <strong>
                    {data.counts.drafts} draft {data.counts.drafts === 1 ? 'entry' : 'entries'}
                  </strong>
                  <small>Check these before they reach your reports</small>
                </span>
                <ChevronDown className="row-chevron" size={16} />
              </button>
              <button className="review-row" onClick={openAlerts}>
                <Bell size={19} />
                <span>
                  <strong>
                    {meta?.alertCount ?? 0} unusual{' '}
                    {(meta?.alertCount ?? 0) === 1 ? 'transaction' : 'transactions'}
                  </strong>
                  <small>Check possible duplicates or unexpected amounts</small>
                </span>
                <ChevronDown className="row-chevron" size={16} />
              </button>
            </div>
          </section>
          <section className="card recent-card">
            <div className="card-heading">
              <div>
                <h2>Recent transactions</h2>
                <p>Latest activity in the selected period</p>
              </div>
              <LinkButton onClick={() => navigate(`/transactions?from=${from}&to=${to}`)}>
                View all
              </LinkButton>
            </div>
            {recent.error ? (
              <ErrorState message={recent.error} retry={recent.reload} />
            ) : recent.loading ? (
              <Loading />
            ) : recent.data?.items.length ? (
              <div className="table-scroll">
                <table className="data-table recent-table">
                  <thead>
                    <tr>
                      <th scope="col">Transaction</th>
                      <th scope="col">Date</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="amount">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.items.map((entry) => (
                      <tr key={entry.id} onClick={() => openEntry(entry.id)}>
                        <td>
                          <div className="transaction-cell">
                            <div>
                              <button
                                className="entry-link"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEntry(entry.id);
                                }}
                                aria-label={`Open ${entry.description}`}
                              >
                                {entry.counterparty || entry.description}
                              </button>
                              <span>
                                {entry.counterparty
                                  ? entry.description
                                  : `Journal entry ${entry.number ?? '· Draft'}`}
                              </span>
                              <span className="entry-mobile-meta">
                                {shortDate(entry.date).replace(`, ${today.slice(0, 4)}`, '')}
                                <span aria-hidden="true"> · </span>
                                {entry.status === 'POSTED' ? 'Posted' : 'Draft'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="muted">
                          {shortDate(entry.date).replace(`, ${today.slice(0, 4)}`, '')}
                        </td>
                        <td>
                          <Badge tone={entry.status === 'POSTED' ? 'green' : 'amber'}>
                            {entry.status === 'POSTED' ? 'Posted' : 'Draft'}
                          </Badge>
                        </td>
                        <td className="amount strong">{formatMoney(entry.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No entries in this period"
                description="Choose another period or record a transaction."
              />
            )}
            <div className="table-footnote">
              <BookOpen size={13} />
              Journal totals in USD. Open an entry for its debits and credits.
            </div>
          </section>
          <details className="home-analysis">
            <summary>
              Show financial detail <ChevronDown size={16} />
            </summary>
            <div className="home-analysis-body">
              <section className="card activity-card">
                <div className="card-heading">
                  <div>
                    <h2>Revenue &amp; expenses</h2>
                    <p>Six months through {shortDate(to)}</p>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="revenue-key" />
                      Revenue
                    </span>
                    <span>
                      <i className="expenses-key" />
                      Expenses
                    </span>
                  </div>
                </div>
                <RevenueChart data={data.trend} />
              </section>
              <section className="spending-section">
                <div className="rail-heading">
                  <h2>Top expenses</h2>
                  <span className="muted">USD</span>
                </div>
                <ol className="expense-list">
                  {expenses.map((expense, index) => (
                    <li key={expense.id}>
                      <button
                        className="expense-item"
                        onClick={() => navigate(`/accounts?${params({ account: expense.id, from, to })}`)}
                      >
                        <span className="expense-rank">{String(index + 1).padStart(2, '0')}</span>
                        <span className="expense-name">{expense.name}</span>
                        <strong>{formatMoney(expense.amount)}</strong>
                      </button>
                    </li>
                  ))}
                </ol>
                {!expenses.length && <p className="rail-note">No posted expenses in this period.</p>}
                <LinkButton onClick={() => navigate(`/reports?from=${from}&to=${to}`)}>
                  Open income statement
                </LinkButton>
              </section>
            </div>
          </details>
        </div>
      )}
    </>
  );
}
