import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight } from 'lucide-react';
import { useResource, write } from './api';
import { useWorkspace } from './context';
import { Badge, Empty, ErrorState, Loading, Modal, shortDate } from './ui';
type Alert = {
  id: string;
  entry_id: string;
  severity: string;
  title: string;
  explanation: string;
  date: string;
  entry_description: string;
  status: string;
};
export function Alerts({ onClose }: { onClose: () => void }) {
  const { revision, refresh, notify, openEntry } = useWorkspace(),
    [status, setStatus] = useState('OPEN'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const resource = useResource<Alert[]>(`/alerts?status=${status}`, revision);
  async function dismiss(id: string) {
    setBusy(id);
    try {
      await write(`/alerts/${id}`, { status: status === 'OPEN' ? 'DISMISSED' : 'OPEN' }, 'PATCH');
      refresh();
      notify(status === 'OPEN' ? 'Alert marked as reviewed.' : 'Alert reopened.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal title="Review alerts" onClose={onClose} drawer>
      <div className="modal-body">
        <p className="lead-muted">
          Review unusual amounts and possible duplicates. Alerts do not change your entries.
        </p>
        <div className="tabs">
          <button className={status === 'OPEN' ? 'selected' : ''} onClick={() => setStatus('OPEN')}>
            Needs review
          </button>
          <button className={status === 'DISMISSED' ? 'selected' : ''} onClick={() => setStatus('DISMISSED')}>
            Reviewed
          </button>
        </div>
        {error && <ErrorState message={error} />}
        <div className="alert-list">
          {resource.error ? (
            <ErrorState message={resource.error} retry={resource.reload} />
          ) : resource.loading ? (
            <Loading />
          ) : !resource.data?.length ? (
            <Empty
              title="You’re all caught up"
              description="No alerts in this view. New posted entries are checked automatically."
            />
          ) : (
            resource.data.map((a) => (
              <article className={`alert-card ${a.severity.toLowerCase()}`} key={a.id}>
                <div className="alert-heading">
                  <span className="alert-symbol">
                    <AlertTriangle size={19} />
                  </span>
                  <Badge tone={a.severity === 'HIGH' ? 'amber' : 'neutral'}>
                    {a.severity === 'HIGH'
                      ? 'Unusual amount'
                      : a.severity === 'WARNING'
                        ? 'Possible duplicate'
                        : 'Different pattern'}
                  </Badge>
                </div>
                <h3>{a.title}</h3>
                <p>{a.explanation}</p>
                <span className="alert-date">
                  {shortDate(a.date)} · {a.entry_description}
                </span>
                <div className="alert-actions">
                  <button className="text-button" onClick={() => openEntry(a.entry_id)}>
                    View entry
                    <ChevronRight size={15} />
                  </button>
                  <button
                    className="button small secondary"
                    disabled={busy === a.id}
                    onClick={() => dismiss(a.id)}
                  >
                    <Check size={14} />
                    {status === 'OPEN' ? 'Mark reviewed' : 'Reopen'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
        <p className="page-footnote">
          Signals use duplicate matching and historical patterns. They are review suggestions, not fraud
          determinations.
        </p>
      </div>
    </Modal>
  );
}
