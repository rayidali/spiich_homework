import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  Plus,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { type Account, accountTypes, currencyCodes, type AccountInput } from '../../shared/schema';
import { sum } from '../../shared/money';
import { useWorkspace } from './context';
import { api, params, useResource, write } from './api';
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
  normalBalance,
  shortDate,
} from './ui';

export function Accounts() {
  const { accounts, refresh, notify } = useWorkspace(),
    [url, setUrl] = useSearchParams();
  const [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [archived, setArchived] = useState(false),
    [editor, setEditor] = useState<Account | 'new' | null>(null),
    [ledger, setLedger] = useState<string | null>(url.get('account')),
    [error, setError] = useState(''),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (url.get('account')) setLedger(url.get('account'));
  }, [url.get('account')]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  function depth(a: Account) {
    let n = 0,
      parent = a.parent_id;
    while (parent && n < 12) {
      n++;
      parent = byId.get(parent)?.parent_id ?? null;
    }
    return n;
  }
  function hidden(a: Account) {
    let parent = a.parent_id;
    while (parent) {
      if (collapsed.has(parent)) return true;
      parent = byId.get(parent)?.parent_id ?? null;
    }
    return false;
  }
  function total(a: Account): string {
    return a.is_group ? sum(accounts.filter((c) => c.parent_id === a.id).map(total)).toString() : a.balance;
  }
  async function archive(a: Account) {
    try {
      await write(`/accounts/${a.id}`, { archived: !a.archived }, 'PATCH');
      refresh();
      notify(a.archived ? 'Account restored.' : 'Account archived. Its history is preserved.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const visible = accounts.filter(
    (a) =>
      (archived || !a.archived) &&
      (!type || a.type === type) &&
      `${a.name} ${a.code}`.toLowerCase().includes(search.toLowerCase()) &&
      (!hidden(a) || Boolean(search)),
  );
  function closeLedger() {
    setLedger(null);
    const next = new URLSearchParams(url);
    next.delete('account');
    setUrl(next, { replace: true });
  }
  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="Manage accounts, currencies, and the structure of your ledger."
        actions={
          <button className="button primary" onClick={() => setEditor('new')}>
            <Plus size={17} />
            Add account
          </button>
        }
      />
      <div className="account-summary">
        {accountTypes.map((t) => (
          <button
            key={t}
            onClick={() => setType(type === t ? '' : t)}
            className={`account-type-card ${type === t ? 'selected' : ''}`}
          >
            <span className={`account-type-dot ${t.toLowerCase()}`} />
            <strong>
              {
                {
                  ASSET: 'Assets',
                  LIABILITY: 'Liabilities',
                  EQUITY: 'Equity',
                  REVENUE: 'Revenue',
                  EXPENSE: 'Expenses',
                }[t]
              }
            </strong>
            <span>{accounts.filter((a) => a.type === t && !a.is_group && !a.archived).length} accounts</span>
          </button>
        ))}
      </div>
      {error && <ErrorState message={error} />}
      <section className="card">
        <div className="filters account-filters">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search accounts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an account by name or code…"
            />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Show archived
          </label>
          <span className="muted">Balances in USD</span>
        </div>
        <div className="table-scroll">
          <table className="data-table accounts-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Currency</th>
                <th className="amount">Book balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr
                  key={a.id}
                  className={`${a.is_group ? 'account-group' : ''} ${a.archived ? 'archived-row' : ''}`}
                >
                  <td>
                    <div className="account-name" style={{ paddingLeft: depth(a) * 22 }}>
                      {a.is_group ? (
                        <button
                          className="icon-button group-toggle"
                          aria-label={`${collapsed.has(a.id) ? 'Expand' : 'Collapse'} ${a.name}`}
                          onClick={() =>
                            setCollapsed((c) => {
                              const next = new Set(c);
                              next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(a.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                        </button>
                      ) : (
                        <span className="account-leaf">
                          {a.is_cash ? <Wallet size={15} /> : <BookOpen size={15} />}
                        </span>
                      )}
                      <span className="account-code">{a.code}</span>
                      <button className="account-link" disabled={a.is_group} onClick={() => setLedger(a.id)}>
                        {a.name}
                      </button>
                      {a.archived && <Badge>Archived</Badge>}
                    </div>
                  </td>
                  <td>
                    <span className={`type-label ${a.type.toLowerCase()}`}>{a.type.toLowerCase()}</span>
                  </td>
                  <td className="muted">{a.is_group ? '—' : a.currency}</td>
                  <td className="amount strong">
                    {formatMoney(normalBalance(total(a), a.type))}
                    {!a.is_group && a.currency !== 'USD' && (
                      <span className="row-subtitle">
                        {formatMoney(normalBalance(a.native_balance, a.type), a.currency)}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={`Edit ${a.name}`}
                        onClick={() => setEditor(a)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`${a.archived ? 'Restore' : 'Archive'} ${a.name}`}
                        onClick={() => archive(a)}
                      >
                        <Archive size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <Empty title="No matching accounts" description="Try another name, code or account type." />
        )}
        <div className="table-footnote">
          Group balances include their children. Used accounts can be archived while preserving their journal
          history.
        </div>
      </section>
      {editor && (
        <AccountEditor account={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />
      )}
      {ledger && (
        <Ledger
          id={ledger}
          initialFrom={url.get('from') ?? undefined}
          initialTo={url.get('to') ?? undefined}
          onClose={closeLedger}
        />
      )}
    </>
  );
}
function AccountEditor({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { accounts, refresh, notify } = useWorkspace();
  const [value, setValue] = useState<AccountInput>({
    code: account?.code ?? '',
    name: account?.name ?? '',
    type: account?.type ?? 'EXPENSE',
    currency: (account?.currency ?? 'USD') as AccountInput['currency'],
    parentId: account?.parent_id ?? null,
    isGroup: account?.is_group ?? false,
    isCash: account?.is_cash ?? false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await write(account ? `/accounts/${account.id}` : '/accounts', value, account ? 'PUT' : 'POST');
      refresh();
      notify(account ? 'Account updated.' : 'Account created.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/accounts/${account!.id}`, { method: 'DELETE' });
      refresh();
      notify('Unused account deleted.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={account ? 'Edit account' : 'Add an account'} onClose={onClose}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field">
            Account code
            <input
              data-autofocus
              value={value.code}
              onChange={(e) => setValue({ ...value, code: e.target.value })}
              placeholder="e.g. 5070"
              inputMode="numeric"
            />
          </label>
          <label className="field">
            Currency
            <select
              value={value.currency}
              onChange={(e) => setValue({ ...value, currency: e.target.value as AccountInput['currency'] })}
            >
              {currencyCodes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Account name
          <input
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            placeholder="e.g. Professional services"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Type
            <select
              value={value.type}
              onChange={(e) =>
                setValue({
                  ...value,
                  type: e.target.value as AccountInput['type'],
                  parentId: null,
                  isCash: false,
                })
              }
            >
              {accountTypes.map((t) => (
                <option key={t} value={t}>
                  {t[0] + t.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Parent group
            <select
              value={value.parentId ?? ''}
              onChange={(e) => setValue({ ...value, parentId: e.target.value || null })}
            >
              <option value="">No parent group</option>
              {accounts
                .filter((a) => a.is_group && !a.archived && a.type === value.type && a.id !== account?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={value.isGroup}
            onChange={(e) => setValue({ ...value, isGroup: e.target.checked, isCash: false })}
          />
          Use as a group for child accounts
        </label>
        {value.type === 'ASSET' && !value.isGroup && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.isCash}
              onChange={(e) => setValue({ ...value, isCash: e.target.checked })}
            />
            Include in cash and bank balances
          </label>
        )}
        <p className="form-note">
          The type, currency and cash classification are locked once an account has journal activity.
        </p>
        {error && <ErrorState message={error} />}{' '}
        {confirmDelete && (
          <div className="reversal-form">
            <p>Delete this unused account? Accounts with journal history cannot be deleted.</p>
            <button className="button danger small" onClick={remove} disabled={busy}>
              Confirm deletion
            </button>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <div>
          {account && (
            <button className="button ghost danger-text" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} />
              Delete unused
            </button>
          )}
        </div>
        <div>
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !value.name || !value.code} onClick={save}>
            {busy && <Spinner />}
            {account ? 'Save account' : 'Create account'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
type LedgerResult = {
  account: Account;
  opening: string;
  closing: string;
  items: {
    entry_id: string;
    line_id: string;
    date: string;
    description: string;
    currency: string;
    debit: string;
    credit: string;
    base_debit: string;
    base_credit: string;
    running_balance: string;
  }[];
  nextCursor: string | null;
};
function Ledger({
  id,
  onClose,
  initialFrom,
  initialTo,
}: {
  id: string;
  onClose: () => void;
  initialFrom?: string;
  initialTo?: string;
}) {
  const { meta, revision, openEntry } = useWorkspace(),
    [from, setFrom] = useState(initialFrom ?? meta!.today.slice(0, 7) + '-01'),
    [to, setTo] = useState(initialTo ?? meta!.today),
    [cursors, setCursors] = useState<(string | null)[]>([null]);
  useEffect(() => setCursors([null]), [from, to]);
  const resource = useResource<LedgerResult>(
      `/accounts/${id}/ledger?${params({ from, to, cursor: cursors.at(-1) })}`,
      revision,
    ),
    data = resource.data;
  return (
    <Modal title={data ? `${data.account.name} · Ledger` : 'Account ledger'} onClose={onClose} wide drawer>
      <div className="modal-body">
        <div className="report-filters">
          <label className="date-field">
            <span>From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="date-field">
            <span>To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : !data || resource.loading ? (
          <Loading />
        ) : (
          <>
            <div className="ledger-summary">
              <div>
                <span>Opening balance</span>
                <strong>{formatMoney(normalBalance(data.opening, data.account.type))}</strong>
                <small>Before {shortDate(from)}</small>
              </div>
              <div>
                <span>Closing balance</span>
                <strong>{formatMoney(normalBalance(data.closing, data.account.type))}</strong>
                <small>Through {shortDate(to)}</small>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="amount">Debit · {data.account.currency}</th>
                    <th className="amount">Credit · {data.account.currency}</th>
                    <th className="amount">Balance · USD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr
                      key={row.line_id}
                      tabIndex={0}
                      onClick={() => {
                        onClose();
                        openEntry(row.entry_id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onClose();
                          openEntry(row.entry_id);
                        }
                      }}
                    >
                      <td className="nowrap">{shortDate(row.date)}</td>
                      <td>{row.description}</td>
                      <td className="amount">
                        {Number(row.debit) ? formatMoney(row.debit, row.currency) : '—'}
                      </td>
                      <td className="amount">
                        {Number(row.credit) ? formatMoney(row.credit, row.currency) : '—'}
                      </td>
                      <td className="amount strong">
                        {formatMoney(normalBalance(row.running_balance, data.account.type))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <Empty
                title="No movement in this period"
                description="The opening and closing balances still include the account’s earlier posted history."
              />
            )}
            <Pagination
              label={`${data.items.length} movements · Page ${cursors.length}`}
              hasNext={Boolean(data.nextCursor)}
              hasPrevious={cursors.length > 1}
              onNext={() => setCursors((c) => [...c, data.nextCursor])}
              onPrevious={() => setCursors((c) => c.slice(0, -1))}
            />
            <p className="page-footnote">
              Running balances include the opening balance and are shown on the account’s normal side. Click a
              movement to view its journal entry.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
