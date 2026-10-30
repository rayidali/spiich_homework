import { Link } from 'react-router-dom';
import { BookOpen, Repeat2, ChevronRight } from 'lucide-react';
import { useWorkspace } from './context';
import { PageHeader } from './ui';

export function Settings() {
  const { meta } = useWorkspace();
  return (
    <>
      <PageHeader title="Settings" description="Keep your accounts and regular payments organized." />
      <section className="settings-list" aria-label="Workspace settings">
        <Link to="/accounts" className="settings-row">
          <BookOpen size={22} />
          <span>
            <strong>Chart of accounts</strong>
            <small>Manage where money is recorded. Open an account to see its history.</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link to="/recurring" className="settings-row">
          <Repeat2 size={22} />
          <span>
            <strong>Recurring payments</strong>
            <small>Set up regular transactions. Each occurrence arrives as a draft to review.</small>
          </span>
          <ChevronRight size={18} />
        </Link>
      </section>
      <section className="workspace-details" aria-label="Workspace details">
        <h2>Your workspace</h2>
        <dl>
          <div>
            <dt>Business</dt>
            <dd>{meta?.organization.name}</dd>
          </div>
          <div>
            <dt>Report currency</dt>
            <dd>{meta?.organization.base_currency}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{meta?.organization.timezone}</dd>
          </div>
          <div>
            <dt>Financial assistant</dt>
            <dd>{meta?.ai.available ? 'Key configured' : 'Not configured'}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
