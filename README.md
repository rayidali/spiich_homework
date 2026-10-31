# Daybook · Accounting workspace

A React and TypeScript accounting application backed by PostgreSQL. Record money in and out, review balanced entries, manage recurring transactions, and inspect financial reports. AI suggests entries and categories for your approval; PostgreSQL protects posted history and the accounting rules. The API is **REST**.

Start with Docker below, or open the [protected hosted demo](https://daybook-ledger-delta.vercel.app). The interface has Home, Transactions, Reports and Settings. No API key is needed for manual accounting, reports, recurring drafts or statistical anomaly alerts.

**Verified hosted repair:** executable `e7a514e` passed [full CI](https://github.com/rayidali/spiich_homework/actions/runs/41231800054), including real PostgreSQL, browser and Compose workflows. **23 live financial-chat regressions passed** (16 exact answers, seven clarifications); all74 current journals and22 accounts stayed unchanged. [Repair evidence](docs/evidence/chat-scope-release.json). This is a selected regression set, not universal AI accuracy.

**Broader chat candidate:** the completed paired test scored composable queries 18/20 versus 6/20 for fixed report tools. That small synthetic comparison is separate from deployment acceptance. After two preserved failed candidates, source `012edb2` passed CI but remains staged: five of six hosted checks passed, while an all-history supplies question received an invented 2000 start date. Its current dollar total happened to match; the scope still failed. All six requests cost $0.0281190 in known usage, with unchanged books and no live schema-repair calls. The stable demo remains on verified `e7a514e`. [Latest incident and limits](docs/evidence/chat-schema-repair-blocked-release.json), [two-page comparison](docs/reports/chat-query-comparison.pdf), [reliability work](docs/CHAT_RELIABILITY.md).

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

The product 40-case evaluation, the new [focused category comparison](docs/CATEGORIZATION_PROTOCOL.md), and the completed nine-route research benchmark are separate. The category adapters and UI/API passed full CI, and the bounded live selector comparison is complete; the new hosted release passed 11 selected API checks; fresh hosted browser/device usability remains separate. Jev reranking/review, semantic vectors, managed File Search and Wren were exercised only in the isolated research harness; no retrieval/reviewer route is enabled in product chat. Mastra has not been added.

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

The persistence command recreates app/database containers and checks that a complete existing posted entry survives; it preserves the named volume and makes no journal writes. Run it after Compose startup. This check passed in the [current CI run](https://github.com/rayidali/spiich_homework/actions/runs/41226562746).

Current `b7bf5fe` passed the complete workflow linked above: database constraints, correction persistence/isolation, category integration, currency/report boundaries, all 18 browser workflows and actual automatic Compose scheduler/worker behavior. The earlier failed CI runs and their repairs remain in [BUILD_LOG](docs/BUILD_LOG.md); checks were fixed, not disabled. Historical test counts are recorded in [VERIFICATION](docs/VERIFICATION.md), not added to current totals.

Live model measurements are separate from CI's provider-free contracts. The selected hosted acceptance passed all 11 requests and a [144-check internal evidence audit](docs/evidence/category-hosted-acceptance-audit.json). Hosted automatic cron firing, physical-device usability and the separate original 40-case live whole-entry evaluation remain unverified.

## AI decisions and measured results

The product gives Gemini 3.5 Flash-Lite narrow responsibilities: interpret an entry, choose an allowed category, or select one of four authored financial query tools. Code and SQL calculate the money. A proposal cannot post itself. A correction becomes a trusted example only when the user reviews and posts the corrected entry; draft saves alone do not teach. Copyable error references connect the interface to safe request/provider logs.

We compared the same category facts, account list and prior examples using exact-memory rules, Gemini and Jev. On 33 held-out category tasks, both models chose semantically acceptable accounts; Gemini also followed the taught business preference in **33/33**, Jev in **31/33**. Jev twice kept Office supplies after being taught Printing. It was cheaper, but did not meet the predefined reliability condition for replacement. **Gemini remains the narrow selector default.** This is a small synthetic comparison, not 100% production accuracy. [Scores](docs/evidence/category-runs/completed-v3/holdout/report.md), [71-check audit](docs/evidence/category-runs/completed-v3/independent-audit.json), [decision](docs/evidence/category-runs/completed-v3/release-decision.json).

The category experiment recorded all 216 v3 observations. Including both earlier development adapter failures, its closed allowance contains 119 paid attempts and **$0.036753586** tracked usage. The 11 hosted acceptance calls cost a separate **$0.0085057** estimate. These are estimates, not invoices. Learning means supplying reviewed examples, not retraining model weights or claiming measured improvement in retrieval.

A separate completed research harness compares nine routes using broader analytics, lexical documents, managed Gemini File Search, Gemini embeddings/pgvector, Jev reranking, actual Wren and answer reviewers. Managed search led the broad synthetic test; the existing narrow tools led the common-capability subset. Only lexical document access passed the component-improvement screen, supporting a further controlled document experiment rather than replacing reliable tools. Those routes remain outside product chat. The 40 documents are fictional test fixtures; there is no product upload workflow, and the assignment does not require one. Mastra was not added.

The older study's [two-page explanation](docs/reports/daybook-ai-explained.pdf), [narrative](docs/reports/research-study.md), [graphs](docs/evidence/research-runs/holdout-v1/report.html), [worked failures](docs/reports/research-worked-examples.md), [cost record](docs/evidence/research-final-costs/cost-reconciliation.md) and [reproduction guide](docs/research/REPRODUCE.md) preserve its results and limitations. That study's source and approximately $6.05 closed allowance are historical; they were not reopened for the product repair.

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

The [beginner accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) explains the numbers, and the [architecture](docs/ARCHITECTURE.md) provides implementation details and research sources. The [demo and interview guide](docs/INTERVIEW_GUIDE.md) explains the design in practical terms. [API reference](docs/API.md), [product completion plan](docs/PRODUCT_PLAN.md), and [build log](docs/BUILD_LOG.md) record implementation details and decisions. The [Daybook design record](docs/DESIGN.md) explains the visual identity, downloaded design skills, interaction rules, and before/after evidence.

## Deliberate boundaries

This is a single configured workspace application, as authentication was excluded from the assignment. Organization-scoped tables and composite foreign keys prepare the data model for tenancy; they do not replace production authentication, authorization, or row-level security. Compose binds the UI/API to localhost.

Reports use historical recorded exchange rates. Automated period-end revaluation, tax, inventory, invoice lifecycle management, bank reconciliation, and formal period closing are outside this implementation. Production financial insights support four explicit query families and clarification. Broader analysis and Wren-planned SQL exist only in the isolated experiment, behind bounded query checks and a restricted reader.

The design includes concurrency controls and bounded work that support growth. **Million-user capacity has not been load-tested or claimed.** The architecture document describes the workload assumptions, operational requirements, and measurements needed to earn that claim.

## Hosted demo and continuation

Open [Daybook](https://daybook-ledger-delta.vercel.app) and sign in with the owner's Vercel account if prompted. Hosting uses Vite static output, Express Functions and Neon PostgreSQL. Vercel protection controls access to the shared writable demo; application-level identity is outside assignment scope. Reviewer access is still to be decided.

[Hosting](docs/HOSTING.md) explains the build-only migration credential, restricted runtime role, native ESM bundle, daily scheduler and deployment-variable requirements. Production values were supplied as deployment overrides, so a fresh CLI deploy needs explicit private configuration; a repository push is not a configured Vercel auto-deploy. Docker remains the complete portable startup path.

The hosted trial balance and balance sheet had zero differences. Scheduler authorization and an authorized batch passed. The 11-request AI acceptance passed; general live accuracy, automatic daily firing and fresh hosted browser visual inspection remain unverified. Larger job backlogs can wait for later hosted invocations; this is not a measured million-user deployment.

Research provider work is complete. Total tracked research usage is approximately **$6.05**, including development and unknown-use reservations; the funded continuation accounts for **$5.27** of that total. Its Gemini/Jev portions stayed below the authorized $6.40/$0.10 additional caps. These are configured-rate estimates and retained reservations, not invoices. Source, data, historical outcomes and budget policies remain preserved. The [checkpoint](CHECKPOINT.md) records delivery verification and separate product checks, including hosted visual review, physical-device checks and reviewer sharing. Do not reset the database, rerun completed measurements, or retune this holdout as though it were unseen.
