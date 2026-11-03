import { lazy, Suspense, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, MessageSquareText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { NativeAssistant } from './NativeAssistant';
import { ErrorBoundary } from './ErrorBoundary';
import { Modal, PageHeader, Spinner } from './ui';

const QuerioAssistant = lazy(() =>
  import('./QuerioAssistant').then((module) => ({ default: module.QuerioAssistant })),
);

type Analyst = 'daybook' | 'querio';
const analystOptions: { id: Analyst; label: string }[] = [
  { id: 'daybook', label: 'Daybook' },
  { id: 'querio', label: 'Querio' },
];

function AnalystTabs({
  selected,
  onSelect,
  initialText,
  onNavigate,
  fullPage = false,
}: {
  selected: Analyst;
  onSelect: (analyst: Analyst) => void;
  initialText?: string;
  onNavigate: () => void;
  fullPage?: boolean;
}) {
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [querioOpened, setQuerioOpened] = useState(selected === 'querio');
  function select(analyst: Analyst) {
    if (analyst === 'querio') setQuerioOpened(true);
    onSelect(analyst);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % analystOptions.length;
    else if (event.key === 'ArrowLeft') next = (index + analystOptions.length - 1) % analystOptions.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = analystOptions.length - 1;
    else return;
    event.preventDefault();
    select(analystOptions[next].id);
    tabRefs.current[next]?.focus();
  }
  return (
    <div className={`analyst-workspace ${fullPage ? 'is-full-page' : ''}`}>
      <div className="analyst-toolbar">
        <div className="analyst-tabs" role="tablist" aria-label="Choose an analyst">
          {analystOptions.map((analyst, index) => (
            <button
              key={analyst.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`${id}-${analyst.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected === analyst.id}
              aria-controls={`${id}-${analyst.id}-panel`}
              tabIndex={selected === analyst.id ? 0 : -1}
              onClick={() => select(analyst.id)}
              onKeyDown={(event) => keyDown(event, index)}
            >
              {analyst.label}
            </button>
          ))}
        </div>
        {!fullPage && (
          <Link className="text-button analyst-expand" to={`/analyst?tab=${selected}`} onClick={onNavigate}>
            Open full workspace <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      <section
        className="analyst-panel native-analyst-panel"
        id={`${id}-daybook-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-daybook-tab`}
        hidden={selected !== 'daybook'}
      >
        <NativeAssistant initialText={initialText} onClose={onNavigate} />
      </section>
      <section
        className="analyst-panel querio-analyst-panel"
        id={`${id}-querio-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-querio-tab`}
        hidden={selected !== 'querio'}
      >
        {(querioOpened || selected === 'querio') && (
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="chat-thinking" role="status">
                  <Spinner /> Opening Querio…
                </div>
              }
            >
              <QuerioAssistant active={selected === 'querio'} />
            </Suspense>
          </ErrorBoundary>
        )}
      </section>
    </div>
  );
}

export function Assistant({ initialText, onClose }: { initialText?: string; onClose: () => void }) {
  const [selected, setSelected] = useState<Analyst>('daybook');
  return (
    <Modal title="Financial assistant" onClose={onClose} drawer wide={selected === 'querio'}>
      <AnalystTabs
        selected={selected}
        onSelect={setSelected}
        initialText={initialText}
        onNavigate={onClose}
      />
    </Modal>
  );
}

export function AnalystPage() {
  const [search, setSearch] = useSearchParams();
  const selected: Analyst = search.get('tab') === 'daybook' ? 'daybook' : 'querio';
  return (
    <div className="analyst-page">
      <PageHeader
        eyebrow="Your financial workspace"
        title="Ask your books"
        description="Ask a question, explore the answer, and see the supporting work."
        actions={
          <span className="analyst-page-caption">
            <MessageSquareText size={16} /> Two analysts, your Daybook records
          </span>
        }
      />
      <div className="analyst-page-body">
        <AnalystTabs
          selected={selected}
          onSelect={(tab) => setSearch({ tab }, { replace: true })}
          onNavigate={() => undefined}
          fullPage
        />
      </div>
    </div>
  );
}
