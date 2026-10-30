import { useState } from 'react';
import { CalendarDays, Check, Pause, Play, Plus, RefreshCw, Repeat2 } from 'lucide-react';
import type { RecurringTemplate } from '../../shared/schema';
import { baseAmount, sum } from '../../shared/money';
import { useWorkspace } from './context';
import { useResource, write } from './api';
import { Badge, Empty, ErrorState, Loading, Modal, PageHeader, Spinner, formatMoney, shortDate } from './ui';
type Template = RecurringTemplate;
export function Recurring() {
  const { revision, refresh, notify, openComposer, accounts } = useWorkspace(),
    resource = useResource<Template[]>('/recurring', revision),
    [selected, setSelected] = useState<Template | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  async function toggle(t: Template) {
    setBusy(t.id);
    try {
      await write(`/recurring/${t.id}`, { active: !t.active }, 'PATCH');
      refresh();
      setSelected(null);
      notify(
        t.active
          ? 'Schedule paused. Existing entries are unchanged.'
          : 'Schedule resumed. Due entries will be generated as drafts.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function generate() {
    setBusy('generate');
    try {
      const result = await write<{ generated: number; failed: number }>('/recurring/generate', {});
      refresh();
      notify(
        result.failed
          ? `${result.generated} entries generated. ${result.failed} schedules need attention; open their details to review.`
          : result.generated
            ? `${result.generated} due entries generated for review.`
            : 'Your schedules are up to date. No new occurrences are due.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const amount = (t: Template) => sum(t.lines.map((l) => baseAmount(l.debit, l.exchangeRate))).toString();
  return (
    <>
      <PageHeader
        title="Recurring transactions"
        description="Schedule regular transactions for review before posting."
        actions={
          <button className="button primary" onClick={() => openComposer({ mode: 'recurring' })}>
            <Plus size={17} />
            New schedule
          </button>
        }
      />
      <div className="recurring-banner">
        <span className="recurring-banner-icon">
          <Repeat2 size={24} />
        </span>
        <div>
          <strong>Scheduled entries arrive as drafts.</strong>
          <p>Due occurrences appear as drafts automatically. Review and post them from Transactions.</p>
        </div>
        <button className="button secondary" disabled={Boolean(busy)} onClick={generate}>
          {busy === 'generate' ? <Spinner /> : <RefreshCw size={15} />}Check due entries
        </button>
      </div>
      {error && <ErrorState message={error} />}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Your schedules</h2>
            <p>{resource.data?.filter((t) => t.active).length ?? 0} active templates</p>
          </div>
          <Badge tone="green">Automatic draft creation</Badge>
        </div>
        {resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : resource.loading ? (
          <Loading />
        ) : !resource.data?.length ? (
          <Empty
            title="Make repeat work easier"
            description="Set up a template for rent, subscriptions or another regular transaction."
            action={
              <button className="button primary" onClick={() => openComposer({ mode: 'recurring' })}>
                Create a schedule
              </button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table recurring-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Frequency</th>
                  <th>Next occurrence</th>
                  <th className="amount">Amount · USD</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resource.data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button className="transaction-cell plain-button" onClick={() => setSelected(t)}>
                        <span className="transaction-icon">
                          <Repeat2 size={17} />
                        </span>
                        <div>
                          <strong>{t.name}</strong>
                          <span>{t.counterparty || t.description}</span>
                        </div>
                      </button>
                    </td>
                    <td>
                      <span className="source-label">
                        <CalendarDays size={14} />
                        {{ WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }[t.frequency]}
                      </span>
                    </td>
                    <td>{shortDate(t.next_date)}</td>
                    <td className="amount strong">{formatMoney(amount(t))}</td>
                    <td>
                      <Badge tone={t.last_error ? 'amber' : t.active ? 'green' : 'neutral'}>
                        {t.last_error ? 'Needs attention' : t.active ? 'Active' : 'Paused'}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="button small secondary"
                        disabled={busy === t.id}
                        onClick={() => toggle(t)}
                      >
                        {t.active ? <Pause size={13} /> : <Play size={13} />} {t.active ? 'Pause' : 'Resume'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="page-footnote">
        <Check size={14} />
        Each scheduled date creates one draft. Review the amounts before posting.
      </p>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="modal-body">
            <div className="entry-metadata">
              <div>
                <span>Repeats</span>
                <strong>{selected.frequency.toLowerCase()}</strong>
              </div>
              <div>
                <span>Next occurrence</span>
                <strong>{shortDate(selected.next_date)}</strong>
              </div>
              <div>
                <span>Ends</span>
                <strong>{selected.end_date ? shortDate(selected.end_date) : 'No end date'}</strong>
              </div>
            </div>
            {selected.last_error && <ErrorState message={selected.last_error} />}
            <p>{selected.description}</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="amount">Debit</th>
                    <th className="amount">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((l, i) => {
                    const a = accounts.find((a) => a.id === l.accountId);
                    return (
                      <tr key={i}>
                        <td>{a?.name ?? 'Unknown account'}</td>
                        <td className="amount">
                          {Number(l.debit) ? formatMoney(l.debit, a?.currency) : '—'}
                        </td>
                        <td className="amount">
                          {Number(l.credit) ? formatMoney(l.credit, a?.currency) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="info-note">
              The schedule uses its original calendar anchor, including month-end dates. Every generated entry
              remains a draft until posted.
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => {
                openComposer({ mode: 'recurring', template: selected });
                setSelected(null);
              }}
            >
              Edit template
            </button>
            <button className="button secondary" disabled={Boolean(busy)} onClick={() => toggle(selected)}>
              {selected.active ? 'Pause schedule' : 'Resume schedule'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
