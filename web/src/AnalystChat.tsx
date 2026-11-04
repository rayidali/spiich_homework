import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  ArrowUp,
  ArrowUpRight,
  Database,
  MessageSquareText,
  NotebookPen,
  Plus,
  Square,
  X,
} from 'lucide-react';
import type { AnalystAvailability, AnalystConversation, AnalystProvider } from '../../shared/analyst';
import { ApiError, api, asUiError, useResource, write, type UiError } from './api';
import { useWorkspace } from './context';
import { ErrorState, Spinner } from './ui';
import { AnalystMarkdown } from './AnalystMarkdown';
import { AnalystNotebook } from './AnalystNotebook';

const exampleQuestions = [
  'What is my current cash balance?',
  'What percentage of this year’s expenses went to office supplies?',
  'Show monthly rent alongside total expenses in a chart.',
  'Which transactions currently need my review?',
];
const conversationIdSchema = z.uuid();
const isRunning = (conversation: AnalystConversation | null) =>
  conversation?.status === 'starting' || conversation?.status === 'running';
function rememberedConversation(key: string) {
  try {
    const value = sessionStorage.getItem(key);
    if (value && conversationIdSchema.safeParse(value).success) return value;
    if (value) sessionStorage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}
function rememberConversation(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* Private browsing still supports the current in-memory conversation. */
  }
}

export function AnalystChat({
  provider,
  active,
  initialText,
}: {
  provider: AnalystProvider;
  active: boolean;
  initialText?: string;
}) {
  const label = provider === 'querio' ? 'Querio' : 'Daybook';
  const endpoint = `/ai/${provider}`;
  const { meta } = useWorkspace();
  const storageKey = `daybook.${provider}.conversation.v1.${meta?.organization.id ?? 'workspace'}`;
  const availability = useResource<AnalystAvailability>(`${endpoint}/status`);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    rememberedConversation(storageKey),
  );
  const [conversation, setConversation] = useState<AnalystConversation | null>(null);
  const [text, setText] = useState(initialText ?? '');
  const [transportBusy, setTransportBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [error, setError] = useState<UiError>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'conversation' | 'notebook'>('conversation');
  const [pendingText, setPendingText] = useState('');
  const pendingRequest = useRef<{ conversationId: string; clientMessageId: string; text: string } | null>(
    null,
  );
  const chatScroll = useRef<HTMLDivElement>(null);
  const hasShownNotebook = useRef(false);
  const mounted = useRef(true);
  const activeId = useRef(conversationId);
  const resetAfterClose = useRef(false);
  const resetConversation = useCallback(() => {
    activeId.current = null;
    resetAfterClose.current = false;
    rememberConversation(storageKey, null);
    setConversationId(null);
    setConversation(null);
    setText('');
    setNotebookOpen(false);
    setMobileView('conversation');
    pendingRequest.current = null;
    hasShownNotebook.current = false;
  }, [storageKey]);
  const applyConversation = useCallback(
    (next: AnalystConversation) => {
      if (activeId.current !== next.id) return;
      if (resetAfterClose.current && next.status === 'closed') {
        resetConversation();
        return;
      }
      if (next.status === 'failed') resetAfterClose.current = false;
      setConversation((previous) => (!previous || next.updatedAt >= previous.updatedAt ? next : previous));
    },
    [resetConversation],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(advance: boolean) {
      try {
        const next = await api<AnalystConversation>(
          `${endpoint}/conversations/${conversationId}${advance ? '/refresh' : ''}`,
          { method: advance ? 'POST' : 'GET', ...(advance ? { body: '{}' } : {}), signal: controller.signal },
        );
        if (stopped) return;
        applyConversation(next);
        setError('');
        setLoading(false);
        if (isRunning(next)) timer = setTimeout(() => void poll(true), 2000);
      } catch (failure) {
        if (stopped) return;
        setLoading(false);
        if (failure instanceof ApiError && (failure.status === 404 || (!advance && failure.status === 400))) {
          rememberConversation(storageKey, null);
          activeId.current = null;
          setConversationId(null);
          setConversation(null);
          setError('This conversation is no longer available. You can start a new one.');
        } else setError(asUiError(failure));
      }
    }
    void poll(false);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [conversationId, conversation?.status, refreshKey, storageKey, applyConversation, endpoint]);
  useEffect(() => {
    const element = chatScroll.current;
    if (active && element) element.scrollTop = element.scrollHeight;
  }, [active, conversation?.messages.length, pendingText, error]);
  useEffect(() => {
    if (!hasShownNotebook.current && conversation?.notebook.cells.length) {
      hasShownNotebook.current = true;
      setNotebookOpen(true);
    }
  }, [conversation?.notebook.cells.length]);
  const running = isRunning(conversation),
    busy = running || transportBusy;
  const cannotContinue =
    conversation?.status === 'closed' ||
    (conversation?.status === 'failed' && conversation.error?.retryable === false);
  const cells = conversation?.notebook.cells ?? [];
  const sourceLabel = conversation?.sourceLabel || availability.data?.sourceLabel || 'Daybook live records';
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const question = text.trim();
    if (!question || busy || loading || !availability.data?.available || cannotContinue) return;
    let request = pendingRequest.current;
    if (
      !request ||
      request.text !== question ||
      (conversationId && request.conversationId !== conversationId)
    ) {
      request = {
        conversationId: conversationId || crypto.randomUUID(),
        clientMessageId: crypto.randomUUID(),
        text: question,
      };
      pendingRequest.current = request;
    }
    const currentRequest = request;
    setError('');
    setTransportBusy(true);
    setPendingText(question);
    setMobileView('conversation');
    try {
      if (!conversationId) {
        activeId.current = currentRequest.conversationId;
        rememberConversation(storageKey, currentRequest.conversationId);
        const created = await write<AnalystConversation>(`${endpoint}/conversations`, {
          clientConversationId: currentRequest.conversationId,
        });
        if (!mounted.current) return;
        applyConversation(created);
        setConversationId(created.id);
      }
      const result = await write<AnalystConversation>(
        `${endpoint}/conversations/${currentRequest.conversationId}/messages`,
        { text: question, clientMessageId: currentRequest.clientMessageId },
      );
      if (!mounted.current) return;
      applyConversation(result);
      setText('');
      pendingRequest.current = null;
      setRefreshKey((value) => value + 1);
    } catch (failure) {
      if (!mounted.current) return;
      // A lost POST response is not evidence that nothing was submitted. Reconcile the
      // saved conversation first; an explicit user retry retains the same message ID.
      try {
        const recovered = await api<AnalystConversation>(
          `${endpoint}/conversations/${currentRequest.conversationId}`,
        );
        if (!mounted.current) return;
        activeId.current = recovered.id;
        applyConversation(recovered);
        setConversationId(recovered.id);
        const accepted = recovered.messages.some((message) => message.id === currentRequest.clientMessageId);
        if (accepted) {
          setText('');
          pendingRequest.current = null;
          setRefreshKey((value) => value + 1);
        } else setError(asUiError(failure));
      } catch {
        if (mounted.current) setError(asUiError(failure));
      }
    } finally {
      if (mounted.current) {
        setTransportBusy(false);
        setPendingText('');
      }
    }
  }
  async function stop() {
    if (!conversationId || transportBusy) return;
    setTransportBusy(true);
    setError('');
    try {
      const result = await api<AnalystConversation>(`${endpoint}/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      if (!mounted.current) return;
      applyConversation(result);
      setRefreshKey((value) => value + 1);
    } catch (failure) {
      if (mounted.current) setError(asUiError(failure));
    } finally {
      if (mounted.current) setTransportBusy(false);
    }
  }
  async function newConversation() {
    if (busy) return;
    setTransportBusy(true);
    setError('');
    try {
      if (conversationId && conversation?.status !== 'closed') {
        resetAfterClose.current = true;
        const result = await api<AnalystConversation>(`${endpoint}/conversations/${conversationId}`, {
          method: 'DELETE',
        });
        if (!mounted.current) return;
        applyConversation(result);
        setRefreshKey((value) => value + 1);
      } else resetConversation();
    } catch (failure) {
      resetAfterClose.current = false;
      if (mounted.current) setError(asUiError(failure));
    } finally {
      if (mounted.current) setTransportBusy(false);
    }
  }
  return (
    <div className={`querio-workspace ${notebookOpen ? 'has-notebook' : ''} mobile-${mobileView}`}>
      <div className="querio-source-bar">
        <span>
          <Database size={13} /> {sourceLabel}
        </span>
        <div>
          {availability.data?.modelLabel && (
            <span className="querio-model">{availability.data.modelLabel}</span>
          )}
          <button
            className="text-button"
            type="button"
            disabled={!cells.length}
            aria-expanded={notebookOpen}
            onClick={() => {
              setNotebookOpen((value) => !value);
              setMobileView(notebookOpen ? 'conversation' : 'notebook');
            }}
          >
            <NotebookPen size={15} /> Notebook{cells.length ? ` (${cells.length})` : ''}
          </button>
        </div>
      </div>
      {notebookOpen && (
        <div className="querio-mobile-views" aria-label="Analysis view">
          <button
            type="button"
            aria-pressed={mobileView === 'conversation'}
            onClick={() => setMobileView('conversation')}
          >
            Conversation
          </button>
          <button
            type="button"
            aria-pressed={mobileView === 'notebook'}
            onClick={() => setMobileView('notebook')}
          >
            Notebook
          </button>
        </div>
      )}
      <div className="querio-content">
        <div className="querio-conversation">
          <div className="chat-scroll querio-chat-scroll" ref={chatScroll}>
            {loading && (
              <div className="chat-thinking" role="status">
                <Spinner /> Opening your conversation…
              </div>
            )}
            {!loading && !conversation?.messages.length && !pendingText && (
              <div className="chat-welcome querio-welcome">
                <span className="assistant-icon">
                  <MessageSquareText size={25} />
                </span>
                <h2>A question is a good place to start.</h2>
                <p>
                  {label} can explore your records and build tables, calculations and charts. Its supporting
                  work appears in the notebook.
                </p>
                <div className="chat-prompts">
                  {exampleQuestions.map((question) => (
                    <button type="button" key={question} onClick={() => setText(question)}>
                      <span>{question}</span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {availability.error && <ErrorState message={availability.error} retry={availability.reload} />}
            {availability.data && !availability.data.available && (
              <div className="info-note">
                {label} is not connected to this Daybook workspace yet. Transactions and reports remain
                available.
              </div>
            )}
            {conversation?.messages.map((message) => (
              <article
                className={`chat-message ${message.role}`}
                key={message.id}
                aria-label={message.role === 'user' ? 'Your question' : `${label} answer`}
              >
                {message.role === 'assistant' && (
                  <span className="chat-avatar">
                    <MessageSquareText size={15} />
                  </span>
                )}
                <div className="chat-message-content">
                  {message.role === 'assistant' ? (
                    <AnalystMarkdown text={message.content} />
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              </article>
            ))}
            {pendingText &&
              !conversation?.messages.some(
                (message) => message.id === pendingRequest.current?.clientMessageId,
              ) && (
                <div className="chat-message user">
                  <div className="chat-message-content">
                    <p>{pendingText}</p>
                  </div>
                </div>
              )}
            {busy && (
              <div className="chat-thinking" role="status">
                <Spinner />
                {conversation?.phase || 'Working through your question…'}
              </div>
            )}
            {conversation?.error && (
              <ErrorState
                message={{ message: conversation.error.message, requestId: conversation.error.requestId }}
              />
            )}
            {error && (
              <ErrorState
                message={error}
                retry={conversationId ? () => setRefreshKey((value) => value + 1) : undefined}
              />
            )}
            {cannotContinue && (
              <p className="analyst-output-note">
                This conversation has ended. Your answers and notebook remain here; start a new conversation
                to ask another question.
              </p>
            )}
          </div>
          <form className="chat-input-area querio-input-area" onSubmit={send}>
            <div className="querio-conversation-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => void newConversation()}
                disabled={busy || (!conversationId && !text)}
              >
                <Plus size={14} /> New conversation
              </button>
              {running && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void stop()}
                  disabled={transportBusy}
                >
                  <Square size={12} /> Stop
                </button>
              )}
            </div>
            <div className="chat-input">
              <textarea
                aria-label={`Ask ${label} a financial question`}
                placeholder="Ask about your books…"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={12000}
                rows={2}
                disabled={busy || cannotContinue}
                enterKeyHint="send"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                className="button primary icon-only"
                aria-label={`Send to ${label}`}
                type="submit"
                disabled={busy || loading || !text.trim() || !availability.data?.available || cannotContinue}
              >
                {busy ? <Spinner /> : <ArrowUp size={18} />}
              </button>
            </div>
            <p>
              <Database size={12} /> Read-only access to your Daybook records.
            </p>
          </form>
        </div>
        {notebookOpen && (
          <aside className="querio-notebook-panel" aria-label={`${label} notebook`}>
            <button
              className="icon-button querio-close-notebook"
              type="button"
              aria-label="Close notebook"
              onClick={() => {
                setNotebookOpen(false);
                setMobileView('conversation');
              }}
            >
              <X size={16} />
            </button>
            <AnalystNotebook
              cells={cells}
              updatedAt={conversation?.notebook.updatedAt ?? null}
              externalUrl={conversation?.notebook.externalUrl}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
