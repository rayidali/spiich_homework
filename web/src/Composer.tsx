import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, FilePenLine, Plus, Repeat2, MessageSquareText, Trash2 } from 'lucide-react';
import type { Entry, EntryInput, LineInput } from '../../shared/schema';
import { baseAmount, Decimal, sum } from '../../shared/money';
import type { ComposerState } from './context';
import { useWorkspace } from './context';
import { write } from './api';
import {
  defaultQuickAccount,
  quickEntryOptions,
  reconcileQuickSelection,
  validQuickSelection,
  type QuickKind,
} from './quick-entry';
import { BalanceCheck, ErrorState, Modal, Spinner, formatMoney } from './ui';

type Proposal = {
  action: 'READY' | 'CLARIFY';
  explanation: string;
  questions: string[];
  entry: EntryInput | null;
};
export function Composer({ state, onClose }: { state: ComposerState; onClose: () => void }) {
  const { meta, accounts, refresh, notify } = useWorkspace(),
    posting = accounts.filter((a) => !a.is_group && !a.archived),
    recurring = state.mode === 'recurring';
  const [mode, setMode] = useState(state.mode),
    [date, setDate] = useState(state.template?.anchor_date ?? state.entry?.date ?? meta!.today),
    [description, setDescription] = useState(state.template?.description ?? state.entry?.description ?? ''),
    [counterparty, setCounterparty] = useState(
      state.template?.counterparty ?? state.entry?.counterparty ?? '',
    ),
    [reference, setReference] = useState(state.entry?.reference ?? '');
  const [lines, setLines] = useState<LineInput[]>(
    state.template?.lines ??
      state.entry?.lines.map((l) => ({
        accountId: l.account_id,
        debit: l.debit,
        credit: l.credit,
        exchangeRate: l.exchange_rate,
        memo: l.memo,
      })) ?? [
        {
          accountId: posting.find((a) => a.code === '5010')?.id ?? '',
          debit: '0',
          credit: '0',
          exchangeRate: '1',
          memo: '',
        },
        {
          accountId: posting.find((a) => a.code === '1010')?.id ?? '',
          debit: '0',
          credit: '0',
          exchangeRate: '1',
          memo: '',
        },
      ],
  );
  const [quickKind, setQuickKind] = useState<QuickKind>('out'),
    [quickAmount, setQuickAmount] = useState(''),
    [quickAccount, setQuickAccount] = useState(defaultQuickAccount(accounts)),
    [quickCategory, setQuickCategory] = useState(''),
    [quickReview, setQuickReview] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [draftId, setDraftId] = useState(state.entry?.id),
    [draftRevision, setDraftRevision] = useState(state.entry?.revision),
    [key] = useState(() => crypto.randomUUID());
  const [aiText, setAiText] = useState(state.text ?? ''),
    [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]),
    [aiBusy, setAiBusy] = useState(false),
    [proposal, setProposal] = useState<Proposal | null>(null);
  const [scheduleName, setScheduleName] = useState(state.template?.name ?? ''),
    [frequency, setFrequency] = useState(state.template?.frequency ?? 'MONTHLY'),
    [endDate, setEndDate] = useState(state.template?.end_date ?? '');
  const quickOptions = quickEntryOptions(accounts, quickKind, quickAccount);
  const simple = mode === 'simple',
    aiReady = mode === 'ai' && Boolean(proposal?.entry),
    reviewing = (simple && quickReview) || aiReady;
  const reviewHeading = useRef<HTMLHeadingElement>(null),
    descriptionInput = useRef<HTMLInputElement>(null),
    wasReviewing = useRef(false);
  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus();
    else if (wasReviewing.current) descriptionInput.current?.focus();
    wasReviewing.current = reviewing;
  }, [reviewing]);
  let debitTotal = '0.00',
    creditTotal = '0.00',
    balanced = false,
    validAmounts = true;
  try {
    debitTotal = sum(lines.map((l) => baseAmount(l.debit || '0', l.exchangeRate || '1'))).toFixed(2);
    creditTotal = sum(lines.map((l) => baseAmount(l.credit || '0', l.exchangeRate || '1'))).toFixed(2);
    balanced = new Decimal(debitTotal).eq(creditTotal) && new Decimal(debitTotal).gt(0);
  } catch {
    validAmounts = false;
  }
  function changeLine(index: number, changes: Partial<LineInput>) {
    setLines((ls) => ls.map((line, i) => (i === index ? { ...line, ...changes } : line)));
    setError('');
  }
  function prepareSimple() {
    setError('');
    if (!description.trim() || !date) {
      setError('Add a description and date before reviewing.');
      return;
    }
    if (!/^\d{1,14}(\.\d{1,2})?$/.test(quickAmount) || !new Decimal(quickAmount).gt(0)) {
      setError('Enter an amount greater than zero, with no more than two decimal places.');
      return;
    }
    if (!validQuickSelection(accounts, quickKind, quickAccount, quickCategory)) {
      setError('Choose an available payment account and a different eligible category or destination.');
      return;
    }
    const amount = new Decimal(quickAmount).toFixed(2);
    const debit = quickKind === 'in' ? quickAccount : quickCategory;
    const credit = quickKind === 'in' ? quickCategory : quickAccount;
    setLines([
      { accountId: debit, debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: credit, debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ]);
    setProposal(null);
    setQuickReview(true);
  }
  async function suggest() {
    if (!aiText.trim() || aiBusy || !meta?.ai.available) return;
    const conversation = [...messages, { role: 'user' as const, content: aiText.trim() }].slice(-10);
    setMessages(conversation);
    setAiText('');
    setAiBusy(true);
    setError('');
    try {
      const result = await write<Proposal>('/ai/entry', { messages: conversation, date });
      setProposal(result);
      setMessages([
        ...conversation,
        {
          role: 'assistant',
          content: result.action === 'CLARIFY' ? result.questions.join('\n') : result.explanation,
        },
      ]);
      if (result.entry) {
        setDescription(result.entry.description);
        setCounterparty(result.entry.counterparty);
        setReference(result.entry.reference);
        setDate(result.entry.date);
        setLines(result.entry.lines);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }
  async function save(post: boolean) {
    setSaving(true);
    setError('');
    const payload: EntryInput = {
      date,
      description,
      counterparty,
      reference,
      source: proposal?.entry ? 'AI' : 'MANUAL',
      lines: lines.map((l) => ({ ...l, debit: l.debit || '0', credit: l.credit || '0' })),
    };
    try {
      if (recurring) {
        await write(
          state.template ? `/recurring/${state.template.id}` : '/recurring',
          {
            name: scheduleName,
            description,
            counterparty,
            frequency,
            anchorDate: date,
            endDate: endDate || null,
            lines: payload.lines,
            expectedRevision: state.template?.revision,
          },
          state.template ? 'PUT' : 'POST',
          state.template ? undefined : key,
        );
        notify(
          state.template
            ? 'Template updated for future occurrences. Existing drafts are unchanged.'
            : 'Recurring template created. Due entries will arrive as drafts.',
        );
      } else {
        const result = await write<Entry>(
          draftId ? `/entries/${draftId}` : '/entries',
          { ...payload, expectedRevision: draftRevision },
          draftId ? 'PUT' : 'POST',
          draftId ? undefined : key,
        );
        setDraftId(result.id);
        setDraftRevision(result.revision);
        if (post)
          await write(`/entries/${result.id}/post`, {
            exchangeRatesConfirmed: true,
            expectedRevision: result.revision,
          });
        if (proposal?.entry && JSON.stringify(proposal.entry.lines) !== JSON.stringify(payload.lines)) {
          try {
            await write('/ai/feedback', {
              description: payload.description,
              counterparty,
              proposedLines: proposal.entry.lines,
              correctedLines: payload.lines,
            });
          } catch {
            notify('Entry saved. The categorization preference could not be saved.');
          }
        }
        notify(
          post
            ? 'Entry posted. Your books and reports are updated.'
            : 'Draft saved. Review and post it when you’re ready.',
        );
      }
      refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={
        recurring
          ? state.template
            ? 'Edit recurring transaction'
            : 'New recurring transaction'
          : state.entry
            ? 'Edit journal draft'
            : reviewing
              ? 'Review transaction'
              : 'Record transaction'
      }
      onClose={() => {
        if (!saving) onClose();
      }}
      wide
    >
      <div className="modal-body composer-body">
        <fieldset className="composer-fields" disabled={saving || aiBusy}>
          {!recurring && !state.entry && (
            <div className="tabs composer-tabs" aria-label="How to record">
              <button
                disabled={saving || aiBusy}
                className={simple ? 'selected' : ''}
                onClick={() => {
                  const selection = reconcileQuickSelection(accounts, quickKind, quickAccount, quickCategory);
                  setQuickAccount(selection.payment);
                  setQuickCategory(selection.category);
                  setMode('simple');
                  setQuickReview(false);
                  setError('');
                }}
                aria-pressed={simple}
              >
                Short form
              </button>
              <button
                disabled={saving || aiBusy}
                className={mode === 'ai' ? 'selected' : ''}
                onClick={() => {
                  setMode('ai');
                  setProposal(null);
                  setMessages([]);
                  setError('');
                }}
                aria-pressed={mode === 'ai'}
              >
                <MessageSquareText size={16} />
                Describe it
              </button>
              <button
                disabled={saving || aiBusy}
                className={mode === 'manual' ? 'selected' : ''}
                onClick={() => {
                  setMode('manual');
                  setError('');
                }}
                aria-pressed={mode === 'manual'}
              >
                <FilePenLine size={16} />
                Journal entry
              </button>
            </div>
          )}
          {mode === 'ai' && !aiReady && (
            <section className="ai-composer">
              <div className="ai-composer-title">
                <span className="assistant-icon small">
                  <MessageSquareText size={18} />
                </span>
                <div>
                  <h3>Tell us what happened</h3>
                  <p>We’ll prepare the entry. You review and confirm it.</p>
                </div>
              </div>
              {!meta?.ai.available ? (
                <div className="info-note">
                  The assistant isn’t connected yet. Choose Short form or Journal entry to record a
                  transaction.
                </div>
              ) : (
                <>
                  <div className="ai-entry-conversation">
                    {messages.map((m, i) => (
                      <div key={i} className={`ai-entry-message ${m.role}`}>
                        {m.role === 'assistant' && <MessageSquareText size={14} />}
                        <span>{m.content}</span>
                      </div>
                    ))}
                  </div>
                  <div className="ai-entry-input">
                    <textarea
                      data-autofocus
                      aria-label="Describe your transaction"
                      value={aiText}
                      onChange={(e) => setAiText(e.target.value)}
                      placeholder="e.g. “Bought $340 of office supplies with the company credit card”"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void suggest();
                        }
                      }}
                    />
                    <button
                      className="button primary icon-only"
                      disabled={aiBusy || !aiText.trim()}
                      onClick={suggest}
                      aria-label="Prepare transaction"
                    >
                      {aiBusy ? <Spinner /> : <ArrowUp size={18} />}
                    </button>
                  </div>
                  {!messages.length && (
                    <div className="example-prompts">
                      {[
                        'Paid $2,400 rent from the operating bank',
                        'Received $15,000 from Acme for invoice #1042',
                      ].map((text) => (
                        <button key={text} onClick={() => setAiText(text)}>
                          {text}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {recurring && (
            <>
              <div className="info-note">
                <Repeat2 size={18} />
                {state.template
                  ? 'Changes apply to future occurrences. Pause this schedule and create a new one to change its frequency or calendar anchor.'
                  : 'Templates generate drafts automatically. Every occurrence needs your review before it reaches the books.'}
              </div>
              <div className="form-grid">
                <label className="field">
                  Template name
                  <input
                    data-autofocus
                    value={scheduleName}
                    onChange={(e) => setScheduleName(e.target.value)}
                    placeholder="e.g. Monthly studio rent"
                  />
                </label>
                <label className="field">
                  Repeats
                  <select
                    disabled={Boolean(state.template)}
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as typeof frequency)}
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {proposal?.entry && (
            <div className="proposal-ready">
              <Check size={16} />
              Suggested entry ready. Check the accounts and amounts before posting.
            </div>
          )}
          {((simple && !quickReview) || mode === 'manual' || recurring) && (
            <>
              <div className="form-grid description-grid">
                <label className="field span-2">
                  Description
                  <input
                    ref={descriptionInput}
                    data-autofocus={mode === 'manual' || simple ? true : undefined}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What happened?"
                    maxLength={500}
                  />
                </label>
                <label className="field">
                  {recurring
                    ? state.template
                      ? 'Original calendar anchor'
                      : 'First occurrence'
                    : 'Transaction date'}
                  <input
                    type="date"
                    disabled={Boolean(state.template)}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
              {simple ? (
                <details className="optional-fields">
                  <summary>
                    Add a name or reference <span>optional</span>
                  </summary>{' '}
                  <div className="form-grid">
                    <label className="field">
                      Counterparty <span className="optional">optional</span>
                      <input
                        value={counterparty}
                        onChange={(e) => setCounterparty(e.target.value)}
                        placeholder="Customer, vendor or person"
                        maxLength={100}
                      />
                    </label>
                    {recurring ? (
                      <label className="field">
                        End date <span className="optional">optional</span>
                        <input
                          type="date"
                          min={date}
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </label>
                    ) : (
                      <label className="field">
                        Reference <span className="optional">optional</span>
                        <input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="e.g. INV-1042"
                          maxLength={100}
                        />
                      </label>
                    )}
                  </div>
                </details>
              ) : (
                <>
                  {' '}
                  <div className="form-grid">
                    <label className="field">
                      Counterparty <span className="optional">optional</span>
                      <input
                        value={counterparty}
                        onChange={(e) => setCounterparty(e.target.value)}
                        placeholder="Customer, vendor or person"
                        maxLength={100}
                      />
                    </label>
                    {recurring ? (
                      <label className="field">
                        End date <span className="optional">optional</span>
                        <input
                          type="date"
                          min={date}
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </label>
                    ) : (
                      <label className="field">
                        Reference <span className="optional">optional</span>
                        <input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="e.g. INV-1042"
                          maxLength={100}
                        />
                      </label>
                    )}
                  </div>
                </>
              )}
              {simple && (
                <section className="simple-entry" aria-label="Transaction details">
                  <div className="choice-row" aria-label="Money direction">
                    {(
                      [
                        ['out', 'Money out'],
                        ['in', 'Money in'],
                        ['transfer', 'Transfer'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        className={quickKind === value ? 'selected' : ''}
                        aria-pressed={quickKind === value}
                        onClick={() => {
                          const selection = reconcileQuickSelection(accounts, value, quickAccount, '');
                          setQuickKind(value);
                          setQuickCategory(selection.category);
                          setQuickAccount(selection.payment);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="field amount-field">
                    Amount in USD
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={quickAmount}
                      onChange={(e) => setQuickAmount(e.target.value)}
                    />
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      {quickKind === 'in'
                        ? 'Received into'
                        : quickKind === 'transfer'
                          ? 'From account'
                          : 'Paid from / charged to'}
                      <select
                        value={quickAccount}
                        onChange={(e) => {
                          const payment = e.target.value;
                          setQuickAccount(payment);
                          if (
                            !quickEntryOptions(accounts, quickKind, payment).category.some(
                              (a) => a.id === quickCategory,
                            )
                          )
                            setQuickCategory('');
                        }}
                      >
                        <option value="">Choose account</option>
                        {quickOptions.payment.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      {quickKind === 'transfer' ? 'To account' : 'What was it for?'}
                      <select value={quickCategory} onChange={(e) => setQuickCategory(e.target.value)}>
                        <option value="">
                          {quickKind === 'transfer' ? 'Choose destination' : 'Choose category or account'}
                        </option>
                        {quickOptions.category.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {quickKind === 'in' && (
                    <p className="field-help">
                      For payment of an invoice already in your books, choose Accounts receivable. A new sale
                      belongs in revenue.
                    </p>
                  )}
                  <p className="field-help">
                    For other currencies or more than two accounts, choose Journal entry.
                  </p>
                </section>
              )}
            </>
          )}
          {mode === 'ai' && !aiReady && (
            <label className="field ai-date">
              Transaction date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {reviewing && (
            <section className="entry-review" aria-label="Review before posting">
              <div className="review-description">
                <h3 ref={reviewHeading} tabIndex={-1}>
                  {description}
                </h3>
                <p>
                  {date}
                  {counterparty ? ` · ${counterparty}` : ''}
                  {reference ? ` · ${reference}` : ''}
                </p>
              </div>
              <p className="field-help">Check both sides of the transaction. Nothing has been posted yet.</p>
              {aiReady && <p className="field-help">{proposal?.explanation}</p>}
              <div className="review-lines">
                {lines.map((line, i) => {
                  const account = accounts.find((a) => a.id === line.accountId);
                  const debit = new Decimal(line.debit || '0');
                  const credit = new Decimal(line.credit || '0');
                  const normalChange = ['LIABILITY', 'EQUITY', 'REVENUE'].includes(account?.type ?? '')
                    ? credit.minus(debit)
                    : debit.minus(credit);
                  return (
                    <div className="review-line" key={i}>
                      <div>
                        <strong>{account?.name ?? 'Unknown account'}</strong>
                        <span>
                          {normalChange.gte(0) ? 'Increases' : 'Decreases'} by{' '}
                          {formatMoney(normalChange.abs().toString(), account?.currency ?? 'USD')}
                        </span>
                      </div>
                      <div className="review-line-money">
                        <strong>
                          {formatMoney(
                            debit.gt(0) ? debit.toString() : credit.toString(),
                            account?.currency ?? 'USD',
                          )}
                        </strong>
                        <span>
                          {debit.gt(0) ? 'Debit' : 'Credit'}
                          {account?.currency !== 'USD'
                            ? ` · 1 ${account?.currency} = ${line.exchangeRate} USD`
                            : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="review-base-total">
                <span>Total in report currency</span>
                <strong>{formatMoney(debitTotal)} USD</strong>
              </div>
              <BalanceCheck
                balanced={balanced && validAmounts}
                difference={validAmounts ? new Decimal(debitTotal).minus(creditTotal).abs().toString() : '0'}
              />
              <button
                className="text-button"
                disabled={saving || aiBusy}
                onClick={() => (simple ? setQuickReview(false) : setMode('manual'))}
              >
                {simple ? 'Edit details' : 'Edit journal lines'}
              </button>
            </section>
          )}
          {(mode === 'manual' || recurring) && (
            <>
              <div className="form-section-heading">
                <h3>Journal lines</h3>
                <span>Debits and credits balance in USD</span>
              </div>
              <div className="composer-lines">
                <div className="line-labels">
                  <span>Account</span>
                  <span className="amount">Debit</span>
                  <span className="amount">Credit</span>
                  <span />
                </div>
                {lines.map((line, i) => {
                  const account = accounts.find((a) => a.id === line.accountId);
                  return (
                    <div className="composer-line-group" key={i}>
                      <div className="composer-line">
                        <select
                          aria-label={`Line ${i + 1} account`}
                          value={line.accountId}
                          onChange={(e) => {
                            const next = accounts.find((a) => a.id === e.target.value);
                            changeLine(i, {
                              accountId: e.target.value,
                              exchangeRate: next?.currency === 'USD' ? '1' : '',
                            });
                          }}
                        >
                          <option value="" disabled>
                            Choose account
                          </option>
                          {posting.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} · {a.name} {a.currency !== 'USD' ? `(${a.currency})` : ''}
                            </option>
                          ))}
                        </select>
                        <div className="money-input" data-label="Debit">
                          <span>{account?.currency ?? 'USD'}</span>
                          <input
                            aria-label={`Line ${i + 1} debit`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={line.debit === '0' ? '' : line.debit}
                            onChange={(e) =>
                              changeLine(i, {
                                debit: e.target.value,
                                ...(e.target.value && e.target.value !== '0' ? { credit: '0' } : {}),
                              })
                            }
                          />
                        </div>
                        <div className="money-input" data-label="Credit">
                          <span>{account?.currency ?? 'USD'}</span>
                          <input
                            aria-label={`Line ${i + 1} credit`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={line.credit === '0' ? '' : line.credit}
                            onChange={(e) =>
                              changeLine(i, {
                                credit: e.target.value,
                                ...(e.target.value && e.target.value !== '0' ? { debit: '0' } : {}),
                              })
                            }
                          />
                        </div>
                        <button
                          className="icon-button remove-line"
                          disabled={lines.length <= 2}
                          aria-label={`Remove line ${i + 1}`}
                          onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {account?.currency !== 'USD' && account && (
                        <label className="rate-field">
                          1 {account.currency} ={' '}
                          <input
                            aria-label={`Line ${i + 1} exchange rate`}
                            inputMode="decimal"
                            placeholder="Rate"
                            value={line.exchangeRate}
                            onChange={(e) => changeLine(i, { exchangeRate: e.target.value })}
                          />{' '}
                          USD <span>Use the transaction’s recorded exchange rate</span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                className="text-button add-line"
                disabled={lines.length >= 100}
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { accountId: '', debit: '0', credit: '0', exchangeRate: '1', memo: '' },
                  ])
                }
              >
                <Plus size={15} />
                Add a line
              </button>
              <div className="composer-totals">
                <span>Total in USD</span>
                <strong>{formatMoney(debitTotal)}</strong>
                <strong>{formatMoney(creditTotal)}</strong>
                <span />
              </div>
              <BalanceCheck
                balanced={balanced && validAmounts}
                difference={validAmounts ? new Decimal(debitTotal).minus(creditTotal).abs().toString() : '0'}
              />
            </>
          )}
          {error && <ErrorState message={error} />}
        </fieldset>
      </div>
      <div className="modal-footer">
        <span className="muted">
          {recurring
            ? 'Rates in foreign templates must be reviewed each time.'
            : 'Posting makes this entry part of your permanent books.'}
        </span>
        <div>
          <button className="button secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {!recurring && (reviewing || mode === 'manual') && (
            <button className="button secondary" disabled={saving || aiBusy} onClick={() => save(false)}>
              Save draft
            </button>
          )}
          {simple && !quickReview ? (
            <button className="button primary" disabled={saving} onClick={prepareSimple}>
              Review entry <Check size={16} />
            </button>
          ) : reviewing || mode === 'manual' || recurring ? (
            <button
              className="button primary"
              disabled={
                saving || aiBusy || !balanced || !description.trim() || (recurring && !scheduleName.trim())
              }
              onClick={() => save(true)}
            >
              {saving ? <Spinner /> : recurring ? <Repeat2 size={16} /> : <Check size={16} />}{' '}
              {recurring
                ? state.template
                  ? 'Save template'
                  : 'Create template'
                : reviewing
                  ? 'Confirm and post'
                  : 'Post entry'}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
