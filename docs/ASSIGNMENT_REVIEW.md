# Daybook: return to the assignment

Reviewed 2026-10-31 after the user reported a failed transaction entry and challenged the project's priorities. This is a code-and-evidence audit, not a claim that every feature is ready. The original brief asks for useful, accurate bookkeeping with AI assistance. A large architecture experiment does not substitute for that demonstration.

## What went wrong in our priorities

We compared nine ways to answer financial and document questions before completing a focused evaluation of an explicitly required feature: choosing bookkeeping categories and improving after user corrections. Jev was tested for document ranking and answer checking, not that categorization job. We also left gaps between the error shown in the browser and the logs needed to investigate it.

The research remains useful evidence for its stated questions. Its completion must not be described as completion of the product or proof of categorization quality. Core acceptance checks now take priority over additional retrieval, agents or model combinations.

## What is actually proven

The accounting engine has meaningful tests using real PostgreSQL. One worked example in [accounting.test.ts](../tests/accounting.test.ts) does this:

1. The owner puts $10,000 into the business.
2. The business earns and invoices $15,000, then receives that payment. Receiving it does not count the same revenue twice.
3. It pays $2,400 rent and buys $340 of supplies with the company card.
4. Tests independently expect $15,000 revenue, $2,740 expenses and $12,260 profit. Assets are $22,600; liabilities are $340; equity is $22,260. The accounting equation balances.

Other database tests deliberately attempt unbalanced postings, edits to posted history, cross-workspace references and simultaneous changes. They check that the database rejects them. These are core assignment evidence. They say nothing about whether an AI correctly understands a party payment.

The latest repaired source, `de67b49dfce110f560840d0b9106d628f30f5d52`, passed [CI 41213514203](https://github.com/rayidali/spiich_homework/actions/runs/41213514203): application/database/browser checks, native research checks and full Docker startup/persistence. The optional live-AI job was skipped. Selected hosted AI checks were performed separately and are recorded in the [repair receipt](evidence/entry-provider-recovery.json).

| Assignment requirement                               | Implemented and evidenced                                                                                                                  | Remaining proof or repair                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double entry and immutable history                   | Database balance constraints, exact decimal arithmetic, immutable postings and exact linked reversals; real SQL and concurrent-write tests | A balanced entry can still use the wrong category. Show both arithmetic rejection and meaningful account selection in the demo.                            |
| Chart of accounts                                    | Five types, default chart, groups/children, unique codes, create/edit/archive and delete-unused; database/browser tests                    | Novice usability is not established; the AI context has a documented 250-account prototype limit.                                                          |
| Multiple currencies                                  | Currency per account, stored rates and exact base amounts; EUR posting/report/reversal test                                                | Demonstrate other currency precision boundaries. Current-market revaluation is not implemented; the brief requires conversion, not a full treasury system. |
| Recurring transactions                               | Weekly/monthly/yearly templates, month-end/leap-day handling, unique draft occurrences and retry handling                                  | Observe the actual automatic scheduler producing a draft without pressing a manual button. Hosted cron firing has not been observed.                       |
| Trial balance, profit/loss, balance sheet and ledger | Posted-only SQL calculations, date filters, consistent database snapshots and paginated running balances; real arithmetic tests            | Put the worked example through the full interface in a repeatable demo.                                                                                    |
| Natural-language entry                               | Active-account context, structured proposal, money/account/balance validation and user confirmation                                        | Most automated AI tests mock model responses. Live clarification needs broader coverage; current prompt guidance is not a mathematical guarantee.          |
| Categorization                                       | Gemini selects accounts during entry creation using similar history and saved corrections                                                  | No Jev category selector, no controlled Gemini/Jev category comparison, no demonstrated improvement after corrections. No import workflow.                 |
| Anomaly detection                                    | Duplicate, unusual amount and unusual category rules; durable jobs and database tests                                                      | Reversed historical entries can still affect the category rule; existing alerts can stay stale after reversal. Define and test alert lifecycle.            |
| Financial chat                                       | Four authored read-only queries cover all four example questions in the brief; SQL and application code provide figures                    | Unsupported questions need honest clarification. Arbitrary financial planning is an extension, not evidence that the four required queries work.           |
| Frontend                                             | React dashboard, entries/review, transactions, reports, accounts, alerts, chat and schedules; browser workflows                            | AI browser responses are mocked. Fresh hosted browser, error recovery and novice usability checks remain separate.                                         |
| TypeScript, PostgreSQL, REST, Docker                 | Implemented end to end; checksummed migrations and restricted runtime database role; `docker compose up --build` verified in CI            | Preserve this working setup. No need for another framework to satisfy these requirements.                                                                  |
| Error handling and meaningful tests                  | Structured API errors, server-generated request IDs, provider failure classification, real database/browser/container tests                | Error references are dropped by the browser; provider logs cannot yet be reliably joined to requests. Correction-save failures can be hidden.              |

Authentication and deployment beyond Docker Compose are explicitly excluded by the assignment. Million-user capacity has not been demonstrated and should not be claimed.

## The latest entry repair: what changed and what it does not prove

The hosted provider failure was reproduced on a representative entry; a direct check with the same key and previous model returned Google HTTP 503. Gemini 3.5 Flash-Lite passed the bounded compatibility checks. The product now uses that model and distinguishes service, connection and timeout failures.

The first deployed repair passed a complete $340 supplies/card entry and a cash question matching the independent dashboard. A rent question without a payment account failed semantically: it guessed the bank account. That failed observation is preserved. The next prompt revision explicitly forbids using history or defaults to supply missing payment accounts.

The final hosted checks returned:

- “Bought office supplies for USD 340 using the Company credit card…” → correct balanced proposal, ready for review.
- “Paid USD 2400 rent…” → asks which account paid, with no entry created.
- “gave $800 to a friend to party” → asks which account paid and whether it was business spending or an owner withdrawal, with no entry created.

All 73 journal records and the complete dashboard response remained unchanged. These are selected API regressions, one observation per case. They are not a broad accuracy score, a full hosted browser test, or proof that personal/business/loan ambiguity is solved for every wording.

## Concrete gaps to fix before another broad experiment

### 1. Make a failed request traceable

A request ID is like a parcel-tracking number. The server already creates one, but the browser discards it and the provider log does not include it. The original request could not be traced from the available runtime logs; the later reproduction establishes its own failure, not a recovered history of the user's original request.

Preserve the ID in the browser error, add a small “Copy error reference” action, and carry the same ID through server, provider and database-tool work. Logs should say which stage failed, the safe error code and provider status. They should not routinely store prompts, financial descriptions, SQL parameters, raw exceptions, headers or keys. Separate a database failure from an invalid model response; a broad catch currently can confuse them. Verify a controlled error by finding its displayed reference in actual runtime logs.

Source: [API client](../web/src/api.ts), [error handling](../server/app.ts), [provider](../server/ai-provider.ts), [AI validation](../server/ai.ts). Some non-provider logs also need safe handling instead of raw exception messages.

### 2. Make “remember my correction” dependable

Example: the AI calls printer paper “Equipment.” The user changes it to “Office supplies.” Daybook saves that choice and can show it to the AI when a similar purchase arrives. This is stored example memory, not retraining the model.

The current path has these source-level findings:

- A failed correction save displays a warning, then immediately replaces it with the normal success notification.
- The feedback endpoint validates individual lines but not their combined balance, and accepts examples without a link to an actual proposal, saved entry or revision.
- Edited drafts immediately become “confirmed” examples. Changes to amount or memo also become category examples because the UI compares entire line objects.
- Previously reversed transactions can remain in the history examples. Conflicting or replaced corrections have no explicit lifecycle.

Repair the trust and persistence rules before measuring learning. Tie examples to validated reviewed entries/revisions; define explicit draft approval if drafts should teach the model. Prefer actual account-selection changes, avoid stale examples, and preserve a visible warning when saving the entry succeeds but remembering the choice fails.

Source: [Composer](../web/src/Composer.tsx), [feedback API](../server/app.ts), [retrieval](../server/ai.ts). These audit findings have not yet been fixed by the provider repair.

### 3. Compare Gemini and Jev on the job we need

Use shared validated transaction details and the same account list/history. Compare **Gemini category selection versus Jev category selection**, with a simple rules/memory reference. Keep extraction and retrieval the same so a score difference measures the selector. Preserve a separate test of today's whole-entry production flow.

A proposed small comparison has 24 scenario sequences: six development groups for designing the approach and 18 reserved groups for evaluation. Check each before corrections, after one correction and after three corrections: at most 144 selector calls across the two models. This is a proposed design, not an executed run or approved new spending policy. Estimate and cap its cost before running; no new purchase is needed merely to write the tests.

Include unseen shops, repeated purchases, a laptop from the same shop that sold printer paper, loan versus income, invoice payment versus new revenue, missing payment details, conflicting corrections and another workspace's examples. Current rent/party failures belong in development regressions, not a supposedly unseen test set. Both models receive the same confirmed history; neither model's unreviewed guesses become teaching examples.

Report separate scores for correct category, correct other account and debit/credit direction, complete journal correctness, appropriate clarification, improvement after corrections, harmful reuse of old choices, errors, latency and cost. Count every attempt. A system that asks questions forever must not win by avoiding answers. Model confidence is not measured accuracy; select any threshold on development cases and keep it fixed afterward.

Choose responsibilities from the results. Jev is a plausible selector among known categories; Gemini can handle conversation and extraction; code enforces accounting rules. None gets to post money movements automatically. If Jev adds no useful advantage, leave it out. The previous study cannot choose the winner for this different task.

### 4. Close the remaining core acceptance gaps

Fix reversed-history anomaly behavior, test correction persistence and workspace isolation with real records, observe recurring/analysis workers through the actual runtime, and perform a fresh browser walkthrough. Freeze a small repeatable demo: manual posting, rejected imbalance, reversal, currency conversion, scheduled draft, anomaly alert, ambiguous AI entry, corrected category remembered, and database-backed chat. Link each step to its actual result and distinguish mocked tests from live calls.

## Order for the next focused work block

1. Error reference and safe stage logging; demonstrate one failure traced from screen to runtime log.
2. Reliable correction recording and clear failure feedback; test save, retrieve, replacement, balance and workspace boundaries.
3. Live core entry regression cases plus the small category-selector comparison if time and a declared budget permit.
4. Reversed-history anomaly fix, automatic scheduler/worker demonstration, complete browser/Docker checks and submission walkthrough.

The acceptance rule is simple: every required feature needs an understandable user workflow and evidence that it behaves correctly, including failure cases. Research charts come after that proof.
