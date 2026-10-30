import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Bell,
  ChartNoAxesCombined,
  ChevronRight,
  HelpCircle,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Wallet,
  X,
  Check,
  ArrowUpRight,
  Settings2,
} from 'lucide-react';
import type { Account } from '../../shared/schema';
import { useResource } from './api';
import { WorkspaceContext, type ComposerState, type Meta } from './context';
import { Dashboard } from './Dashboard';
import { Transactions, EntryDetails } from './Transactions';
import { Accounts } from './Accounts';
import { Reports } from './Reports';
import { Recurring } from './Recurring';
import { Composer } from './Composer';
import { Assistant } from './Assistant';
import { Alerts } from './Alerts';
import { Settings } from './Settings';
import { ErrorState, Loading, Modal } from './ui';

const navigation = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: Wallet },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export function App() {
  const [revision, setRevision] = useState(0),
    [toast, setToast] = useState(''),
    [entryId, setEntryId] = useState<string | null>(null),
    [composer, setComposer] = useState<ComposerState | null>(null),
    [chat, setChat] = useState<{ text?: string } | null>(null),
    [alerts, setAlerts] = useState(false),
    [help, setHelp] = useState(false),
    [mobile, setMobile] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const meta = useResource<Meta>('/meta', revision),
    chart = useResource<Account[]>('/accounts', revision),
    location = useLocation();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  useEffect(() => {
    // Repeated keyboard actions should never wait for decorative motion.
    const keyboard = () => {
      document.documentElement.dataset.input = 'keyboard';
    };
    const pointer = () => {
      document.documentElement.dataset.input = 'pointer';
    };
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('pointerdown', pointer, true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const priorFocus = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      [...(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? [])].filter(
        (element) => element.getClientRects().length,
      );
    focusable()[0]?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
      if (event.key === 'Tab') {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', close);
    const desktop = window.matchMedia('(min-width: 761px)');
    const resize = () => {
      if (desktop.matches) setMobile(false);
    };
    desktop.addEventListener('change', resize);
    return () => {
      document.removeEventListener('keydown', close);
      desktop.removeEventListener('change', resize);
      document.body.style.overflow = priorOverflow;
      priorFocus?.focus();
    };
  }, [mobile]);
  const openEntry = useCallback((id: string) => {
    setEntryId(id);
    setChat(null);
    setAlerts(false);
  }, []);
  const openComposer = useCallback((state: ComposerState) => {
    setComposer(state);
    setEntryId(null);
    setChat(null);
    setAlerts(false);
  }, []);
  const openChat = useCallback((text?: string) => {
    setChat({ text });
    setMobile(false);
  }, []);
  const openAlerts = useCallback(() => {
    setAlerts(true);
    setChat(null);
    setMobile(false);
  }, []);
  const active =
    navigation.find((n) => n.to === location.pathname)?.label ??
    (location.pathname === '/accounts'
      ? 'Accounts'
      : location.pathname === '/recurring'
        ? 'Recurring payments'
        : 'Workspace');
  const organization = meta.data?.organization.name ?? 'Workspace';
  return (
    <WorkspaceContext.Provider
      value={{
        meta: meta.data,
        accounts: chart.data ?? [],
        revision,
        refresh,
        notify,
        openEntry,
        openComposer,
        openChat,
        openAlerts,
      }}
    >
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside
          ref={sidebarRef}
          className={`sidebar ${mobile ? 'is-open' : ''}`}
          role={mobile ? 'dialog' : undefined}
          aria-modal={mobile || undefined}
          aria-label="Workspace navigation"
        >
          <Link className="brand" to="/" aria-label="Daybook overview" onClick={() => setMobile(false)}>
            <svg
              className="brand-mark"
              width="25"
              height="28"
              viewBox="0 0 25 28"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 2H13C19 2 23 6 23 14C23 22 19 26 13 26H3V2Z"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path d="M8 3V25M8 10H16M8 17H16" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span>Daybook</span>
          </Link>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
          <div className="organization">
            <span className="organization-avatar" aria-hidden="true">
              {organization.charAt(0)}
            </span>
            <div>
              <strong>{organization}</strong>
              <span>{meta.data?.demo ? 'Demo workspace' : 'Business workspace'}</span>
            </div>
          </div>
          <nav aria-label="Main navigation">
            {navigation.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setMobile(false)}
                className={({ isActive }) =>
                  `nav-item ${isActive || (n.to === '/settings' && ['/accounts', '/recurring'].includes(location.pathname)) ? 'active' : ''}`
                }
              >
                <n.icon size={18} />
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className="nav-item secondary-nav"
              onClick={() => {
                setHelp(true);
                setMobile(false);
              }}
            >
              <HelpCircle size={17} />
              Workspace guide
            </button>
            <div className="workspace-caption">
              <span>Base currency</span>
              <strong>USD</strong>
            </div>
          </div>
        </aside>
        {mobile && (
          <button
            className="sidebar-scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setMobile(false)}
          />
        )}
        <div className="main-shell" inert={mobile}>
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                aria-expanded={mobile}
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </button>
              <span>{organization}</span>
              <ChevronRight size={13} />
              <strong>{active}</strong>
            </div>
            <div className="topbar-actions">
              <button className="assistant-top" onClick={() => openChat()}>
                <MessageSquareText size={16} />
                <span>Ask a question</span>
              </button>
              <button className="button secondary review-top" onClick={openAlerts} aria-label="Review alerts">
                <Bell size={18} />
                <span>Review{meta.data?.alertCount ? ` (${meta.data.alertCount})` : ''}</span>
              </button>
            </div>
          </header>
          <main className="main-content" id="workspace-content" tabIndex={-1}>
            {meta.error ? (
              <ErrorState message={meta.error} retry={meta.reload} />
            ) : chart.error ? (
              <ErrorState message={chart.error} retry={chart.reload} />
            ) : !meta.data || !chart.data ? (
              <Loading />
            ) : (
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/recurring" element={<Recurring />} />
                <Route path="/settings" element={<Settings />} />
                <Route
                  path="*"
                  element={
                    <div className="empty-state">
                      <h1>Page not found</h1>
                      <Link to="/">Back to overview</Link>
                    </div>
                  }
                />
              </Routes>
            )}
          </main>
          <footer className="app-footer">
            <span>
              Daybook<span className="footer-divider">/</span>
              {organization}
            </span>
            <span>USD · Recorded exchange rates</span>
          </footer>
        </div>
      </div>
      {entryId && <EntryDetails id={entryId} onClose={() => setEntryId(null)} />}
      {composer && <Composer state={composer} onClose={() => setComposer(null)} />}
      {chat && <Assistant initialText={chat.text} onClose={() => setChat(null)} />}
      {alerts && <Alerts onClose={() => setAlerts(false)} />}
      {help && (
        <Modal title="Workspace guide" onClose={() => setHelp(false)}>
          <div className="modal-body guide">
            <h3>Working in Daybook</h3>
            <p>Every posted entry has equal debits and credits. Reports are calculated from that journal.</p>
            <ol>
              <li>
                <strong>Create an entry.</strong> Start with “Record money in or out.” Use the short form,
                describe what happened, or open the journal form.
              </li>
              <li>
                <strong>Review and post.</strong> Drafts stay out of reports until you confirm them.
              </li>
              <li>
                <strong>Follow a balance.</strong> Open an account ledger to see its supporting entries.
              </li>
              <li>
                <strong>Correct with a reversal.</strong> Reverse a posted error, then enter the correction.
                Both records stay in the journal.
              </li>
            </ol>
            <div className="info-note">
              {meta.data?.demo && 'This workspace contains six months of sample activity. '}Foreign amounts
              use recorded exchange rates. Alerts require your review.
            </div>
            <Link className="text-button guide-link" to="/reports" onClick={() => setHelp(false)}>
              Open reports
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
