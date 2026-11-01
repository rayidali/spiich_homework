import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUp,
  ArrowUpRight,
  Database,
  MessageSquareText,
  Wallet,
  Receipt,
  TrendingUp,
  Search,
} from 'lucide-react';
import type { InsightEvidence } from '../../server/ai';
import { conversationBudgetError, MAX_MESSAGE_CHARACTERS } from '../../shared/conversation';
import { asUiError, type UiError, write } from './api';
import { useWorkspace } from './context';
import { ErrorState, Modal, Spinner } from './ui';
type ConversationContext = {
  kind: 'clarification' | 'explanation' | 'limitation';
  grounding: 'general_knowledge' | 'user_context';
  verifiedFinancialData: false;
};
type Message = {
  role: 'user' | 'assistant';
  content: string;
  evidence?: InsightEvidence[];
  conversation?: ConversationContext;
};
const conversationLabels = {
  clarification: 'Follow-up question',
  explanation: 'General explanation',
  limitation: 'Information needed',
} satisfies Record<ConversationContext['kind'], string>;
const prompts = [
  { icon: Receipt, text: 'What were my top 5 expenses last month?' },
  { icon: TrendingUp, text: 'How does this quarter’s revenue compare to last quarter?' },
  { icon: Search, text: 'Show me all transactions with Acme Corp' },
  { icon: Wallet, text: 'What’s my current cash position?' },
];
export function Assistant({ initialText, onClose }: { initialText?: string; onClose: () => void }) {
  const { meta } = useWorkspace(),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(initialText ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<UiError>(''),
    bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [messages, busy, error]);
  async function send() {
    if (!text.trim() || busy || !meta?.ai.available) return;
    const next: Message[] = [...messages, { role: 'user', content: text.trim() }];
    const conversation = next.map(({ role, content }) => ({ role, content }));
    const budgetError = conversationBudgetError(conversation);
    if (budgetError) {
      setError(budgetError);
      return;
    }
    setError('');
    setMessages(next);
    setText('');
    setBusy(true);
    try {
      const result = await write<{
        answer: string;
        evidence: InsightEvidence[];
        conversation?: ConversationContext;
      }>('/ai/chat', {
        messages: conversation,
      });
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: result.answer,
          evidence: result.evidence,
          conversation: result.conversation,
        },
      ]);
    } catch (e) {
      setError(asUiError(e));
      setText(next.at(-1)!.content);
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Financial assistant" onClose={onClose} drawer>
      <div className="assistant-status">
        <span className={`online-dot ${meta?.ai.available ? '' : 'inactive'}`} />
        <span>{meta?.ai.available ? 'Ready to help with your finances' : 'Assistant not connected'}</span>
        <span>Base currency: {meta?.organization.base_currency ?? 'USD'}</span>
      </div>
      <div className="chat-scroll">
        {!messages.length && (
          <div className="chat-welcome">
            <span className="assistant-icon">
              <MessageSquareText size={27} />
            </span>
            <h2>Ask about your business finances</h2>
            <p>Explore your records, understand accounting, or work through a financial decision.</p>
            <div className="chat-prompts">
              {prompts.map((p) => (
                <button key={p.text} onClick={() => setText(p.text)}>
                  <p.icon size={17} />
                  <span>{p.text}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
            {!meta?.ai.available && (
              <div className="info-note">
                The assistant needs an AI connection before it can answer questions. Your saved entries and
                reports are available in the workspace.
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div className={`chat-message ${m.role}`} key={i}>
            {m.role === 'assistant' && (
              <span className="chat-avatar">
                <MessageSquareText size={15} />
              </span>
            )}
            <div className="chat-message-content">
              {m.role === 'assistant' && m.conversation?.verifiedFinancialData === false && (
                <div className="muted" data-conversation-kind={m.conversation.kind}>
                  {conversationLabels[m.conversation.kind]}
                </div>
              )}
              <p>{m.content}</p>
              {m.evidence?.map((e, index) => (
                <div className="evidence-card" key={index}>
                  <span className="evidence-label">
                    <Database size={12} />
                    {e.source === 'draft'
                      ? 'DRAFTS · NOT POSTED'
                      : e.source === 'scenario'
                        ? 'HYPOTHETICAL CALCULATION'
                        : 'FROM YOUR BOOKS'}
                  </span>
                  <h4>{e.title}</h4>
                  <span className="muted">{e.period}</span>
                  {e.scope && (
                    <details className="evidence-scope">
                      <summary>What this includes</summary>
                      <p>{e.scope}</p>
                    </details>
                  )}
                  <div className="evidence-rows">
                    {e.rows.map((r, j) => (
                      <div key={j}>
                        {r.href ? (
                          <Link to={r.href} onClick={onClose}>
                            {r.label}
                          </Link>
                        ) : (
                          <span>{r.label}</span>
                        )}
                        <strong>{r.value}</strong>
                      </div>
                    ))}
                  </div>
                  <Link className="text-button" to={e.href} onClick={onClose}>
                    {e.href === '/reports' || e.href.startsWith('/reports?')
                      ? 'Open reports'
                      : e.href === '/transactions'
                        ? 'Open transactions'
                        : 'View supporting records'}
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && (
          <div className="chat-thinking">
            <Spinner />
            Working on your question…
          </div>
        )}
        {error && <ErrorState message={error} />}
        <div ref={bottom} />
      </div>
      <div className="chat-input-area">
        <button
          type="button"
          className="text-button"
          disabled={busy || !messages.length}
          onClick={() => {
            setMessages([]);
            setError('');
          }}
        >
          New conversation
        </button>
        <div className="chat-input">
          <textarea
            aria-label="Ask a financial question"
            placeholder="Ask about your finances…"
            value={text}
            disabled={busy}
            maxLength={MAX_MESSAGE_CHARACTERS}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            aria-label="Send question"
            className="button primary icon-only"
            onClick={send}
            disabled={busy || !text.trim() || !meta?.ai.available}
          >
            {busy ? <Spinner /> : <ArrowUp size={18} />}
          </button>
        </div>
        <p>
          <Database size={12} />
          Financial figures include their records or assumptions.
        </p>
      </div>
    </Modal>
  );
}
