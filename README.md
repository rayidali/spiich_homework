# Daybook · Accounting workspace

A React and TypeScript accounting application backed by PostgreSQL. Record money in and out, review balanced entries, manage recurring transactions, and inspect financial reports. AI suggests entries and categories for your approval; PostgreSQL protects posted history and the accounting rules. The API is **REST**.

Start with Docker below, or open the [protected hosted demo](https://daybook-ledger-delta.vercel.app). The interface has Home, Transactions, Reports and Settings. No API key is needed for manual accounting, reports, recurring drafts or statistical anomaly alerts.

**Reliability experiment in preparation:** a [fresh three-route protocol](docs/research/COMPLETENESS_EVALUATION.md) checks whether answers actually finish the user's request. A correct office-supplies number buried under an all-expenses answer fails focus. Independent arithmetic, deliberate faulty-answer tests and paired comparisons are implemented; there are no new live-model scores yet. The proposed $0.90 allowance requires separate approval. The hosted route remains `composable`.

**Current hosted release:** Source **`93a8617932daff772c5b5d9c836be15692a64979` is promoted** at [Daybook](https://daybook-ledger-delta.vercel.app), deployment `dpl_2Rh1j9ryaPzor5vsREcDvYJHgFSQ`. [Full CI 41251437109](https://github.com/rayidali/spiich_homework/actions/runs/41251437109) passed verification, native research and Compose; live-AI was skipped. The actual stable alias and project production target match this READY/PROMOTED deployment, with all-deployment protection retained. [Release evidence](docs/evidence/compound-grouping-release.json).

**Current candidate — declared arithmetic published and full CI verified; not deployed or live-model measured.** The opt-in `complete` route finishes supported, missing arithmetic already frozen in the answer contract. Verified January $240 and February $90 bindings can produce the declared −$150 difference and −0.625 relative-change ratio through the existing exact calculator, with no new database read or provider call. Supplied bindings are never replaced. Missing inputs, ambiguous month sources, unsupported units, zero divisors and exhausted limits remain unresolved; a newly exposed conflicting supplied formula withholds the whole financial answer. [Behavior and limits](docs/ANSWER_COMPLETENESS.md).

Exact source `eee73f387f85d2676a50c1e0461bd46c3161ebaf` passed [CI 41264139687](https://github.com/rayidali/spiich_homework/actions/runs/41264139687), attempt one: **2,136 normal tests across 107 files**, **32 browser workflows in 42.8 seconds**, native research and Compose (**2,135 overlapping tests across 106 files**). Four normal cases/one file and five Compose cases/two files skipped. The seven new PostgreSQL cases and one new browser workflow are included, not additional counts. [Exact-source receipt](docs/evidence/declared-arithmetic-ci.json). The combined four-query/eight-calculation/eight-assumption limits include existing work and unused original assumption IDs. Generated calculations retain separate audit metadata; `userIntentVerified:false` remains unconditional. Live-AI was skipped: no new provider call/spend, model score, hosted acceptance, deployment or reopened cohort. Production remains `93a8617` / `composable`.

**Earlier interface candidate, not deployed:** `1847a67` repairs fragile AI row references and schema-retry feedback. [Full CI passed](docs/evidence/financial-interface-candidate-ci.json): 1,963 tests, 29 browser workflows, actual PostgreSQL and Docker Compose. This is engineering evidence, not a new model-accuracy score. The [completed adaptive comparison](docs/evidence/adaptive-runs/holdout-v2/report.md) remains frozen. A newer completeness implementation is described next; the preceding CI does not cover it.

**Newer published candidate, CI-verified but not deployed:** the optional `complete` chat route asks the model to declare the requested results before reading amounts. For example, “January spending, February spending and the difference” requires three visible outputs, not merely two correct numbers. The application checks their exact sources and calculations, calls missing work partial and withholds conflicting results. This verifies the declaration, not everything the user meant. [Plain explanation](docs/ANSWER_COMPLETENESS.md). Exact source `382f39f` passed [full CI](docs/evidence/answer-completion-candidate-ci.json): 2,097 tests and 31 browser workflows, including six new PostgreSQL cases and two new browser workflows, plus native research and Compose. Counts overlap; provider responses are scripted. No new model call, live-model score or change to the hosted default is claimed.

The preceding `7ac0a88` release passed **three known date-scope regressions** for $0.0100061 in three provider attempts, with all 74 journals and 22 accounts unchanged and all three requests matched to 12 runtime events. All-history guard provenance was observed, but the model already chose the canonical date (`changed: false`): no actual lower-bound replacement or schema-repair call occurred live. This is bounded regression evidence, not a new general accuracy score. The earlier frozen comparison's 18/20 result belongs to its own source. [Three-case acceptance](docs/evidence/chat-history-acceptance.json). These calls were not repeated for the `f4f3a7` conversation release or the later expense-scope, cash-movement and compound-grouping releases.

The promoted chat uses checked query building blocks and exact arithmetic, alongside the existing report tools. Three earlier release checks caught a cash-source substitution, an invalid model argument and an invented date cutoff; their original failures remain preserved. [Architecture and limits](docs/ARCHITECTURE.md), [two-page comparison](docs/reports/chat-query-comparison.pdf), [reliability work](docs/CHAT_RELIABILITY.md). The expense scope guard checks supported standalone first-user questions, with no earlier user turns. Assistant-only preambles are allowed. It resolves exact account names/codes and complete posting descendants in the same execution snapshot as the amounts, withholding conflicting plans before reading money. The returned proof lists only checked fields: omitted dates remain unverified. Any earlier user turn makes this guard unassessed; all conversation context still reaches ordinary execution without a scope proof. It does not prove follow-up meaning, rewrite a plan or add a model call.

Questions can now group recorded amounts jointly by two or three ordered dimensions: account, person/business and month or quarter. Account/time views include every scoped posting account; person/business combinations fill missing periods only for tuples actually observed after the requested filters. Closing balances retain opening history. Exact arithmetic keeps each row’s account identity and period. The server caps the complete grid at 30,000 cells and 120 periods, then applies a global 50-row display limit with explicit truncation. This expands supported queries; it does not prove general question or formula intent. [Plain-language grouped-spending walkthrough](docs/COMPOUND_GROUPING.md).

`net_cash_movement` measures signed posted cash change over an inclusive date range: cash debits minus cash credits. The server selects all cash-designated asset posting accounts, including archived history. Results use saved USD base values or one explicit native currency, with activity filters and grouping kept visible. Calculator movement ancestry retains periods and identities separately from as-of cash balances. This is net change, not gross payments, payment allocation, revenue, profit or a formal cash-flow statement. [Plain-language cash-change walkthrough](docs/CASH_MOVEMENT.md).

For a quick explanation, read the [accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) and the [two-page category experiment](docs/reports/category-learning-explained.pdf) ([HTML](docs/reports/category-learning-explained.html)). The [assignment checklist](docs/ASSIGNMENT_REVIEW.md) maps requirements to implementation and evidence.

## Run with Docker Compose

Requires Docker Engine/Desktop with Compose v2. No API key is needed to explore the accounting application.

```sh
docker compose up --build
```

Open **http://localhost:3001**. Startup waits for PostgreSQL, applies checksummed migrations, seeds the workspace, then starts the application. The database persists in a named volume. Subsequent starts keep your existing data.

The seeded Northstar Studio workspace has 22 accounts, six months of activity, an unpaid invoice, a EUR receipt, a draft awaiting review, two recurring schedules, and intentional unusual/duplicate expenses to inspect. Demo dates are anchored to the first seed run; restarting never shifts posted history.

## Connect AI when ready

Both Gemini and OpenAI are supported. Copy `.env.example` to `.env` only if you do not already have one, then configure your chosen provider locally:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

Leave `AI_MODEL` empty to use the provider default: `gemini-3.5-flash-lite` or `gpt-6-luna`. For OpenAI, set `AI_PROVIDER=openai` and `OPENAI_API_KEY`. Remove any stale model override when switching providers. Keys remain on the server and are excluded from version control, Docker images, and the submission. Restart the local server after changing `.env`, or recreate the Compose app:

```sh
docker compose up -d --force-recreate app
```

Use a model your project can access. The default is documented on Google's [Gemini 3.5 Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) and passed bounded direct checks with the hosted credential. Upstream service errors, connection failures and timeouts now have distinct messages and sanitized diagnostics; entry/category requests are not automatically retried. The default financial chat may make one additional, explicitly accounted schema-correction attempt under its shared deadline; HTTP, semantic and database errors do not trigger it. The full product live evaluation remains incomplete, and failed calls can have unknown usage/billing. Changing local `.env` does not update Vercel's deployed key or model. A dedicated secret is configured only for the now-closed manual [adaptive comparison](docs/research/ADAPTIVE_EVALUATION_V2.md); the general Actions `GEMINI_API_KEY` smoke secret remains unset. With no key, manual accounting, reports, recurrence, and statistical alerts continue working.

Before a product provider run, read [Product AI evaluation: posted-correction fixtures](docs/PRODUCT_AI_EVALUATION.md). The repaired `daybook-accounting-eval-v2-posted-corrections` fixtures teach through real reviewed postings; historical V1 results must not be pooled with V2. With a running, migrated disposable evaluation database and an agreed provider allowance, the bounded four-case smoke is:

```sh
npm run ai:evaluate -- --suite smoke
```

The original 40 question texts, case IDs and 20-development/20-holdout split are unchanged. V2 uses separate before/after workspaces for each selected correction case and repeat, plus an isolation decoy. Reference-authored fixture postings finish before journal fingerprints; **evaluated model responses are never posted and existing workspaces are not reset**. The after-state contains both the posted example and correction memory, so any gain cannot isolate memory from history retrieval. The smoke subset has no correction pairs. Clarification meaning still requires human review. Runs can incur charges; attempts are capped and there are no automatic retries, but observed-token limits are not an absolute billing ceiling. Unique reports remain under `docs/evidence/ai-evaluations/`; the V2 latest copy is `docs/evidence/ai-evaluation-v2.json`. Historical reports are preserved. See `npm run ai:evaluate -- --help` and the [fixture contract](docs/PRODUCT_AI_EVALUATION.md).

With Compose, use the dedicated evaluation profile, which has administrative access only for creating its isolated fixtures. The normal app retains its restricted database role:

```sh
docker compose --profile evaluate run --build --rm evaluate
```

The product 40-case evaluation, the completed [focused category comparison](docs/CATEGORIZATION_PROTOCOL.md), and the completed nine-route research benchmark are separate. The category adapters and UI/API passed full CI, and the bounded live selector comparison is complete; the earlier category release passed 11 selected API checks; fresh hosted browser/device usability remains separate. Jev reranking/review, semantic vectors, managed File Search and Wren were exercised only in the isolated research harness; no retrieval/reviewer route is enabled in product chat. Mastra has not been added.

A separate opt-in candidate, `FINANCIAL_CHAT_ROUTE=adaptive`, lets the assistant inspect results before selecting another query or exact calculation. It shares three total provider attempts across the request and does not hold a database connection while waiting for the model. Source `2b2de76` passed full CI, including actual-PostgreSQL inspection and identity tests; provider responses were scripted. It is not deployed or the hosted default. A completed 16-question paired comparison scored both routes 8/16 under the frozen grader; separate internal review found four grading false-negatives and judged composable 9/16 and adaptive 11/16 complete. Real missing-answer and invalid-reference failures remain. The frozen screen did not qualify adaptive for promotion; these small synthetic results do not establish a general winner. [Two-page illustrated comparison](docs/reports/adaptive-comparison-explained.pdf) · [Design and complete evidence](docs/ADAPTIVE_CHAT.md).

## Local development without Docker

Requires Node 22.12+ and npm. The convenience launcher uses an isolated, real PostgreSQL server through `embedded-postgres`; local data stays in `.tools/postgres`.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on port 3001 and PostgreSQL on 55432. Ctrl-C stops the servers and preserves data. Restart the command after adding a key to `.env`.

To use your own PostgreSQL, set both database URLs shown in `.env.example`. `MIGRATION_DATABASE_URL` must permit migrations and role creation; `DATABASE_URL` uses the restricted `spiich_app` role. The launcher skips embedded PostgreSQL when `DATABASE_URL` is set. The portable launcher was exercised on macOS arm64; Compose is the cross-platform submission path.

Set `SEED_DEMO=false` **before the first start** for an empty journal with the default chart. It does not erase an already seeded workspace.

## What is included

| Requirement                 | Implementation                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Double entry                | Exact decimals, 2–100 lines, balanced USD base amounts, deferred PostgreSQL constraints                     |
| Chart of accounts           | Tree, unique codes, five account types, create/edit/archive/restore/delete unused accounts                  |
| Journal                     | Simple USD form, full manual/FX entries, AI clarification and review, drafts, revisions and reversals       |
| Currency                    | USD base; USD, EUR, GBP, CAD, JPY accounts; stored rates and native/base balances                           |
| Recurrence                  | Weekly/monthly/yearly, calendar anchors, automatic drafts, edit future content, pause/resume, recovery      |
| Reporting                   | Trial balance, P&L, balance sheet, account ledger with opening/running balances, filters and CSV            |
| Transactions                | Search, account/date/status/currency filters, cursor pagination, entry drill-down                           |
| AI entry and categorization | Structured proposals, clarification, account validation, relevant history and correction retrieval          |
| Anomaly detection           | Duplicate/amount/category rules, review/dismissal, resolved alerts and reversal-aware rechecks              |
| Insights                    | Checked composable queries, exact sourced calculations, clarification, scope and source evidence            |
| UX                          | Four primary destinations, explicit account-effects review, accessible controls and progressive detail      |
| Operations                  | Migrations, Docker Compose, health checks, request IDs, outbox jobs, passing CI, protected Vercel/Neon demo |

A correction means changing the account in an AI suggestion, then posting the reviewed entry. Saving a draft alone does not teach it. The posting transaction records the correction atomically; later suggestions can retrieve it, and forgetting or reversing the example excludes it. This changes the examples supplied to the model, not its weights. The focused comparison measures following supplied correction examples; database retrieval quality and general future production accuracy remain separate questions.

The short-form **Suggest category** button and `POST /api/ai/category` passed real database and browser CI; the hosted release passed its selected API acceptance checks. Gemini, Jev Choice and an offline reference receive the same fixed facts and eligible account options. They choose one expense/revenue category, ask a question, or hand off an unsupported event; they cannot change amounts/funding or post. `CATEGORY_PROVIDER=gemini|jev|reference` is server-controlled, with Gemini retained by the predefined comparison screen and reviewed release decision. Jev uses `TYPESAFE_API_KEY`; availability is separate from whole-entry AI. [Scope and safeguards](docs/CATEGORY_SELECTOR.md). No bank-feed or CSV-import workflow is included.

## Verification

With `npm run dev` already running, use another terminal:

```sh
npm test
npm run build
npm run dev -- --test-browser --reuse-db --production
npm run format:check
```

For a standalone run that owns and stops its local PostgreSQL:

```sh
npm run dev -- --test
npm run build
npm run dev -- --test-browser --production
```

Playwright uses installed Chromium or the local Brave browser when available. On another machine, install its browser with `npx playwright install chromium`. Browser checks create a separate workspace, use port 3002, and exercise the built application. They do not modify the demo workspace, and the launcher disables the provider key for these workflows.

The Docker integration-test service is available with:

```sh
docker compose --profile test run --build --rm tests
node scripts/check-compose-persistence.mjs --execute
```

The persistence command recreates app/database containers and checks that a complete existing posted entry survives; it preserves the named volume and makes no journal writes. Run it after Compose startup. This check passed in the [current CI run](https://github.com/rayidali/spiich_homework/actions/runs/41251437109).

Exact-source CI passed **1,629 tests across 85 files and all 29 browser workflows**. The 98 named compound-grouping tests—45 compiler/output, four chat, 35 calculator and 14 real-PostgreSQL tests—are included in that test total. The one new compound-result browser workflow is included in the browser total. Provider responses and the browser chat response are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

Live model measurements are separate from CI's provider-free contracts. The preceding `7ac0a88` hosted acceptance passed three date-scope regressions with a [71-check internal audit](docs/evidence/chat-history-acceptance.json). The earlier category release separately passed 11 requests and a [144-check audit](docs/evidence/category-hosted-acceptance-audit.json); those are historical results, not additional current-release trials. Hosted automatic cron firing, physical-device usability and the separate original 40-case live whole-entry evaluation remain unverified.

## AI decisions and measured results

The product gives Gemini 3.5 Flash-Lite narrow responsibilities: interpret an entry, choose an allowed category, or select an approved report operation/composable ledger-query plan and exact calculation. Code and SQL calculate the money. A proposal cannot post itself. A correction becomes a trusted example only when the user reviews and posts the corrected entry; draft saves alone do not teach. Copyable error references connect the interface to safe request/provider logs.

We compared the same category facts, account list and prior examples using exact-memory rules, Gemini and Jev. On 33 held-out category tasks, both models chose semantically acceptable accounts; Gemini also followed the taught business preference in **33/33**, Jev in **31/33**. Jev twice kept Office supplies after being taught Printing. It was cheaper, but did not meet the predefined reliability condition for replacement. **Gemini remains the narrow selector default.** This is a small synthetic comparison, not 100% production accuracy. [Scores](docs/evidence/category-runs/completed-v3/holdout/report.md), [71-check audit](docs/evidence/category-runs/completed-v3/independent-audit.json), [decision](docs/evidence/category-runs/completed-v3/release-decision.json).

The category experiment recorded all 216 v3 observations. Including both earlier development adapter failures, its closed allowance contains 119 paid attempts and **$0.036753586** tracked usage. The 11 hosted acceptance calls cost a separate **$0.0085057** estimate. These are estimates, not invoices. Learning means supplying reviewed examples, not retraining model weights or claiming measured improvement in retrieval.

A separate completed research harness compares nine routes using broader analytics, lexical documents, managed Gemini File Search, Gemini embeddings/pgvector, Jev reranking, actual Wren and answer reviewers. Managed search led the broad synthetic test; the existing narrow tools led the common-capability subset. Only lexical document access passed the component-improvement screen, supporting a further controlled document experiment rather than replacing reliable tools. Those routes remain outside product chat. The 40 documents are fictional test fixtures; there is no product upload workflow, and the assignment does not require one. Mastra was not added.

The older study's [two-page explanation](docs/reports/daybook-ai-explained.pdf), [narrative](docs/reports/research-study.md), [graphs](docs/evidence/research-runs/holdout-v1/report.html), [worked failures](docs/reports/research-worked-examples.md), [cost record](docs/evidence/research-final-costs/cost-reconciliation.md) and [reproduction guide](docs/research/REPRODUCE.md) preserve its results and limitations. That study's source and approximately $6.05 closed allowance are historical; they were not reopened for the product repair.

## Reading the code

```text
db/migrations/    PostgreSQL constraints, permissions, revisions, provenance
server/ledger.ts  One entry creation/posting/reversal path
server/reports.ts Posted-journal financial queries
server/ai.ts      Shared proposal validation, financial plans and bounded schema repair
server/financial-analysis.ts / financial-calculation.ts  Checked ledger queries and exact arithmetic
server/date-scope.ts  Conservative original-user all-history scope proof
server/ai-admission.ts  Shared PostgreSQL request limits
server/ai-provider.ts  Whole-entry Gemini/OpenAI adapters and safe failures
server/category-selector.ts / category-service.ts  Fixed-fact category choice and review proposals
server/categorization-memory.ts  Atomic reviewed-posting examples and forgetting
server/diagnostics.ts  Safe request-correlated events
server/recurring.ts / anomalies.ts  Bounded durable background work
server/app.ts    Validated REST API and error responses
server/hosting/  TypeScript Vercel API/scheduler adapters
api/             Tiny exports of generated native ESM hosted bundles
shared/          Money arithmetic and TypeScript/Zod contracts
web/src/         React pages, forms and reusable UI
tests/           Real PostgreSQL tests, provider contracts, browser workflows
scripts/         Migration, resumable seeding, dev launcher, live AI evaluation
research/        Isolated routes, retrieval, Wren bridge, validators and reference/scoring code
scripts/research/  Fixture setup, indexing, controlled runs and report generation
```

For the current research explanation, start with the **[study narrative](docs/reports/research-study.md)** and its hiring-cost walkthrough and architecture diagrams. The older eight-page **[visual architecture report](docs/reports/architecture-review.pdf)** and **[interactive HTML version](docs/reports/architecture-review.html)** preserve the planning snapshot from before the Gemini/interface implementation. Use the checkpoint for current execution status.

The [beginner accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) explains the numbers, and the [architecture](docs/ARCHITECTURE.md) provides implementation details and research sources. The [demo and interview guide](docs/INTERVIEW_GUIDE.md) explains the design in practical terms. [API reference](docs/API.md), [product completion plan](docs/PRODUCT_PLAN.md), and [build log](docs/BUILD_LOG.md) record implementation details and decisions. The [Daybook design record](docs/DESIGN.md) explains the visual identity, downloaded design skills, interaction rules, and before/after evidence.

## Deliberate boundaries

This is a single configured workspace application, as authentication was excluded from the assignment. Organization-scoped tables and composite foreign keys prepare the data model for tenancy; they do not replace production authentication, authorization, or row-level security. Compose binds the UI/API to localhost.

Reports use historical recorded exchange rates. Automated period-end revaluation, tax, inventory, invoice lifecycle management, bank reconciliation, and formal period closing are outside this implementation. Production financial insights support approved reports, composable ledger filters/grouping, supported native-currency and closing-balance views, exact calculations and clarification. The model cannot execute arbitrary SQL. Noncash balance operands in scenarios and unrestricted forecasting remain unsupported. Wren-planned SQL and document/vector retrieval remain isolated research paths.

The design includes concurrency controls and bounded work that support growth. **Million-user capacity has not been load-tested or claimed.** The architecture document describes the workload assumptions, operational requirements, and measurements needed to earn that claim.

## Hosted demo and continuation

Open [Daybook](https://daybook-ledger-delta.vercel.app) and sign in with the owner's Vercel account if prompted. Hosting uses Vite static output, Express Functions and Neon PostgreSQL. Vercel protection controls access to the shared writable demo; application-level identity is outside assignment scope. Reviewer access is still to be decided.

[Hosting](docs/HOSTING.md) explains the build-only migration credential, restricted runtime role, native ESM bundle, daily scheduler and deployment-variable requirements. Production values were supplied as deployment overrides, so a fresh CLI deploy needs explicit private configuration; a repository push is not a configured Vercel auto-deploy. Docker remains the complete portable startup path.

The hosted trial balance and balance sheet had zero differences. Scheduler authorization and an authorized batch passed. The latest three date-scope checks passed on the promoted source; general live accuracy, automatic daily firing and fresh hosted browser visual inspection remain unverified. Earlier11-request category acceptance remains separate historical evidence. Larger job backlogs can wait for later hosted invocations; this is not a measured million-user deployment.

Research provider work is complete. Total tracked research usage is approximately **$6.05**, including development and unknown-use reservations; the funded continuation accounts for **$5.27** of that total. Its Gemini/Jev portions stayed below the authorized $6.40/$0.10 additional caps. These are configured-rate estimates and retained reservations, not invoices. Source, data, historical outcomes and budget policies remain preserved. The [checkpoint](CHECKPOINT.md) records delivery verification and separate product checks, including hosted visual review, physical-device checks and reviewer sharing. Do not reset the database, rerun completed measurements, or retune this holdout as though it were unseen.
