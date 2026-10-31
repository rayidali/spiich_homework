import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  Plus,
  Search,
  MessageSquareText,
  Check,
  Edit3,
  Undo2,
  LockKeyhole,
  ArrowUpRight,
} from 'lucide-react';
import type { Entry } from '../../shared/schema';
import { sum } from '../../shared/money';
import { asUiError, type UiError, downloadCsv, params, useResource, write } from './api';
import { useWorkspace } from './context';
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  formatMoney,
  shortDate,
} from './ui';

export function Transactions() {
  const { revision, accounts, openComposer, openEntry } = useWorkspace(),
    [url, setUrl] = useSearchParams();
  const [search, setSearch] = useState(url.get('search') ?? ''),
    [debounced, setDebounced] = useState(search),
    [cursors, setCursors] = useState<(string | null)[]>([null]);
  useEffect(() => {
    setSearch(url.get('search') ?? '');
  }, [url.get('search')]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const status = url.get('status') ?? '',
    from = url.get('from') ?? '',
    to = url.get('to') ?? '',
    accountId = url.get('accountId') ?? '';
  useEffect(() => setCursors([null]), [debounced, status, from, to, accountId, revision]);
  useEffect(() => {
    const id = url.get('entry');
    if (id) {
      openEntry(id);
      const next = new URLSearchParams(url);
      next.delete('entry');
      setUrl(next, { replace: true });
    }
  }, [url, openEntry, setUrl]);
  const filter = params({ search: debounced, status, from, to, accountId, cursor: cursors.at(-1) }),
    resource = useResource<{ items: Entry[]; nextCursor: string | null }>(`/entries?${filter}`, revision);
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(url);
    value ? next.set(key, value) : next.delete(key);
    setUrl(next);
  }
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Find a payment, review a draft, or record something new."
        actions={
          <>
            <button className="button primary" onClick={() => openComposer({ mode: 'simple' })}>
              <Plus size={17} />
              Record transaction
            </button>
          </>
        }
      />
      <section className="card transaction-list">
        <div className="list-toolbar">
          <div className="tabs compact">
            <button className={!status ? 'selected' : ''} onClick={() => setFilter('status', '')}>
              All entries
            </button>
            <button
              className={status === 'POSTED' ? 'selected' : ''}
              onClick={() => setFilter('status', 'POSTED')}
            >
              Posted
            </button>
            <button
              className={status === 'DRAFT' ? 'selected' : ''}
              onClick={() => setFilter('status', 'DRAFT')}
            >
              Drafts
              <span className="tab-dot" />
            </button>
          </div>
          <button
            className="button small secondary"
            disabled={!resource.data?.items.length}
            onClick={() =>
              downloadCsv(
                'daybook-transactions-page.csv',
                ['Date', 'Entry', 'Description', 'Counterparty', 'Status', 'Amount USD'],
                resource.data!.items.map((e) => [
                  e.date,
                  e.number,
                  e.description,
                  e.counterparty,
                  e.status,
                  e.total,
                ]),
              )
            }
          >
            <Download size={15} />
            Export page
          </button>
        </div>
        <div className="filters">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search transactions"
              placeholder="Search descriptions, names or references…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by account"
            value={accountId}
            onChange={(e) => setFilter('accountId', e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts
              .filter((a) => !a.is_group)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
          </select>
          <label className="date-field">
            <span>From</span>
            <input
              type="date"
              aria-label="Transactions from date"
              value={from}
              onChange={(e) => setFilter('from', e.target.value)}
            />
          </label>
          <label className="date-field">
            <span>To</span>
            <input
              type="date"
              aria-label="Transactions to date"
              value={to}
              onChange={(e) => setFilter('to', e.target.value)}
            />
          </label>
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : resource.loading ? (
          <Loading />
        ) : !resource.data?.items.length ? (
          <Empty
            title="No entries in this view"
            description="Try a different filter, or record your first business event."
            action={
              <button className="button primary" onClick={() => openComposer({ mode: 'simple' })}>
                <Plus size={16} />
                Create an entry
              </button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Entry</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="amount">Amount · USD</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((e) => (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    onClick={() => openEntry(e.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') openEntry(e.id);
                    }}
                  >
                    <td className="nowrap">{shortDate(e.date)}</td>
                    <td>
                      <strong className="row-title">{e.description}</strong>
                      <span className="row-subtitle">
                        {e.counterparty || '—'}
                        {e.reference && ` · ${e.reference}`}
                      </span>
                    </td>
                    <td className="mono muted">JE-{String(e.number).padStart(4, '0')}</td>
                    <td>
                      <span className="source-label">
                        {e.source === 'AI' && <MessageSquareText size={13} />}
                        {{
                          MANUAL: 'Manual',
                          AI: 'AI assisted',
                          SEED: 'Sample',
                          RECURRING: 'Recurring',
                          REVERSAL: 'Reversal',
                        }[e.source] ?? e.source}
                      </span>
                    </td>
                    <td>
                      <Badge tone={e.status === 'DRAFT' ? 'amber' : e.reversal_id ? 'neutral' : 'green'}>
                        {e.status === 'DRAFT' ? 'Draft' : e.reversal_id ? 'Reversed' : 'Posted'}
                      </Badge>
                    </td>
                    <td className="amount strong">{formatMoney(e.total)}</td>
                    <td>
                      <ArrowUpRight size={15} className="muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resource.data && (
          <Pagination
            label={`Page ${cursors.length} · ${resource.data.items.length} entries`}
            hasNext={Boolean(resource.data.nextCursor)}
            hasPrevious={cursors.length > 1}
            onPrevious={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => setCursors((c) => [...c, resource.data!.nextCursor])}
          />
        )}
      </section>
      <p className="page-footnote">
        <LockKeyhole size={13} />
        Posted entries are permanent. Corrections create a linked reversal, keeping the full history intact.
      </p>
    </>
  );
}

export function EntryDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { revision, refresh, notify, openComposer, openEntry, meta } = useWorkspace(),
    resource = useResource<Entry>(`/entries/${id}`, revision);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<UiError>(''),
    [reversing, setReversing] = useState(false),
    [date, setDate] = useState(meta!.today),
    [confirmedRate, setConfirmedRate] = useState(false),
    [key] = useState(() => crypto.randomUUID());
  const entry = resource.data;
  async function post() {
    setBusy(true);
    setError('');
    try {
      const posted = await write<Entry>(`/entries/${id}/post`, {
        exchangeRatesConfirmed: confirmedRate,
        expectedRevision: entry?.revision,
      });
      refresh();
      notify(
        posted.categorizationLearning?.status === 'LEARNED'
          ? 'Entry posted. Your category choice was remembered for similar purchases.'
          : 'Entry posted. Your reports are up to date.',
      );
    } catch (e) {
      setError(asUiError(e));
    } finally {
      setBusy(false);
    }
  }
  async function reverse() {
    setBusy(true);
    setError('');
    try {
      const result = await write<Entry>(`/entries/${id}/reverse`, { date }, 'POST', key);
      refresh();
      notify('Reversal posted. The original entry is preserved.');
      openEntry(result.id);
      setReversing(false);
    } catch (e) {
      setError(asUiError(e));
    } finally {
      setBusy(false);
    }
  }
  async function forgetExample() {
    const memoryId = entry?.categorizationLearning?.memoryId;
    if (!memoryId) return;
    setBusy(true);
    setError('');
    try {
      await write(`/ai/corrections/${memoryId}`, {}, 'DELETE');
      refresh();
      notify('This example will no longer be used for suggestions. Your journal entry is unchanged.');
    } catch (error) {
      setError(asUiError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Journal entry" onClose={onClose} wide drawer>
      <div className="modal-body">
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : !entry ? (
          <Loading />
        ) : (
          <>
            <div className="entry-title">
              <span className="eyebrow">JE-{String(entry.number).padStart(4, '0')}</span>
              <Badge tone={entry.status === 'POSTED' ? 'green' : 'amber'}>
                {entry.status === 'POSTED' ? 'Posted' : 'Draft'}
              </Badge>
            </div>
            <h2 className="entry-description">{entry.description}</h2>
            <div className="entry-metadata">
              <div>
                <span>Transaction date</span>
                <strong>{shortDate(entry.date)}</strong>
              </div>
              <div>
                <span>Counterparty</span>
                <strong>{entry.counterparty || '—'}</strong>
              </div>
              <div>
                <span>Reference</span>
                <strong>{entry.reference || '—'}</strong>
              </div>
            </div>
            {entry.reversal_id && (
              <div className="info-note">
                This entry has been reversed.{' '}
                <button className="text-button" onClick={() => openEntry(entry.reversal_id!)}>
                  View reversal
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            {entry.reverses_entry_id && (
              <div className="info-note">
                This entry reverses an earlier record.{' '}
                <button className="text-button" onClick={() => openEntry(entry.reverses_entry_id!)}>
                  View original
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            <div className="entry-lines table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Currency / rate</th>
                    <th className="amount">Debit</th>
                    <th className="amount">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong className="row-title">{l.account_name}</strong>
                        <span className="row-subtitle">
                          {l.account_code}
                          {l.memo && ` · ${l.memo}`}
                        </span>
                      </td>
                      <td>
                        <span>{l.currency}</span>
                        <span className="row-subtitle">
                          {l.currency === 'USD'
                            ? 'Base currency'
                            : `1 ${l.currency} = ${l.exchange_rate} USD`}
                        </span>
                      </td>
                      <td className="amount">
                        {Number(l.debit) ? (
                          <>
                            {formatMoney(l.debit, l.currency)}
                            {l.currency !== 'USD' && (
                              <span className="row-subtitle">{formatMoney(l.base_debit)} USD</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="amount">
                        {Number(l.credit) ? (
                          <>
                            {formatMoney(l.credit, l.currency)}
                            {l.currency !== 'USD' && (
                              <span className="row-subtitle">{formatMoney(l.base_credit)} USD</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total · USD</td>
                    <td className="amount">{formatMoney(entry.total)}</td>
                    <td className="amount">
                      {formatMoney(sum(entry.lines.map((l) => l.base_credit)).toString())}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {entry.status === 'POSTED' && (
              <div className="entry-audit">
                <LockKeyhole size={16} />
                <span>Posted {new Date(entry.posted_at!).toLocaleString()} · This record is immutable.</span>
              </div>
            )}
            {entry.categorizationLearning?.status === 'LEARNED' && (
              <div className="info-note">
                <span>Your category choice is remembered as an example for similar purchases.</span>
                <button className="text-button" disabled={busy} onClick={forgetExample}>
                  Forget this example
                </button>
              </div>
            )}
            {entry.categorizationLearning?.status === 'REVOKED' && (
              <p className="muted">This example is no longer used for suggestions.</p>
            )}
            {entry.status === 'DRAFT' && entry.source === 'AI' && (
              <p className="muted">
                Category changes are remembered only after you review and post this entry.
              </p>
            )}
            {entry.status === 'DRAFT' &&
              entry.source === 'RECURRING' &&
              entry.lines.some((l) => l.currency !== 'USD') && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={confirmedRate}
                    onChange={(e) => setConfirmedRate(e.target.checked)}
                  />
                  I reviewed the exchange rates for this occurrence.
                </label>
              )}
            {reversing && (
              <div className="reversal-form">
                <h3>Reverse this entry</h3>
                <p>This creates an equal and opposite posted entry. The original stays in your journal.</p>
                <label className="field">
                  Reversal date
                  <input
                    type="date"
                    min={entry.date}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button className="button secondary" onClick={() => setReversing(false)}>
                    Cancel
                  </button>
                  <button className="button danger" disabled={busy} onClick={reverse}>
                    {busy ? <Spinner /> : <Undo2 size={16} />}Post reversal
                  </button>
                </div>
              </div>
            )}
            {error && <ErrorState message={error} />}
          </>
        )}
      </div>
      {entry && (
        <div className="modal-footer">
          <span className="muted">
            {entry.status === 'DRAFT'
              ? 'Drafts do not affect your reports.'
              : 'A permanent record of your business.'}
          </span>
          <div>
            {entry.status === 'DRAFT' ? (
              <>
                <button className="button secondary" onClick={() => openComposer({ mode: 'manual', entry })}>
                  <Edit3 size={16} />
                  Edit draft
                </button>
                <button className="button primary" onClick={post} disabled={busy}>
                  {busy ? <Spinner /> : <Check size={16} />}Post entry
                </button>
              </>
            ) : !entry.reversal_id && !entry.reverses_entry_id && !reversing ? (
              <button className="button secondary" onClick={() => setReversing(true)}>
                <Undo2 size={16} />
                Reverse entry
              </button>
            ) : (
              <button className="button secondary" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
