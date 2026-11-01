# Daybook · Accounting workspace

A React and TypeScript accounting application with a REST API and PostgreSQL. Record transactions, review balanced entries, manage recurring drafts, and inspect financial reports. AI suggests entries and categories for your approval; database constraints protect posted history.

Open the [protected hosted demo](https://daybook-ledger-delta.vercel.app), or start the complete application with Docker below. No API key is needed for manual accounting, reports, recurrence or statistical anomaly alerts.

**Current status:** the hosted app uses the deployed `composable` chat route at source `93a8617`. A repaired candidate has passed full CI; comparison work for broader questions is ongoing, with no new winner or deployment decision. Earlier failed runs and diagnostic calls remain separate evidence. [Release](docs/evidence/compound-grouping-release.json) · [Current verification](docs/VERIFICATION.md) · [Goal and remaining work](docs/GOAL_AUDIT.md).

## Run with Docker Compose

Requires Docker Engine/Desktop with Compose v2.

```sh
docker compose up --build
```

Open **http://localhost:3001**. Startup waits for PostgreSQL, applies checksummed migrations, seeds the workspace, then starts the application. Data persists in a named volume; subsequent starts keep existing records.

The Northstar Studio demo includes 22 accounts, six months of activity, an unpaid invoice, a EUR receipt, a draft, recurring schedules and unusual/duplicate expenses to inspect. Dates are anchored to the first seed run; restarting never shifts posted history.

## Try the everyday workflow

1. Start on **Home** to see cash, income, expenses and alerts.
2. Create a transaction manually, or describe it to the AI after connecting a provider. Review the accounts, amount, currency and date. An unclear request should ask for details.
3. Save a **draft** while reviewing; **post** when ready. Posted entries cannot be edited. Use a linked reversal to correct them.
4. Open **Transactions** to search and inspect entries, **Reports** for the trial balance, profit/loss, balance sheet and account ledger, and **Settings** for accounts and recurring schedules.

For example, a $340 office-supplies purchase on the company card debits Supplies and credits the card liability. If you change an AI-suggested category and post the reviewed entry, the server remembers that correction atomically. Saving a draft alone does not teach it; forgetting or reversing the example removes its teaching effect. This supplies examples to later suggestions, rather than retraining model weights.

The [beginner accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) explains the numbers. The [demo and interview guide](docs/INTERVIEW_GUIDE.md) provides a short presentation and worked examples.

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

The short-form **Suggest category** action chooses an expense/revenue category while code preserves the fixed amount and payment account. Loans, transfers, invoice settlements and more complex entries use the full-entry workflow. Suggestions require review and cannot post themselves. [Category selector](docs/CATEGORY_SELECTOR.md) · [Assignment checklist](docs/ASSIGNMENT_REVIEW.md).

## Local development without Docker

Requires Node 22.12+ and npm. The convenience launcher uses an isolated, real PostgreSQL server through `embedded-postgres`; local data stays in `.tools/postgres`.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on port 3001 and PostgreSQL on 55432. Ctrl-C stops the servers and preserves data. Restart the command after adding a key to `.env`.

To use your own PostgreSQL, set both database URLs shown in `.env.example`. `MIGRATION_DATABASE_URL` must permit migrations and role creation; `DATABASE_URL` uses the restricted `spiich_app` role. The launcher skips embedded PostgreSQL when `DATABASE_URL` is set. The portable launcher was exercised on macOS arm64; Compose is the cross-platform submission path.

Set `SEED_DEMO=false` **before the first start** for an empty journal with the default chart. It does not erase an already seeded workspace.

## Connect AI when ready

Gemini and OpenAI are supported. Copy `.env.example` to `.env` only if you do not already have one, then configure your provider locally:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

Leave `AI_MODEL` empty to use the configured provider default: `gemini-3.5-flash-lite` or `gpt-6-luna`. For OpenAI, set `AI_PROVIDER=openai` and `OPENAI_API_KEY`; remove any stale model override when switching. Use a model your project can access. Keys stay on the server and are excluded from source, Docker images and the submission.

Restart the local server after changing `.env`, or recreate the Compose app:

```sh
docker compose up -d --force-recreate app
```

`CATEGORY_PROVIDER=gemini|jev|reference` is server-controlled; Gemini remains the measured category default. Jev uses `TYPESAFE_API_KEY`. The offline reference provides a simpler comparison. Neither setting changes the whole-entry provider. Changing local `.env` does not update a deployed Vercel configuration.

Entry/category requests are not automatically retried. Financial chat has bounded planning and schema-repair attempts; transport, semantic and database failures do not trigger a schema retry. Errors include a copyable request reference. Without a key, the manual workflows still work. [API](docs/API.md) · [Provider repair and its limits](docs/evidence/provider-compatibility-20261101/report.md).

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

The persistence command recreates app/database containers and checks that an existing posted entry survives. It preserves the volume and makes no journal writes; run it after Compose startup.

[Verification](docs/VERIFICATION.md) records exact-source CI results, skipped tests and deployment history. Tests cover real PostgreSQL constraints, independent report arithmetic, correction memory, browser workflows, native hosted imports and Docker persistence. Provider responses in ordinary CI are scripted; passing those tests is not a live-model accuracy score. Browser checks use the CI build, not a fresh hosted or physical-device inspection.

Provider evaluations are separate, optional runs that need an explicit allowance and disposable fixtures. Read [Product AI evaluation](docs/PRODUCT_AI_EVALUATION.md) before using `npm run ai:evaluate`; its original 40-case whole-entry evaluation remains incomplete. Do not reopen a completed comparison or reuse a closed budget.

## AI decisions and measured results

The model interprets requests and chooses permitted operations. SQL and exact arithmetic calculate the money. The deployed chat supports account/vendor/date filters, compound groupings, cash movement, balances and supported calculations, alongside existing report tools. It cannot execute arbitrary SQL or post entries. [Query architecture](docs/ARCHITECTURE.md) · [Grouped spending](docs/COMPOUND_GROUPING.md) · [Cash movement](docs/CASH_MOVEMENT.md).

**Categorization is measured and complete.** Gemini and Jev received identical fixed facts and prior examples. Both chose semantically acceptable accounts on 33 held-out category inputs; Gemini also followed the taught business preference in **33/33**, Jev in **31/33**. Jev was cheaper but failed the predefined reliability condition for replacement. Gemini remains the narrow selector default. These 33 inputs come from eleven scenario sequences, not 33 independent businesses. The experiment measures use of supplied context; database retrieval quality and general production accuracy remain separate. [Results](docs/evidence/category-runs/completed-v3/holdout/report.md) · [Audit](docs/evidence/category-runs/completed-v3/independent-audit.json) · [Decision](docs/evidence/category-runs/completed-v3/release-decision.json) · [Two-page PDF](docs/reports/category-learning-explained.pdf) ([HTML](docs/reports/category-learning-explained.html)).

**Broader chat comparison is ongoing.** The optional `adaptive` route can inspect results before choosing another operation. The optional `complete` route also checks declared requested outputs and can finish supported missing arithmetic using verified cached results, without another database or model call. It does not prove that the initial declaration captured everything the user meant. These candidates are not the hosted default. The earlier development run stopped on a provider compatibility failure; its failed outcomes and unknown-use reservation remain preserved. The subsequent repair and diagnostic probes are not a comparative result. [Current goal audit](docs/GOAL_AUDIT.md) · [Completion behavior](docs/ANSWER_COMPLETENESS.md) · [Failed development evidence](docs/evidence/completeness-runs/development-v1/report.md).

Earlier comparisons remain tied to their original source: the [composable-query PDF](docs/reports/chat-query-comparison.pdf) and [adaptive comparison PDF](docs/reports/adaptive-comparison-explained.pdf) explain their findings and limitations. Their scores cannot be assigned to the repaired candidate. [Adaptive design and evidence](docs/ADAPTIVE_CHAT.md) · [Reliability chronology](docs/CHAT_RELIABILITY.md).

The older nine-route research study tested lexical documents, Gemini File Search, embeddings/pgvector, Jev, Wren and reviewers in an isolated harness. Those retrieval/reviewer routes are not enabled in product chat. The documents were fictional fixtures; there is no product upload workflow, and Mastra was not added. Its approximately $6.05 tracked allowance is closed. [Two-page explanation](docs/reports/daybook-ai-explained.pdf) · [Narrative](docs/reports/research-study.md) · [Graphs](docs/evidence/research-runs/holdout-v1/report.html) · [Worked failures](docs/reports/research-worked-examples.md) · [Costs](docs/evidence/research-final-costs/cost-reconciliation.md) · [Reproduction](docs/research/REPRODUCE.md).

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

The [architecture](docs/ARCHITECTURE.md), [API reference](docs/API.md), [product completion plan](docs/PRODUCT_PLAN.md) and [build log](docs/BUILD_LOG.md) explain implementation and decisions. The [design record](docs/DESIGN.md) covers the interface and its evidence. The older [visual architecture report](docs/reports/architecture-review.pdf) and [interactive HTML](docs/reports/architecture-review.html) preserve a planning snapshot; consult the [checkpoint](CHECKPOINT.md) for current status.

## Deliberate boundaries

This is a single configured workspace application, as authentication was excluded from the assignment. Organization-scoped tables and composite foreign keys do not replace production authentication or authorization. Compose binds the UI/API to localhost.

Reports use recorded exchange rates. Automated revaluation, tax, inventory, invoice lifecycle management, bank reconciliation and formal period closing are outside this implementation. Noncash balance operands in scenarios, unrestricted forecasting and general result-set joins remain unsupported. Missing facts require clarification; a correct calculation alone does not prove the chosen records answer the question. CSV import, bank feeds and document uploads are optional extensions, not required assignment workflows.

Request admission and bounded work protect the prototype, but million-user capacity and perfect interpretation have not been established. Current-source model quality, hosted visual/physical-device usability and automatic hosted cron firing must not be inferred from CI counts.

## Hosted demo and handoff

The [hosted demo](https://daybook-ledger-delta.vercel.app) uses Vercel protection around a shared writable workspace. Reviewer access still needs an owner-approved sharing arrangement. Hosting combines the Vite frontend, Express Functions and Neon PostgreSQL; Docker remains the portable submission path.

[Hosting](docs/HOSTING.md) explains build-only migration credentials, the restricted runtime role, daily scheduler and deployment variables. A fresh CLI deployment needs explicit private configuration; a repository push is not a configured Vercel auto-deploy.

The [current release receipt](docs/evidence/compound-grouping-release.json) binds the protected hosted source. Earlier selected AI checks remain historical: [three date-scope cases](docs/evidence/chat-history-acceptance.json) and [eleven category/entry checks](docs/evidence/category-hosted-acceptance-audit.json). No new hosted model result is implied by the repaired candidate's CI. The [checkpoint](CHECKPOINT.md) records exact source/archive verification and the next authorized work. Preserve existing books, frozen outcomes and closed budgets.
