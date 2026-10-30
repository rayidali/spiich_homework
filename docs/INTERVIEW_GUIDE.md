# Explain and demonstrate what you built

## 2026-10-30 live AI recovery update

The hosted model and source default are now **`gemini-3.1-flash-lite`**. Direct API testing reproduced the earlier model's generation timeouts and confirmed working text/JSON/tool calls on Flash-Lite. A separate journal-proposal rejection was traced to the 100-line `maxItems` constraint in Gemini's decoding grammar: the transport now omits array maxima, while the full original Zod limit, account checks and exact-money/balance rules remain enforced locally.

Selected hosted checks succeeded: cash **$125,620.00**, **12 Acme Corp entries**, September expenses **$9,265.00**, and a review-only **$340 Supplies debit / Company credit card credit** proposal. Cash/search/expense values matched independent endpoints, and the 73-entry journal list was unchanged. An initial expense timeout succeeded on manual repeat, while a later search failed; **intermittent provider failures remain**. No automatic retry, paid-plan change or accuracy guarantee was introduced.

Local build/native imports and **60 isolated tests** passed, including two new schema regressions. Full CI for source `7ecb435c421862dba5efd4e3b6f743c93fd1888e` is [queued](https://github.com/rayidali/spiich_homework/actions/runs/41103851106); the previous 101-test full run remains the last completed regression evidence. These selected checks are not the full 40-case live evaluation. [Detailed evidence](evidence/chat-recovery-verification.json) records successes and failures. Earlier timeout-only notes below describe the 2026-10-29 snapshot.

> Saved 2026-10-29. Daybook is hosted behind Vercel login, with separate Neon PostgreSQL. Full CI passed 101 backend tests, 10 browser workflows, native hosted imports and Docker persistence. Hosted reports/scheduler passed HTTP checks. Google model metadata was accessible, but live financial chat timed out. Fresh visual/physical-device review and successful live evaluation remain pending. See [checkpoint](../CHECKPOINT.md).

Use the [visual architecture report](reports/architecture-review.pdf) to rehearse with diagrams, or open the [interactive HTML walkthrough](reports/architecture-review.html#journeys) to step through a rent payment. It records the earlier planning snapshot. Gemini support and the simpler interface are now implemented in source, with backend, browser and Docker checks passing in CI. Live model evaluation and optional retrieval experiments remain pending.

## Your 30-second explanation

“I built Daybook, an accounting workspace whose source of truth is an immutable double-entry journal in PostgreSQL. React provides manual and AI-assisted entry, account management, reports, recurring drafts, and review alerts. PostgreSQL enforces balanced postings even when the API is bypassed. The AI proposes entries and chooses approved read-only financial tools; it never posts on its own or calculates the reported financial amounts. I focused on correctness under retries and concurrency, and kept the architecture small enough to run with Docker Compose.”

This implementation was built with AI assistance. Explain that honestly if asked. Your strongest evidence is understanding the decisions and demonstrating the tests, not pretending every line was handwritten.

## Explaining hallucination defenses accurately

The implemented boundary is: the model proposes an entry or chooses an approved read-only financial function; application code validates accounts, dates, amounts, and balance; PostgreSQL rejects invalid postings; SQL and application code supply reported monetary values and evidence links. Structured output prevents some format errors but cannot establish that the category or interpreted period is correct. User confirmation and clarification remain necessary.

Gemini and OpenAI adapters now share the same validation and financial functions. The bounded 40-case harness tests exact complete entries, tool arguments, evidence and correction retrieval in isolated workspaces. Its unit tests establish scoring behavior, not live model quality. The key is saved locally and supplied server-side to Vercel. A Google model-metadata request succeeded, while a hosted financial question returned the safe 25-second AI_TIMEOUT. Successful live generation/evaluation remains pending; the timeout cause is unknown. Jev and vector retrieval remain optional experiments. Explain this distinction rather than presenting a pending evaluation as an accuracy result.

For the new UI, explain: “A beginner chooses money in, money out or transfer, then explicitly selects what it was for. The review shows which accounts change before posting. Paying an existing invoice credits receivables, so the same revenue is not counted twice. Complex and foreign entries still have the full journal form.” Checked-in screenshots predate this flow; behavioral browser checks passed and fresh CI captures need visual inspection before replacement.

## Relating the work to Spiich

The public [fullstack role](https://spiich.ai/careers/fullstack-engineer) and [AI role](https://spiich.ai/careers/founding-ai-engineer) describe overlapping work on business data, usable interfaces, agents, and reliability. The accounting exercise is plausibly a test of the same engineering judgment. That is an inference; do not claim to know their private hiring rationale or that they are building an accounting product.

A useful explanation is: “I treated language interpretation as fallible. The application owns the business rules and the database owns financial consistency. I would compare retrieval approaches using the same cases and exact expected outcomes, then keep additional components only when they improve the product.” Keep the conditional wording until the experiments have actually run. The proposed comparison and its acceptance criteria are in [the plan](PLAN.md#proposed-one-to-two-day-finish-and-comparison).

## Understand it like an organized notebook

Think of five kinds of buckets: things the business owns, things it owes, the owner's stake, money earned, and costs. Every business event explains at least two bucket changes. The accounting walkthrough shows exactly how $10,000 investment, a $15,000 customer invoice/payment, $2,400 rent, and $340 card supplies turn into a balanced set of reports.

- **React is the desk:** where you view and enter information.
- **The API is the clerk:** checks that a request makes sense and explains errors.
- **PostgreSQL is the permanent notebook and its rules:** it refuses invalid posted records.
- **A transaction is a sealed envelope:** all related changes commit together, or none do.
- **An idempotency key is a receipt number for a request:** resending it does not create another purchase.
- **A draft revision is a version number:** it stops you approving an older copy after someone edited it.
- **The outbox is a durable to-do list:** posting records both the financial event and the need to analyze it.
- **The AI is an assistant at the desk:** it can prepare a suggestion, but the clerk and notebook still enforce the rules.

Read [the full worked accounting example](ACCOUNTING_WALKTHROUGH.md) before the technical sections below.

## A six-minute demo

| Time      | Show                                 | Explain                                                                                                                                        |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:40 | Dashboard                            | All metrics come from posted PostgreSQL journal lines. Drafts are excluded. Cash and profit differ.                                            |
| 0:40–1:40 | New manual entry                     | Enter $340 supplies, debit Supplies, credit Company credit card. Show the live balance check, save/post, and open the immutable record.        |
| 1:40–2:30 | P&L → balance sheet → account ledger | The expense increases card debt; it does not immediately reduce bank cash. Open a number and follow the supporting history.                    |
| 2:30–3:10 | Reverse the demo entry               | Keep the original and its linked opposite entry. Show that earlier as-of reports still reflect the original history.                           |
| 3:10–3:50 | Review alerts                        | Explain the doubled rent's median/history and a potential duplicate. Mark an alert reviewed; no journal entry is silently deleted.             |
| 3:50–4:30 | Recurring schedules                  | Show the rent template. Due instances become drafts. Explain calendar anchors, rate review, and editing only future occurrences.               |
| 4:30–5:30 | AI workflows, once connected         | Describe a card purchase; inspect the suggested accounts before confirming. Ask for cash or last month's expenses, and open the evidence link. |
| 5:30–6:00 | Tests and SQL constraint             | Show a direct-SQL imbalance rejection and the edit/post race test. Explain why correctness lives below the UI.                                 |

Until provider access and live evaluations pass, explain the adapter and controlled contract tests. A configured key is not proof of a working provider. Do not present mocked test responses as a successful live AI demonstration.

## Questions you should be able to answer

**Why is crediting the bank correct when paying rent?**

The bank is an asset. Debits increase assets; credits decrease them. Rent is an expense, increased with a debit. Debit and credit are column names, not universal synonyms for “money in” and “money out.”

**Why doesn't collecting an invoice count as new revenue?**

The invoice already recognized revenue and a receivable. Collecting it moves value from receivable to bank. Crediting revenue again would double-count earnings. The AI asks when this context is ambiguous.

**How do the books balance when revenue and expenses exist?**

The raw ledger balances across all five account types. On the balance sheet, accumulated unclosed profit is included in equity. In the worked example, $22,600 assets equal $340 liabilities plus $22,260 equity, which includes $12,260 profit.

**Why a trigger instead of just a `CHECK` or application validation?**

A per-row check cannot safely express the sum of all journal lines. A deferred constraint trigger sees the transaction's final state. API validation helps the user; the database constraint protects every write path. A race test verifies the shared parent-row lock.

**What happens if the user double-clicks, the network times out, or two requests arrive together?**

The client reuses a create key. The unique key/hash combination returns the same entry for the same request and rejects changed contents. Posting is safe to repeat. Draft edits/posting compare the reviewed revision under a lock. A lost edit response may require a refresh.

**How can an old browser tab be dangerous?**

Someone could change $100 to $1,000 after another person reviewed the draft. A stale confirmation cannot post the changed version: its expected revision no longer matches, so the server returns 409 and asks for a reload.

**How do you prevent currency rounding errors?**

Use exact decimals, persist the transaction rate, round each base line to cents, and require the rounded totals to match. No JavaScript floating-point arithmetic decides whether an entry balances. A reversal uses the old rate, not today's rate.

**What does the AI learn from corrections?**

Confirmed changes to suggested accounts are stored by organization and retrieved for similar future descriptions/vendors. Those examples guide later suggestions. This is retrieval-based adaptation, not model retraining, and live improvement still needs evaluation.

**Can the AI hallucinate the cash balance?**

The numerical answer is constructed by code from a validated SQL tool result. The model can still choose the wrong intent/date, so the UI exposes the period and evidence. It cannot run arbitrary SQL or post through the chat endpoint.

**Why statistical anomaly detection?**

Duplicates and a doubled rent amount have understandable rules and evidence. They are cheap, reproducible, and work without a key. They can produce false positives; review stays with the user. A future model could add context after accuracy and cost are evaluated.

**What happens if the worker crashes after posting?**

The job was committed with the journal entry. Its lease expires, another worker reclaims it, and unique alert keys make reprocessing safe. That is at-least-once execution with idempotent effects, not a claim of exactly-once delivery.

**Why not use microservices immediately?**

Posting is one tightly coupled database transaction. Splitting it prematurely adds failure modes without helping the assignment. API and worker modules can be deployed separately when measurements justify it. Scale depends on workload, indexes, connection budgets, and operational controls.

**Would this support a million people today?**

“The code has useful growth foundations, but I would not claim a capacity we have not measured. I would first specify active users, writes and reads per second, history size and tenant skew, then load-test those workloads. Production also needs authentication, authorization, backups, restore drills, monitoring, distributed quotas, and operational ownership.”

**What would you build next?**

Start with the verified gaps: diagnose the Gemini timeout, run live evaluation, inspect fresh screenshots, observe the automatic hosted schedule and decide reviewer access. Container startup/persistence already passed in CI. For a real service, prioritize identity/authorization, operational recovery, observability, measured load tests, and financial closing/revaluation policies. Product expansion would follow customer needs such as invoice management, bank imports/reconciliation, and tax.

## Explain the interface

Daybook is the product; Spiich is the assignment's recipient. The overview follows the daily bookkeeping loop: balances, journal entries, and outstanding drafts or anomalies. The assistant is available from the header and relevant entry flows. Monthly bars expose exact values through a keyboard-accessible data table. On phones, recent-entry amounts remain visible beside each transaction.

The [design record](DESIGN.md) documents the source skills, before/after decisions, keyboard and motion rules, and verification limits. Explain the work as a set of choices about accounting tasks and interaction frequency. Physical phone testing is still pending.

## Code paths to rehearse

1. `web/src/Composer.tsx` → `server/app.ts` → `server/ledger.ts` → SQL triggers in `db/migrations/`.
2. `server/reports.ts`: explain opening balances, P&L signs, and earnings in equity.
3. `server/ai.ts`: show proposal validation, correction retrieval, and the closed set of insight tools.
4. `server/recurring.ts`: show the transaction, savepoint, occurrence key, and anchor calculation.
5. `tests/accounting.test.ts`: explain what would break if the locking or database guards were removed.

## Before submitting

Run the commands in [verification](VERIFICATION.md), supply keys through private server-side configuration (local `.env` or an authorized hosted environment), investigate the timeout and run the live AI evaluations, and rehearse the exact demo once. Include the README and lockfile. Keep `.env`, database files, `node_modules`, and local tooling out of the submission. Report actual test results and limitations without claiming unperformed production testing.

## Explain the hosted architecture

“I kept the accounting services shared between Docker and the hosted app. Vercel serves the React build and runs Express through a small native ESM adapter. Neon holds a separate demo database. The runtime uses a restricted database role; only the build gets owner access for migrations and idempotent setup. Posted history still goes through the same constraints.”

“The free hosting plan runs the scheduled catch-up daily. Successful writes also trigger a bounded anomaly batch after the response. Durable PostgreSQL jobs hold retry state, so the work is recoverable, but a big queue can take multiple invocations. I would give a production workload continuously serviced workers, global quotas and connection budgeting after measuring demand.”

**Why does the hosted app ask for Vercel login if authentication was excluded?**

The assignment did not require application users. The demo is one shared writable workspace and contains a provider key on the server, so deployment protection gates access. It is not tenant/user authorization. Reviewer sharing remains a specific next step; no public multi-user service is claimed.

**Does a green build mean the hosted API works?**

No. An early READY deployment still failed invocation. Native ESM bundling and wrapper-load checks were added, then the actual protected health/report/scheduler endpoints were tested. The scheduler also needed an Express wrapper for its request methods. These are examples of checking the complete request path rather than stopping at build success.

**What exactly can you say about AI today?**

“The adapters and validation are implemented, controlled-response tests pass, and the key can access model metadata. The live financial question hit our timeout. I handle that safely and keep manual accounting available, but I have not established successful generation or an accuracy score. My next step is to isolate the timeout, then run the already-written evaluation cases.”

Do not describe the timeout as a hallucination, a proven invalid key, a successful live answer or a measured billing result. Metadata access and generation are separate checks. The LLM does not translate arbitrary text into executable SQL; it selects a reviewed tool and validated parameters.

## Evidence you can show immediately

- [Full CI run](https://github.com/rayidali/spiich_homework/actions/runs/40999183176): 101 backend tests, 10 browser workflows, native wrapper imports, Docker startup and persisted posted history.
- [Protected hosted app](https://daybook-ledger-delta.vercel.app): manual accounting, reports and review alerts. October demo trial balance was $190,072.00 per side; balance sheet difference was $0.00 at the saved observation. These are seeded example amounts, not the beginner fixture.
- [Sanitized hosting evidence](evidence/hosting-verification.json): endpoint checks, scheduler authorization and the observed AI timeout, with limits explicit.
- [Build log](BUILD_LOG.md) and [architecture](ARCHITECTURE.md): reasons for database constraints, exact arithmetic, explicit tool boundaries and the small deployable architecture.

Use current source and numbers from the actual report during a demo; legitimate postings can change the saved sample totals. Never show credentials, private HTTP payloads, authentication state or provider keys during a screen recording.
