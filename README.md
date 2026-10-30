# Daybook · Accounting workspace

> Updated 2026-10-29: Gemini/OpenAI adapters, bounded evaluation and the simpler interface are implemented. Compilation and isolated tests pass; the latest database/browser runs and live AI remain pending because this session blocks local sockets, browser launch and provider DNS. See [CHECKPOINT.md](CHECKPOINT.md) for the exact verification state.

A React and TypeScript accounting workspace backed by PostgreSQL. Every posted journal entry is balanced and immutable at the database level. AI prepares entries for review and selects read-only financial queries; the ledger and SQL own the financial numbers.

![Daybook financial dashboard](docs/evidence/dashboard.png)

The screenshot records the earlier verified design. The new Home / Transactions / Reports / Settings interface still needs fresh browser screenshots.

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

Leave `AI_MODEL` empty to use the provider default: `gemini-3.8-flash` or `gpt-6-luna`. For OpenAI, set `AI_PROVIDER=openai` and `OPENAI_API_KEY`. Remove any stale model override when switching providers. Keys remain on the server and are excluded from version control, Docker images, and the submission. Restart the local server after changing `.env`, or recreate the Compose app:

```sh
docker compose up -d --force-recreate app
```

Use a model your project can access. Gemini's default was selected from Google's current [model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). Provider access, quotas and live quality still require verification. With no key, manual accounting, reports, recurrence, and statistical alerts continue working.

Start with the bounded four-case smoke evaluation against a running, migrated database:

```sh
npm run ai:evaluate -- --suite smoke
```

The harness contains 40 labeled cases: 20 development and 20 reserved for holdout. It checks complete entries, exact query arguments/evidence, correction retrieval, and unchanged journal history. Clarification meaning is explicitly left for human review. It creates two new synthetic workspaces and predefined fixture postings; **model responses are never posted and your demo workspace is untouched**. Runs may incur provider charges. Attempts are capped, automatic retries are disabled, and observed token usage stops later requests; this is not an absolute billing ceiling. Results go to `docs/evidence/ai-evaluations/` and `ai-evaluation.json`. See `npm run ai:evaluate -- --help` and [verification](docs/VERIFICATION.md).

With Compose, use the dedicated evaluation profile, which has administrative access only for creating its isolated fixtures. The normal app retains its restricted database role:

```sh
docker compose --profile evaluate run --build --rm evaluate
```

No successful live model evaluation is claimed yet. Jev, semantic vectors, Mastra and Wren remain optional experiments.

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

| Requirement                 | Implementation                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Double entry                | Exact decimals, 2–100 lines, balanced USD base amounts, deferred PostgreSQL constraints                |
| Chart of accounts           | Tree, unique codes, five account types, create/edit/archive/restore/delete unused accounts             |
| Journal                     | Simple USD form, full manual/FX entries, AI clarification and review, drafts, revisions and reversals  |
| Currency                    | USD base; USD, EUR, GBP, CAD, JPY accounts; stored rates and native/base balances                      |
| Recurrence                  | Weekly/monthly/yearly, calendar anchors, automatic drafts, edit future content, pause/resume, recovery |
| Reporting                   | Trial balance, P&L, balance sheet, account ledger with opening/running balances, filters and CSV       |
| Transactions                | Search, account/date/status/currency filters, cursor pagination, entry drill-down                      |
| AI entry and categorization | Structured proposals, clarification, account validation, relevant history and correction retrieval     |
| Anomaly detection           | Duplicate matching, median amount deviations, unusual vendor categories, review/dismissal              |
| Insights                    | Allowlisted financial tools, SQL-derived answers, evidence and links to the underlying views           |
| UX                          | Four primary destinations, explicit account-effects review, accessible controls and progressive detail |
| Operations                  | Migrations, Docker Compose, health checks, request IDs, outbox jobs, automated CI configuration        |

Categorization happens during AI-assisted creation; this submission does not include a bank-feed or CSV-import workflow. Correction retrieval improves the context of later suggestions; it is not model fine-tuning.

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

The persistence command recreates app/database containers and checks that a complete existing posted entry survives; it preserves the named volume and makes no journal writes. Run it after Compose startup. CI includes this check, but no remote CI run is claimed.

The earlier verified baseline was **29 database tests, 8 provider contracts and 8 browser workflows**. The new provider/evaluation isolated tests pass; the revised PostgreSQL contracts and browser workflows need a new runtime run. Full Docker startup and physical-phone checks remain pending. See [verification details](docs/VERIFICATION.md) for current counts and boundaries.

## Reading the code

```text
db/migrations/    PostgreSQL constraints, permissions, revisions, provenance
server/ledger.ts  One entry creation/posting/reversal path
server/reports.ts Posted-journal financial queries
server/ai.ts      Shared proposal validation and approved financial tools
server/ai-provider.ts  Gemini/OpenAI adapters, safe errors, usage and budgets
server/recurring.ts / anomalies.ts  Bounded durable background work
server/app.ts    Validated REST API and error responses
shared/          Money arithmetic and TypeScript/Zod contracts
web/src/         React pages, forms and reusable UI
tests/           Real PostgreSQL tests, provider contracts, browser workflows
scripts/         Migration, resumable seeding, dev launcher, live AI evaluation
```

Start with the eight-page **[visual architecture report](docs/reports/architecture-review.pdf)** or its **[interactive HTML version](docs/reports/architecture-review.html)**. This is the planning snapshot from before the Gemini/interface implementation; it explains the research, responsibility boundaries and evaluation plan. Use the checkpoint for current execution status.

The [beginner accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) explains the numbers, and the [architecture](docs/ARCHITECTURE.md) provides implementation details and research sources. The [demo and interview guide](docs/INTERVIEW_GUIDE.md) explains the design in practical terms. [API reference](docs/API.md), [delivery plan](docs/PLAN.md), and [build log](docs/BUILD_LOG.md) record implementation details and decisions. The [Daybook design record](docs/DESIGN.md) explains the visual identity, downloaded design skills, interaction rules, and before/after evidence.

## Deliberate boundaries

This is a single configured workspace application, as authentication was excluded from the assignment. Organization-scoped tables and composite foreign keys prepare the data model for tenancy; they do not replace production authentication, authorization, or row-level security. Compose binds the UI/API to localhost.

Reports use historical recorded exchange rates. Automated period-end revaluation, tax, inventory, invoice lifecycle management, bank reconciliation, and formal period closing are outside this implementation. Financial insights support four explicit query families and clarification; arbitrary SQL and unrestricted analysis are intentionally unavailable.

The design includes concurrency controls and bounded work that support growth. **Million-user capacity has not been load-tested or claimed.** The architecture document describes the workload assumptions, operational requirements, and measurements needed to earn that claim.
