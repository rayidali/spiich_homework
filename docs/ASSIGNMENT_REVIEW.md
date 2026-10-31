# Daybook: return to the assignment

## Broader financial chat — 2026-10-31

The paired product comparison is complete: **composable queries18/20 versus authored tools6/20**, with7/7 versus6/7 on the predefined common-capability subset. Actual PostgreSQL replay checked both the chosen filters and exact results; the books stayed unchanged. Internal-AI review found no wrong displayed financial answer or hard-boundary violation in this small set. An account-group comparator false negative is documented separately; the primary score remains unchanged. [Evidence and CI](evidence/chat-query-runs/holdout-v1/ci.json), [two-page explanation](reports/chat-query-comparison.pdf), [details](CHAT_RELIABILITY.md).

The later candidate `7be9224` passed [full CI41237787408](https://github.com/rayidali/spiich_homework/actions/runs/41237787408), but its hosted acceptance **stopped after seven of eight requests**. Six answers passed review; the hiring calculation selected all assets where cash was required. Noncash balances happened to net to zero, so the displayed amount matched by coincidence; the source was still wrong. The stable alias was rolled back to the verified scoped-chat release `e7a514e`. The cohort is terminally closed at $0.0253555, with all 74 journals and 22 accounts unchanged and all seven requests correlated to the exact candidate runtime. [Incident and rollback](evidence/chat-broad-blocked-release.json). The later cash-source repair has separate CI and blocked hosted evidence below.

**Latest staged release remains blocked.** The cash-source repair `7b52a9b426b7fa27f3a70ab42e38a01baa952431` passed [full CI41239769459](https://github.com/rayidali/spiich_homework/actions/runs/41239769459) and reached READY/STAGED as `dpl_4J29AhdcZxkzT7TAm6oCDt5aA2nd`, without promotion. The first hiring check passed with verified cash-source lineage. The second returned HTTP502 / `AI_INVALID_RESPONSE` at `model_schema`; no financial answer or selected-query diagnostic was produced, and the rejected field is unknown. This new cohort is terminally closed after two of six requests: $0.0088424 known-use estimate plus a retained $0.02 unknown-cost reservation. All 74 journals and 22 accounts stayed unchanged; both requests matched exact-source runtime logs. The stable alias still serves `e7a514e`. [Staged incident receipt](evidence/chat-cash-blocked-release.json). A separate bounded schema-repair and diagnostic improvement is in progress, not yet verified.

Reviewed 2026-10-31 after the user reported a failed transaction entry and challenged the project's priorities. This is a code-and-evidence audit, not a claim that every feature is ready. The original brief asks for useful, accurate bookkeeping with AI assistance. A large architecture experiment does not substitute for that demonstration.

**Earlier category follow-up:** source `b7bf5fe024f6fca33fa5a93ef5e6188e96455bae` passed [full CI 41226562746](https://github.com/rayidali/spiich_homework/actions/runs/41226562746), including all 18 browser workflows, real PostgreSQL, native research and Compose. Error-reference correlation, trusted atomic correction memory/forget, reversal-aware alerts, automatic recurring drafts and worker processing now have engineering evidence. The [focused category comparison](evidence/category-runs/completed-v3/holdout/report.md) completed with a [71-check audit](evidence/category-runs/completed-v3/independent-audit.json): Gemini 33/33 versus Jev 31/33 on held-out category plus taught preference. Both models were semantically correct on all 33; Jev missed two taught Printing preferences and did not pass the predefined allocation screen. [Decision](evidence/category-runs/completed-v3/release-decision.json).

The earlier [core release](evidence/core-repair-release.json) is deployed. The exact-source category release is READY and passed 11 selected hosted API checks with unchanged journal history. [Release evidence](evidence/category-product-release.json). The original 40-case live whole-entry evaluation, hosted automatic cron observation and real-device usability remain separate gaps. Read [PRODUCT_PLAN.md](PRODUCT_PLAN.md) for the current completion work; the later sections below preserve the initial audit findings and the reasoning that led to these repairs.

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

At the initial review, repaired source `de67b49dfce110f560840d0b9106d628f30f5d52` had passed [CI 41213514203](https://github.com/rayidali/spiich_homework/actions/runs/41213514203): application/database/browser checks, native research checks and full Docker startup/persistence. The optional live-AI job was skipped. Selected hosted AI checks were performed separately and are recorded in the [repair receipt](evidence/entry-provider-recovery.json).

| Assignment requirement                               | Implemented and evidenced                                                                                                                  | Remaining proof or repair                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double entry and immutable history                   | Database balance constraints, exact decimal arithmetic, immutable postings and exact linked reversals; real SQL and concurrent-write tests | A balanced entry can still use the wrong category. Show both arithmetic rejection and meaningful account selection in the demo.                                                                                |
| Chart of accounts                                    | Five types, default chart, groups/children, unique codes, create/edit/archive and delete-unused; database/browser tests                    | Novice usability is not established; the AI context has a documented 250-account prototype limit.                                                                                                              |
| Multiple currencies                                  | Currency per account, stored rates and exact base amounts; EUR posting/report/reversal test                                                | Currency precision/report/reversal boundaries now pass current real-DB/browser CI. Current-market revaluation remains outside this conversion feature.                                                         |
| Recurring transactions                               | Weekly/monthly/yearly templates, month-end/leap-day handling, unique draft occurrences and retry handling                                  | Actual Compose scheduler-generated monthly draft and worker processing passed CI. Hosted daily cron firing remains unobserved; weekly/yearly calendar boundaries have database tests.                          |
| Trial balance, profit/loss, balance sheet and ledger | Posted-only SQL calculations, date filters, consistent database snapshots and paginated running balances; real arithmetic tests            | Put the worked example through the full interface in a repeatable demo.                                                                                                                                        |
| Natural-language entry                               | Active-account context, structured proposal, money/account/balance validation and user confirmation                                        | Most automated AI tests mock model responses. Live clarification needs broader coverage; current prompt guidance is not a mathematical guarantee.                                                              |
| Categorization                                       | Whole-entry suggestions plus scoped Gemini/Jev/reference category selectors; reviewed posting corrections become eligible context          | Focused live comparison completed: Gemini 33/33 vs Jev 31/33 category+preference; context-based gains measured, retrieval quality not isolated. Selected hosted API acceptance passed. CSV import is optional. |
| Anomaly detection                                    | Duplicate, unusual amount and unusual category rules; durable jobs and database tests                                                      | Migration 006/worker now exclude reversed history and preserve resolved-alert evidence. Real history/lease/reversal tests and automatic Compose lifecycle passed; no fraud-accuracy claim.                     |
| Financial chat                                       | Four authored read-only queries cover all four example questions in the brief; SQL and application code provide figures                    | Unsupported questions need honest clarification. Arbitrary financial planning is an extension, not evidence that the four required queries work.                                                               |
| Frontend                                             | React dashboard, entries/review, transactions, reports, accounts, alerts, chat and schedules; browser workflows                            | AI browser responses are mocked. Fresh hosted browser, error recovery and novice usability checks remain separate.                                                                                             |
| TypeScript, PostgreSQL, REST, Docker                 | Implemented end to end; checksummed migrations and restricted runtime database role; `docker compose up --build` verified in CI            | Preserve this working setup. No need for another framework to satisfy these requirements.                                                                                                                      |
| Error handling and meaningful tests                  | Structured API errors, server-generated request IDs, provider failure classification, real database/browser/container tests                | Browser preserves/copies references; allowlisted request/provider/tool diagnostics correlate by reference. Reviewed posting and correction memory commit atomically; hosted correlation was observed.          |

Document upload, bank feeds and CSV import are not required by the original brief; creation with category suggestions satisfies the stated import-or-create behavior. Authentication and deployment beyond Docker Compose are explicitly excluded by the assignment. Million-user capacity has not been demonstrated and should not be claimed.

## Historical provider-only entry repair: what changed and what it proved

The hosted provider failure was reproduced on a representative entry; a direct check with the same key and previous model returned Google HTTP 503. Gemini 3.5 Flash-Lite passed the bounded compatibility checks. The product now uses that model and distinguishes service, connection and timeout failures.

The first deployed repair passed a complete $340 supplies/card entry and a cash question matching the independent dashboard. A rent question without a payment account failed semantically: it guessed the bank account. That failed observation is preserved. The next prompt revision explicitly forbids using history or defaults to supply missing payment accounts.

The final hosted checks returned:

- “Bought office supplies for USD 340 using the Company credit card…” → correct balanced proposal, ready for review.
- “Paid USD 2400 rent…” → asks which account paid, with no entry created.
- “gave $800 to a friend to party” → asks which account paid and whether it was business spending or an owner withdrawal, with no entry created.

All 73 journal records and the complete dashboard response remained unchanged. These are selected API regressions, one observation per case. They are not a broad accuracy score, a full hosted browser test, or proof that personal/business/loan ambiguity is solved for every wording.

## Historical audit findings that drove the repair

The findings below describe the pre-repair source. Current status is in the matrix above; they are preserved to explain the decisions, not to claim the same defects remain. The controlled category experiment has since completed, with cumulative 119 calls/$0.036753586 and both earlier adapter failures retained. Its ledger is closed.

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

## Original repair order, now largely completed

1. Error reference and safe stage logging; demonstrate one failure traced from screen to runtime log.
2. Reliable correction recording and clear failure feedback; test save, retrieve, replacement, balance and workspace boundaries.
3. Live core entry regression cases plus the small category-selector comparison if time and a declared budget permit.
4. Reversed-history anomaly fix, automatic scheduler/worker demonstration, complete browser/Docker checks and submission walkthrough.

The acceptance rule remains: each required feature needs an understandable workflow and evidence for success and failure cases. Source/CI and focused model measurements are now recorded; finish the final handoff without turning a small synthetic score into a production guarantee.
