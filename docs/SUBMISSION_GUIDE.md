# Daybook — reviewer setup and reading guide

This is Rayid Ali's submission for the [original Spiich accounting assignment](ORIGINAL_ASSIGNMENT.md). The application is React + TypeScript, an Express REST API, and PostgreSQL. The normal review setup needs **Docker Compose and your own Gemini API key**. It does **not** require Neon, Vercel, Querio, TypeSafe/Jev, Wren, pgvector or a research environment.

## Start locally with Docker

1. Clone the submission repository:

   ```sh
   git clone https://github.com/Spiich/spiich-accounting-assignment-rayid-ali.git
   cd spiich-accounting-assignment-rayid-ali
   cp .env.example .env
   ```

2. Open `.env` in your editor and set `GEMINI_API_KEY` to your own key. Retain these settings:

   ```dotenv
   AI_PROVIDER=gemini
   GEMINI_API_KEY=your_key_here
   CATEGORY_PROVIDER=gemini
   NATIVE_ANALYST_ENABLED=true
   AI_MODEL=
   ANALYST_MODEL=gemini-3.8-flash
   ```

   Leave `QUERIO_API_KEY`, `QUERIO_WORKSPACE_ID`, `TYPESAFE_API_KEY` and `OPENAI_API_KEY` blank. The example key above is a placeholder. `.env` is ignored by Git and excluded from container build context. Keep the actual key out of frontend variables and commits.

3. Start the complete stack:

   ```sh
   docker compose up --build
   ```

4. Open **http://localhost:3001**. For the Gemini analyst, open **http://localhost:3001/analyst?tab=daybook**. The submitted UI also selects Daybook by default when opening Ask.

Startup waits for PostgreSQL health, applies the nine checksummed migrations, seeds a fictional Northstar Studio workspace, and starts the application and background processing. No manual database provisioning, SQL import or hosted credential is required. The first image build can take several minutes. The demo dates are anchored to the first seed, so a new local database can differ from the older hosted examples in the reports.

**Model access:** whole-entry generation and categorization use `gemini-3.5-flash-lite` by default; the native SQL analyst is pinned to `gemini-3.8-flash` with its own usage-accounting contract. The key's Google project must have access and sufficient quota for the applicable model. Do not assume an arbitrary `ANALYST_MODEL` override is supported: the native transport validates the pinned model. `AI_MODEL` controls the separate whole-entry/legacy-chat provider, not categorization or the native analyst. Key presence in `/api/meta` is configuration, not proof of a successful provider call.

Manual accounting, reports, recurrence and rule-based alerts run without any model key. AI requests incur usage on the supplied key. Ordinary startup and the standard CI checks do not intentionally run paid model evaluations. Native questions can take several minutes because they investigate, execute tools and recheck results; progress and Stop are available.

## Manage the local stack

```sh
# Inspect service health and recent application output.
docker compose ps
docker compose logs --tail=100 app migrate

# After editing the key/settings, recreate the app to load them.
docker compose up -d --force-recreate app

# Stop containers while preserving the PostgreSQL data volume.
docker compose down
```

The named volume is `spiich_postgres_data`; that historical identifier is intentionally retained. Do not delete the volume if you want to keep your entries. This local database does not synchronize with the public demo. The application exposes port 3001 on localhost; PostgreSQL need not be exposed to your host.

An empty journal can be chosen with `SEED_DEMO=false` **before the first startup**. Changing it later does not erase existing demo records. If port 3001 is occupied, stop the conflicting process or adjust the app port mapping and browser URL.

## Optional Node development setup

With Node 22.12+ and npm installed:

```sh
npm ci
npm run dev
```

If both database URLs remain unset as in `.env.example`, the launcher starts an isolated real PostgreSQL server and retains its data under `.tools/postgres`. The frontend is at http://localhost:5173, API at port 3001, and local PostgreSQL at 55432. Compose is the primary cross-platform review path; the convenience launcher was exercised on macOS arm64. Do not run both launchers against the same host ports.

## Suggested review flow

1. **Home:** inspect recorded cash, income, expenses and recent activity. These are posted-book values, not bank-reconciled balances.
2. **Transactions:** add a $500 office-supplies purchase, choose its actual payment account, and inspect both debit/credit effects. Save a draft, then explicitly post it. Posted records cannot be edited; correction uses a linked reversal.
3. **Reports:** inspect trial balance, P&L, balance sheet and an account ledger. Use matching dates when comparing totals.
4. **Settings:** inspect the chart of accounts and recurring templates. Due occurrences generate drafts for review; they are not automatically posted.
5. **Alerts:** inspect the deliberately unusual rent and possible duplicate demo records. The rent example is seeded data; detection is a general median rule, not a hard-coded landlord or dollar amount.
6. **AI entry:** try “Bought office supplies for $340 using the company credit card.” Review the proposed accounts before posting. An omitted payment account or unclear personal/business purpose should prompt clarification.
7. **Ask → Daybook:** try “What is my current recorded cash balance?”, “For every month this year, show rent as a percentage of total expenses, with a chart”, or “Show transactions with Adobe, including drafts separately.” Inspect the notebook's tables, charts and source queries.
8. **Follow-up/scenario:** provide actual assumptions, for example a monthly salary and employer-cost percentage. The analyst can calculate a labeled scenario; it does not know an employee's salary or external bank settlement unless those facts are supplied or recorded.

The optional Querio tab/adapters and Jev selector remain in source for the comparative work. Their credentials are not needed for the flows above. The research environment is separate and is not started by ordinary `docker compose up`.

## Public demo

**https://daybook-ledger-delta.vercel.app/analyst?tab=daybook**

On November 4, at the owner's explicit request, the production domain was made public and checked without authentication. Generated deployment URLs/previews remain protected. The hosted runtime remains the previously released application; this submission's small default-tab change is a local/source update, not a new hosted backend release.

The hosted demo is a shared fictional workspace without application-user authentication. Visitors can change demo records and use its configured AI allowance; please do not enter confidential or real financial information. For isolated review and your own Gemini credentials, use Docker. Provider keys remain server-side. The database invariant checks still apply to public requests; public access is not a new security certification.

## Architecture and reports to read

Start with these files; historical experiments are optional background.

| File                                                                | What it explains                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Submission architecture PDF](reports/submission-architecture.pdf)  | Current accounting/Gemini architecture, data and safety boundaries, setup and measured limits.                                 |
| [Analyst comparison PDF](reports/analyst-workspace-comparison.pdf)  | Native/Querio experiment, notebook flow, actual scores and limitations. Querio is not required to run the submission.          |
| [Category learning PDF](reports/category-learning-explained.pdf)    | How posted corrections become examples; separate Gemini/Jev results. Jev is not required.                                      |
| [Complete Markdown knowledge base](MEETING_NOTES_KNOWLEDGE_BASE.md) | Detailed code walkthroughs, table inventory, original assignment and interview explanations. This is a dated release snapshot. |
| [Current native analyst design](NATIVE_ANALYST.md)                  | Generated SQL, durable turns, scoped views, publication and failure limits.                                                    |
| [API reference](API.md)                                             | REST resources, draft/post/reverse and analyst conversation contracts.                                                         |
| [Research paper](reports/research-study.md)                         | Historical nine-route RAG/vector/File Search/Wren/reviewer study, isolated from the current product.                           |

The older `architecture-review.pdf` describes an earlier design discussion. Use `submission-architecture.pdf` for the current handoff. Historical source IDs/scores remain historical; later UI or access changes do not create new accuracy results.

## Code reading order

1. `shared/schema.ts` and `shared/money.ts`: runtime contracts and exact decimal amounts.
2. `db/migrations/001_ledger.sql`, then later migrations: deferred balance checks, immutable posting, ownership and operational tables.
3. `server/ledger.ts` and `server/ledger-validation.ts`: draft, review revision, post, idempotency and reversal.
4. `server/reports.ts`: posted-only reporting, signs, date boundaries, saved FX and consistent read snapshots.
5. `server/recurring.ts`, `server/anomalies.ts`: recurring drafts, outbox jobs, general anomaly rules and lifecycle.
6. `server/categorization-memory.ts`, `server/category-service.ts`, `server/category-selector.ts`: reviewed-posting learning and narrow classification.
7. `server/native-analyst-service.ts`, `server/analyst-sql.ts`, `server/analyst-notebook.ts`, `server/analyst-claims.ts`: flexible read-only investigation and inspectable publication.
8. `server/analyst-store.ts`, `server/analyst-model.ts`: durability, worker ownership, transport and usage limits.
9. `server/app.ts`: Express REST boundary; `api/` and `server/hosting/` are Vercel adapters, not a second backend.
10. `web/src/`: React pages, entry composer, shared analyst interface and notebook rendering.

The backend is organized by capability. It deliberately uses explicit parameterized SQL rather than an ORM, and does not uniformly enforce separate controller/service/repository files. `research/` and evaluation scripts contain historical alternatives; they are not all invoked in one production request.

## Verification and limitations

For the containerized database suite, while the normal stack is running:

```sh
docker compose --profile test run --rm tests
```

For TypeScript/build checks with Node dependencies installed:

```sh
npm ci
npm run build
npm run format:check
```

The repository's standard GitHub workflow also exercises real PostgreSQL, browser workflows and Compose persistence without model inference. Live-AI jobs are separately opt-in and require credentials; do not enable them merely to run ordinary checks. Historical release evidence records 3,366 normal tests and 60 browser workflows; Compose's 3,365 overlapping tests are not additive. New handoff verification is recorded separately in `docs/evidence/submission-handoff.json` when complete.

Important limits:

- Balance checks enforce arithmetic consistency; a balanced entry can still use the wrong category.
- Model-written SQL is parsed, restricted and read-only. The query can still misunderstand a question's period, account or denominator.
- Before native publication, selected queries are rechecked together. Recognized money/percentage literals require selected numeric support or explicit user input. Matching a number does not prove its meaning.
- There is no bank feed, document-upload workflow, application-user authentication, full invoice/payment allocation, automatic FX revaluation or verified million-user capacity.
- Base currency is USD, and current business-date helpers use America/New_York. Multiple account currencies are supported; these are not unrestricted user-configurable currency/timezone policies.
- Amount anomaly detection requires at least **four** comparable positive historical samples. The seeded $2,400/$4,800 rent illustrates the rule; those amounts are not detector constants.
- Three hosted model turns passed separate financial review but took 94–321 seconds. The last full development comparison and subsequent repairs have different sources; no universal-accuracy or overall-superiority claim is made.
