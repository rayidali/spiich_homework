# Daybook · Accounting workspace

> Updated 2026-10-31: **core assignment acceptance is the priority.** Read the [assignment review and concrete repair plan](docs/ASSIGNMENT_REVIEW.md). The architecture study is complete; it does not establish correction-learning accuracy or overall product readiness. Core repair `70b59c6` is deployed and verified: copyable error references, posted-entry correction memory and reversal-aware alerts. The new short-form category integration is implemented in source and has offline checks; its new CI workflows, deployment and live Gemini/Jev comparison remain pending.

Start with the [two-page plain-English explanation](docs/reports/daybook-ai-explained.pdf) ([readable HTML](docs/reports/daybook-ai-explained.html)) for the nine routes, scores, hiring walkthrough, Jev/Wren roles and test limitations. Document ingestion is research-only; the product has no document-upload workflow. Categorization uses retrieved, reviewed posting corrections, but improvement over time has not been measured; see the [categorization follow-up](docs/INTERVIEW_GUIDE.md#transaction-categorization-and-the-proposed-jev-comparison).

A React and TypeScript accounting workspace backed by PostgreSQL. Every posted journal entry is balanced and immutable at the database level. AI prepares entries for review and selects read-only financial queries; the ledger and SQL own the financial numbers.

The source and hosted whole-entry assistant use `gemini-3.5-flash-lite`; OpenAI remains selectable. Current deployed core source `70b59c62c6819880c2504fe546f4fecc8a703c50` passed [CI 41219589967](https://github.com/rayidali/spiich_homework/actions/runs/41219589967). Its [release receipt](docs/evidence/core-repair-release.json) records 64 exact source files, migrations 005/006, unchanged 73 journal records/dashboard, and an actual hosted error reference matched to runtime logs. That release made no provider call. Earlier provider-only repair `de67b49` passed its own [CI](https://github.com/rayidali/spiich_homework/actions/runs/41213514203). Selected hosted checks returned a correct $340 supplies/card proposal and asked for missing details on rent and the user’s friend/party example. All 73 journal records remained unchanged. The [repair receipt](docs/evidence/entry-provider-recovery.json) retains an earlier failed ambiguity check and distinguishes these selected API checks from a model-accuracy benchmark.

The isolated research implementation compares nine AI routes: existing tools, broader analytics, lexical documents, managed File Search, Gemini embeddings with pgvector, Jev reranking, Wren and two answer reviewers. It uses Gemini 3.5 Flash-Lite, synthetic fixtures and restricted read-only financial access. Managed File Search has the highest observed broad structured-task score (**70.6%**), while the existing control leads the predefined common-capability subset (**91.7%, versus 75.0% for managed search**). Only adding document access passes the preset component-improvement screen. The recommendation is a controlled document-workflow experiment while preserving reliable narrow tools; no experimental route is enabled in production chat.

The [protocol](docs/PLAN.md), [complete charts and scores](docs/evidence/research-runs/holdout-v1/report.html), [worked failure examples](docs/reports/research-worked-examples.md), [cost reconciliation](docs/evidence/research-final-costs/cost-reconciliation.md), and [reproduction guide](docs/research/REPRODUCE.md) make the comparison reviewable. Invalid and incomplete development pilots remain preserved as diagnostic history.

The completed research source and reports were published in commit `a5493c3`; this is historical study provenance, not the latest product release. [Full CI passed](https://github.com/rayidali/spiich_homework/actions/runs/41182776959), including application/browser tests, Docker startup and persistence, and native research/Wren checks. The [sanitized CI receipt](docs/evidence/research-final-ci.json) records the tested commit and limits; its optional live-AI job was skipped because provider measurements are recorded separately. Tracked research spending is approximately **$6.05**, including retained unknown-cost reservations. The local handoff is `submission.zip`, rooted at `daybook-ledger/`; publication tooling verifies its source bytes, CRCs and secret exclusions.

![Daybook financial dashboard](docs/evidence/dashboard.png)

The screenshot records the earlier design. Fresh screenshots of Home / Transactions / Reports / Settings are generated in the browser-evidence artifact of the [successful CI run](https://github.com/rayidali/spiich_homework/actions/runs/40999183176); they still need visual review before replacing these images.

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

Use a model your project can access. The default is documented on Google's [Gemini 3.5 Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) and passed bounded direct checks with the hosted credential. Upstream service errors, connection failures and timeouts now have distinct messages and sanitized diagnostics; requests are not silently retried. The full product live evaluation remains incomplete, and failed calls can have unknown usage/billing. Changing local `.env` does not update Vercel's deployed key or model. No GitHub Actions key secret was configured. With no key, manual accounting, reports, recurrence, and statistical alerts continue working.

Before a product provider run, read [Product AI evaluation: posted-correction fixtures](docs/PRODUCT_AI_EVALUATION.md). The repaired `daybook-accounting-eval-v2-posted-corrections` fixtures teach through real reviewed postings; historical V1 results must not be pooled with V2. With a running, migrated disposable evaluation database and an agreed provider allowance, the bounded four-case smoke is:

```sh
npm run ai:evaluate -- --suite smoke
```

The original 40 question texts, case IDs and 20-development/20-holdout split are unchanged. V2 uses separate before/after workspaces for each selected correction case and repeat, plus an isolation decoy. Reference-authored fixture postings finish before journal fingerprints; **evaluated model responses are never posted and existing workspaces are not reset**. The after-state contains both the posted example and correction memory, so any gain cannot isolate memory from history retrieval. The smoke subset has no correction pairs. Clarification meaning still requires human review. Runs can incur charges; attempts are capped and there are no automatic retries, but observed-token limits are not an absolute billing ceiling. Unique reports remain under `docs/evidence/ai-evaluations/`; the V2 latest copy is `docs/evidence/ai-evaluation-v2.json`. Historical reports are preserved. See `npm run ai:evaluate -- --help` and the [fixture contract](docs/PRODUCT_AI_EVALUATION.md).

With Compose, use the dedicated evaluation profile, which has administrative access only for creating its isolated fixtures. The normal app retains its restricted database role:

```sh
docker compose --profile evaluate run --build --rm evaluate
```

The product 40-case evaluation, the new [focused category comparison](docs/CATEGORIZATION_PROTOCOL.md), and the completed nine-route research benchmark are separate. The new category adapters and UI/API are in source, not deployed or measured live yet. Jev reranking/review, semantic vectors, managed File Search and Wren were exercised only in the isolated research harness; no retrieval/reviewer route is enabled in product chat. Mastra has not been added.

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
| Insights                    | Allowlisted financial tools, SQL-derived answers, evidence and links to the underlying views                |
| UX                          | Four primary destinations, explicit account-effects review, accessible controls and progressive detail      |
| Operations                  | Migrations, Docker Compose, health checks, request IDs, outbox jobs, passing CI, protected Vercel/Neon demo |

A correction means changing the account in an AI suggestion, then posting the reviewed entry. Saving a draft alone does not teach it. The posting transaction records the correction atomically; later suggestions can retrieve it, and forgetting or reversing the example excludes it. This changes the examples supplied to the model, not its weights. Better future accuracy still needs measurement.

The new short-form **Suggest category** button and `POST /api/ai/category` are implemented in source, pending their new CI and deployment. Gemini, Jev Choice and an offline reference receive the same fixed facts and eligible account options. They choose one expense/revenue category, ask a question, or hand off an unsupported event; they cannot change amounts/funding or post. `CATEGORY_PROVIDER=gemini|jev|reference` is server-controlled, with Gemini the initial default pending comparison. Jev uses `TYPESAFE_API_KEY`; availability is separate from whole-entry AI. [Scope and safeguards](docs/CATEGORY_SELECTOR.md). No bank-feed or CSV-import workflow is included.

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

The persistence command recreates app/database containers and checks that a complete existing posted entry survives; it preserves the named volume and makes no journal writes. Run it after Compose startup. This check passed in the [successful CI run](https://github.com/rayidali/spiich_homework/actions/runs/40999183176).

The historical `7ecb435c` application baseline passed **103 backend tests** (29 accounting, 14 AI/database contracts, 24 provider, 23 evaluation, 6 simple-entry and 7 hosted scheduler tests), **10 production browser workflows**, Docker build/startup/health, containerized backend tests, and posted-entry persistence across app/database container recreation.

For frozen research executable **`0fe267b`**, [CI 41155033249](https://github.com/rayidali/spiich_homework/actions/runs/41155033249) passed application/backend and browser verification, application Compose startup/persistence and the native Wren/pgvector database job. The matching local checkpoint passed **511 isolated TypeScript tests, 35 actual Wren Python tests and nine PDF exporter tests**, strict TypeScript/production build and formatting ([evidence](docs/evidence/research-local-v4.json)). The opt-in CI live-AI job was skipped; live study calls are separately recorded. Preserved pilot failures remain visible, and engineering tests do not establish held-out answer accuracy. See [research CI evidence](docs/evidence/research-ci-v4.json) and [verification details](docs/VERIFICATION.md).

The deployed core repair `70b59c6` subsequently passed [verify, native research and Compose CI](https://github.com/rayidali/spiich_homework/actions/runs/41219589967), with live-AI skipped. Its hosted controlled validation error matched the browser-facing reference to two runtime-log events; this was not a reproduced provider outage. The new category integration passed **134 focused offline tests**, TypeScript/production build and formatting. Its **six real-database tests and four browser workflows await CI execution**; these counts do not establish model accuracy or current visual quality.

## Reading the code

```text
db/migrations/    PostgreSQL constraints, permissions, revisions, provenance
server/ledger.ts  One entry creation/posting/reversal path
server/reports.ts Posted-journal financial queries
server/ai.ts      Shared proposal validation and approved financial tools
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

The [beginner accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) explains the numbers, and the [architecture](docs/ARCHITECTURE.md) provides implementation details and research sources. The [demo and interview guide](docs/INTERVIEW_GUIDE.md) explains the design in practical terms. [API reference](docs/API.md), [delivery plan](docs/PLAN.md), and [build log](docs/BUILD_LOG.md) record implementation details and decisions. The [Daybook design record](docs/DESIGN.md) explains the visual identity, downloaded design skills, interaction rules, and before/after evidence.

## Deliberate boundaries

This is a single configured workspace application, as authentication was excluded from the assignment. Organization-scoped tables and composite foreign keys prepare the data model for tenancy; they do not replace production authentication, authorization, or row-level security. Compose binds the UI/API to localhost.

Reports use historical recorded exchange rates. Automated period-end revaluation, tax, inventory, invoice lifecycle management, bank reconciliation, and formal period closing are outside this implementation. Production financial insights support four explicit query families and clarification. Broader analysis and Wren-planned SQL exist only in the isolated experiment, behind bounded query checks and a restricted reader.

The design includes concurrency controls and bounded work that support growth. **Million-user capacity has not been load-tested or claimed.** The architecture document describes the workload assumptions, operational requirements, and measurements needed to earn that claim.

## Hosted demo and continuation

Open [Daybook](https://daybook-ledger-delta.vercel.app) and sign in with the owner's Vercel account if prompted. Hosting uses Vite static output, Express Functions and Neon PostgreSQL. Vercel protection controls access to the shared writable demo; application-level identity is outside assignment scope. Reviewer access is still to be decided.

[Hosting](docs/HOSTING.md) explains the build-only migration credential, restricted runtime role, native ESM bundle, daily scheduler and deployment-variable requirements. Production values were supplied as deployment overrides, so a fresh CLI deploy needs explicit private configuration; a repository push is not a configured Vercel auto-deploy. Docker remains the complete portable startup path.

The hosted trial balance and balance sheet had zero differences. Scheduler authorization and an authorized batch passed. Automatic daily firing, fresh hosted browser visual inspection and live AI accuracy remain unverified. Larger job backlogs can wait for later hosted invocations; this is not a measured million-user deployment.

Research provider work is complete. Total tracked research usage is approximately **$6.05**, including development and unknown-use reservations; the funded continuation accounts for **$5.27** of that total. Its Gemini/Jev portions stayed below the authorized $6.40/$0.10 additional caps. These are configured-rate estimates and retained reservations, not invoices. Source, data, historical outcomes and budget policies remain preserved. The [checkpoint](CHECKPOINT.md) records delivery verification and separate product checks, including hosted visual review, physical-device checks and reviewer sharing. Do not reset the database, rerun completed measurements, or retune this holdout as though it were unseen.
