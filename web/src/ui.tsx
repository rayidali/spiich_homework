import { useEffect, useRef, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  X,
  Inbox,
} from 'lucide-react';
import { Decimal, formatCurrency } from '../../shared/money';
export const formatMoney = formatCurrency;
export const shortDate = (date: string) =>
  new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
export const normalBalance = (value: string, type: string) =>
  ['LIABILITY', 'EQUITY', 'REVENUE'].includes(type) ? new Decimal(value).negated().toString() : value;
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={17} aria-label="Loading" />;
}
export function Loading() {
  return (
    <div className="loading-state" role="status">
      <Spinner />
      <span>Loading your books…</span>
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>We couldn’t complete that</strong>
        <p>{message}</p>
        {retry && (
          <button className="button small secondary" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const element = ref.current;
    setTimeout(
      () => element?.querySelector<HTMLElement>('[data-autofocus],input,button,select,textarea')?.focus(),
      0,
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab' && element) {
        const focusable = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${drawer ? 'drawer-backdrop' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''} ${drawer ? 'drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Pagination({
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  label,
}: {
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  label: string;
}) {
  return (
    <div className="pagination">
      <span>{label}</span>
      <div>
        <button className="button small secondary" disabled={!hasPrevious} onClick={onPrevious}>
          <ChevronLeft size={15} />
          Previous
        </button>
        <button className="button small secondary" disabled={!hasNext} onClick={onNext}>
          Next
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
export function BalanceCheck({ balanced, difference = '0.00' }: { balanced: boolean; difference?: string }) {
  return (
    <div className={`balance-check ${balanced ? 'good' : 'bad'}`}>
      {balanced ? <Check size={16} /> : <AlertCircle size={16} />}
      <span>{balanced ? 'Your books are balanced' : `Difference: ${formatMoney(difference)}`}</span>
      {balanced && <span className="muted">Debits equal credits</span>}
    </div>
  );
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}
