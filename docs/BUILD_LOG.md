# Build log

> Checkpoint updated 2026-10-29. The user requested a session checkpoint after the completed Daybook redesign. Current state, continuation instructions, and outstanding checks are saved in [CHECKPOINT.md](../CHECKPOINT.md).

This is the running engineering record for Daybook, built for the Spiich assignment. Completed work and observed checks are recorded separately from plans. No scale or verification claim is implied by a planned item.

## 2026 10 28 Initial decisions

- Started from an empty workspace. The user authorized an AI-assisted implementation and requested a record they can use to explain the work.
- Target: a complete React and TypeScript accounting application backed by PostgreSQL, runnable with Docker Compose.
- Use a modular backend with one shared posting path. PostgreSQL owns balance and immutability constraints; UI and API checks provide helpful errors.
- Use exact decimals and persisted transaction exchange rates. Never use JavaScript floating point for financial calculations.
- Design organization-scoped data and composite foreign keys, idempotent writes, bounded pagination, and durable database jobs. Authentication is outside this assignment; production tenant identity must come from authentication, not an arbitrary client header.
- Keep live AI behind a server-side provider boundary. A key will be supplied later. Show explicit unavailable states until configured; do not disguise canned responses as AI.
- This machine has Node.js and PostgreSQL client tools, but no Docker executable or PostgreSQL server. Investigating an isolated, real PostgreSQL installation for local integration tests. Compose verification remains outstanding.

## Implementation sequence

1. Database migrations, accounting invariants, exact money, posting and reversal.
2. Financial queries and deterministic accounting tests against PostgreSQL.
3. Recurring drafts, durable anomaly jobs, correction history, AI tools.
4. React dashboard, journal workflows, account management, reports, chat and recurrence.
5. Browser verification, failure cases, reproducible setup, demo guide and architecture review.

## Scale commitments

Data boundaries, correctness under concurrency, bounded work, and operational visibility belong in this implementation. A claim of a million-user capacity requires measured load tests, deployment sizing, authentication, rate controls, backups, recovery exercises, and operational ownership. These will be described as production work unless actually implemented and verified.

## 2026 10 28 Ledger and reporting completed

- Implemented an explicit PostgreSQL schema with organization-scoped foreign keys, exact numeric amounts, generated base values, account-tree rules, deferred balancing, immutable posted records, and exact linked reversals.
- Added a restricted runtime database role. Migrations use an administrative connection, checksums, and an advisory lock; ordinary application writes cannot disable the guards.
- Used per-entry locking to serialize line edits and posting. Added request hashes/idempotency keys for retries, then revision checks for stale browser reviews.
- Implemented the four requested reports directly from posted journal lines. Balance-sheet equity includes all unclosed profit, including earlier years. Ledger running sums include their pre-period opening balances.
- Supported five account currencies with USD as the explicit base. Rates are persisted per line, quoted in USD per foreign unit. Automatic revaluation is a documented boundary.
- Installed isolated native PostgreSQL for tests because Docker was unavailable. These are real database integration tests, not an in-memory substitute.

## 2026 10 28 Background and AI workflows completed

- Added a transactional outbox. Posting and its analysis job commit together. Workers use bounded claims, expiring leases/tokens, heartbeats, backoff, and a terminal failed state.
- Added duplicate, native-currency median deviation, and vendor-category signals with visible evidence. Reprocessing preserves dismissals and never changes financial records.
- Implemented weekly/monthly/yearly schedules with retained calendar anchors and deterministic occurrence keys. Concurrency tests verify no duplicate due entries.
- Found that an invalid template could block an entire scheduler batch. Added per-template savepoints, automatic pause/error messages, future-template editing, and stale-schedule protection. Existing occurrences remain unchanged.
- Implemented strict structured AI proposals, clarifications, account validation, relevant historical examples, and confirmed correction retrieval. Proposals do not write to the journal.
- Implemented four read-only insight tools plus clarification. SQL supplies all monetary results; application code composes answers and evidence links. No arbitrary SQL executor exists.
- Consulted official OpenAI documentation. Replaced the initial GPT-4.1 Mini default after current documentation identified it as deprecated. The configurable default is GPT-6 Luna with low reasoning effort. No API calls were made because the user will supply a key later.
- Added eight provider-contract tests and a separate opt-in eight-case live evaluation command. These are explicitly different forms of evidence.

## 2026 10 28 Product and verification completed

- Built a responsive React workspace: dashboard, chart CRUD, transaction search/filter/pagination, manual/AI forms, reports/CSV, account ledgers, recurrence management, alert review, and insights chat.
- Added keyboard focus handling, accessible labels, real empty/loading/error states, and an explicit disconnected-AI state. Removed misleading nonfunctional controls.
- Browser testing found a React scroll-effect crash in the assistant. Fixed it and added an error boundary. Backend tests found/guarded the historical balance-sheet cutoff case and malformed cursors.
- Preserved cents during display of very large balances using exact formatting instead of passing amounts through `Number`.
- Made demo seeding resumable with a persisted seed date and completion marker. Future current-month demo dates clamp to the seed date. Intentional demo alerts are calculated immediately.
- Early browser verification used the initial demo workspace. Subsequent browser suites use a fresh isolated organization. The final default demo uses a separate clean organization; earlier test history is retained, not deleted or rewritten.
- Recorded 37 passing database/provider-contract tests and seven passing production browser workflows. Saved desktop, report, and mobile screenshots.
- Added Prettier and strict unused-code compiler checks; formatted the source for review. Removed an unused development dependency.
- Validated Compose configuration with a checksum-verified Compose v2.40.0 executable. Full container execution is still pending because this machine lacks a Docker daemon.
- Added CI for type/build/format checks, PostgreSQL tests, production browser workflows, and Docker Compose startup/tests. No remote CI run is claimed.
- Wrote the beginner accounting walkthrough, architecture/scaling explanation, API reference, one-day delivery plan, demo/interview guide, and verification record.
- Rechecked the standalone local database/test lifecycle and a normal dev startup. The clean demo retained exactly 72 posted entries, one draft, and three alerts across restart. Added idempotent signal handlers after a repeated-interrupt shutdown error. The final attempt to stop the new preview was rejected by the environment's automatic approval policy, so the local preview remains running at handoff.

## 2026 10 28 Daybook identity and interface revision

- The user requested an independent product name and a less generic interface, and supplied Emil Kowalski's skills repository. Downloaded a versioned snapshot locally and applied its design-engineering and mobile guidance. See [source provenance and design decisions](DESIGN.md).
- Renamed the product to Daybook across the interface, title, SVG identity/favicon, package, exports, and Compose project. Kept checksummed accounting migrations and existing database identifiers intact; explicitly retained the original Compose volume name for data continuity.
- Replaced the mint card layout and AI promotional copy with a neutral accounting workspace, a divided financial summary, a grouped monthly chart, and an actionable draft/alert review column.
- Added an accessible chart-data table, responsive chart coordinates, date-preserving drill-down links, and mobile recent-entry rows that keep amounts visible.
- Applied gated hover, touch input sizes, safe-area padding, dynamic viewport units, reduced-motion handling, and immediate keyboard-triggered interactions. Added focus containment/restoration for the mobile menu and corrected overlapping toast timers.
- Kept AI unavailable until configured. Added an availability guard to keyboard submission in the insights chat, matching its disabled send button.
- Production build and eight browser workflows passed. Visually inspected desktop, account, report, recurrence, journal, and mobile evidence. Physical-device behavior remains unverified and is called out in the design record.
- Updated the README, verification record, demo explanation, screenshots, and submission archive for the new identity.

## 2026 10 29 Session checkpoint saved

- The user asked to close the session and resume later. Updated all nine first-party Markdown documents and added root `CHECKPOINT.md` and `AGENTS.md` for discoverable continuation context.
- Recorded the completed Daybook identity/redesign, downloaded skill provenance, verified test baseline, runtime restart paths, persistent database locations, and pending live AI/Docker/phone checks.
- The app and database were still listening at handoff inspection. Existing processes may stop when the session or machine closes; the checkpoint explains how to resume without erasing local data.
- No application source, schema, posted records, credentials, or dependencies were changed for this checkpoint. There is no Git repository or commit to reference; the saved files and refreshed ZIP are the handoff artifacts.
- Checked documentation formatting and local links, then rebuilt and integrity-checked the submission archive. Historical test evidence remains 37 backend/provider tests and 8 production browser workflows passing.

## 2026 10 29 Resumed; Gemini feasibility and cost constraint

- Read the checkpoint and inspected the actual AI implementation. It uses OpenAI Responses for structured proposals and allowed function selection; Gemini is not a drop-in key replacement.
- The user has a Gemini key available and allows only free-tier usage. Recorded this constraint in the checkpoint, continuation instructions, README, and delivery plan.
- Checked Google's current primary documentation for free model availability, project-level billing, rate limits, structured output, and OpenAI compatibility. A Gemini provider adapter is feasible; project-tier confirmation and the actual key are still needed before calls. No model/provider calls were made.
- The local servers were stopped. Restarted the preserved development PostgreSQL, API, and UI using `npm run dev`; verified the metadata endpoint and explicit disconnected AI status.
- This session explains existing work and records the provider change request. It does not claim Gemini integration, live AI success, a new full test run, or Docker verification. Updated the handoff archive with the documentation changes.

## 2026 10 29 Architecture discussion and updated preferences

- The user asked to discuss the implementation and architecture before adding more features. Inspected the actual REST API, Compose configuration, categorization context, anomaly rules, seed data, and saved UI screenshots. Explained the distinction between implemented code, controlled-provider tests, live model evaluation, and full container verification.
- The user finds the UI confusing and requests a much simpler experience. Recorded this as a requested iteration, while retaining the existing identity and functioning accounting workflows. No interface code changed.
- Clarified that TypeSafe refers to Jev, the System One decision model. Reviewed its official model, confidence, retrieval, and citation-checking documentation, along with Gemini function calling, structured outputs, File Search, model capabilities, and pricing.
- The user explicitly permits paying for Jev and other models/services when justified. This supersedes the free-tier-only preference recorded in the previous entry. Updated active continuation instructions, README, plan, and checkpoint so the earlier constraint is not mistakenly enforced on resumption.
- Documented proposed responsibilities: PostgreSQL and approved functions own financial facts; Gemini handles interpretation and explanation; Jev and semantic retrieval are optional candidates to compare with a baseline. Documented failure cases and an evaluation approach for the interview explanation. These are proposals, not implemented integrations or measured accuracy improvements.
- No application code, migrations, database contents, credentials, dependencies, billing settings, or subscriptions changed. No model calls were made. Checked the changed documentation and refreshed the submission archive; the saved 37 backend/provider-contract and 8 browser results remain historical evidence.

## 2026 10 29 Public repository research

- The user requested comparable GitHub projects, preferably with substantial star counts. Checked public repository metadata, maintenance/archive state, READMEs, licenses, and selected source files.
- Recorded Midday, Bigcapital, WrenAI, Actual Budget, ERPNext, and TigerBeetle as references in [architecture](ARCHITECTURE.md#repository-research-references-under-consideration), including dated star counts and stack/scope limitations. Maybe and Vanna were archived when checked despite their high star counts.
- Examined Midday's assistant/report tools, Bigcapital's journal currency tests and MariaDB Compose configuration, Wren's business-context documentation and license map, and Actual's rules entry point. Recommended patterns to discuss rather than adding dependencies or replacing the existing accounting engine.
- Updated the checkpoint, checked changed Markdown formatting and local links, and refreshed the submission archive. No application code, database, dependencies, credentials, model calls, billing, or runtime processes changed. No upstream application or new Daybook application test run is claimed.

## 2026 10 29 Spiich research and experiment design

- The user asked how to choose between Gemini's managed capabilities and components such as Wren/pgvector, whether to compare branches, and how the exercise relates to Spiich. They clarified an intended finish within one or two days and asked to consider both fullstack and AI roles.
- Reviewed Spiich's official engineering postings, product overview, CRM write/rollback rules, assistant clarification behavior, background-agent documentation, and funding announcement. Recorded verified public statements separately from the inference that the exercise tests reliable language-to-business operations. No claim is made about private architecture or hiring intent.
- Reviewed Google's function-calling/structured-output responsibilities, managed File Search, pgvector's scope, and Mastra's evaluation/classifier facilities. Mastra supports a TypeSafe Jev integration; this does not establish that Spiich uses Jev.
- Inspected the current categorization context and eight-case live evaluation script. Recorded the need for exact complete-entry and structured-evidence assertions before comparing architectures. Proposed a shared harness, held-out cases, one-variable comparisons, and a bounded semantic-retrieval experiment.
- Updated architecture, plan, interview explanation, and checkpoint; checked changed Markdown formatting/local links and refreshed the archive. No source code, dependencies, migrations, database contents, credentials, branches, subscriptions, or processes changed. No model calls or new application tests ran.

## 2026 10 29 Midday and Actual Budget walkthroughs

- The user requested plain-language explanations of CRM/Spiich, Mastra, n8n, Grok Bot and load balancing, then asked how Midday and Actual Budget work and fit the assignment.
- Inspected pinned public source snapshots, official product/architecture documentation, interface components and public illustration/demo assets. Traced Midday's bank/receipt processing, AI tool selection, scoped SQL reports and UI structure; traced Actual's local database, sync, transaction representation and category rules.
- Recorded Midday's official Ramp transition and hosted-product wind-down, qualifying the earlier reference recommendation. Distinguished tool-definition embeddings from receipt matching, and prompt-based approval instructions from enforced application gates.
- Documented Actual's SQLite/local-first architecture, editable transactions, lack of native multi-currency and differences from a general double-entry ledger. Recommended its editable rules and straightforward transaction workflows as references without replacing Daybook's accounting engine.
- Updated architecture and checkpoint, checked changed Markdown formatting/local links, and refreshed the submission archive. No upstream app was run or incorporated; no Daybook source, runtime, database, dependencies or provider configuration changed. No model calls or application tests ran for this documentation-only work.

## 2026 10 29 Visual architecture report

- The user requested a pictorial explanation of the research lessons, system architecture, and next plan. Created an eight-page [PDF report](reports/architecture-review.pdf), [interactive HTML companion](reports/architecture-review.html), and [architecture preview](reports/architecture-overview.png). The report includes responsibility diagrams, a rent-payment and financial-question walkthrough, anomaly reasoning, a tool comparison, a proposed simpler interface, evaluation design, and the path from the assignment to production.
- Kept implemented, proposed, and unverified states explicit. The UI sketch is illustrative; Gemini, Jev, semantic retrieval, Mastra and Wren remain unimplemented candidates. The proposed allocation is 12 focused hours with up to four reserve hours, conditional on provider/Docker access. All example financial amounts are illustrative.
- Added a native vector PDF exporter at `scripts/export-architecture-report.py`. Its optional ReportLab dependency is documented in the script; rendering tools were installed only under `.tools`, with no application dependency or lockfile changes. The PDF is a separately laid-out companion to the HTML, not a browser screenshot.
- Inspected all eight rendered PDF pages and corrected a diagram connector crossing explanatory text. The exporter passed 206 text/table bounds checks and additional table-cell fit checks. Independent PDF inspection confirmed eight landscape A4 pages, text within page bounds, and 14 source links. Checked HTML structure, anchors/local links, and all five walkthrough handlers and exclusive selection states in a DOM simulation.
- Browser layout validation could not run: the local headless Brave process exited with SIGABRT before loading the report. HTML desktop/mobile layout is therefore not claimed as browser-verified; the delivered PDF was rendered and visually checked independently. No application test suite was rerun for this documentation/report change.
- Linked the report from the README, checkpoint, architecture, plan, and interview guide; checked documentation formatting and local links; refreshed and integrity-checked the submission archive. No application code, migrations, posted data, server processes, provider configuration, credentials, or billing changed. No model calls or purchases occurred.

## 2026 10 29 Gemini baseline and simpler transaction flow

- The user authorized implementation after the visual report and offered a clipboard key. Clipboard access was unavailable. Created a private `.env` placeholder; after the user saved the key, confirmed only that it was configured, without displaying it. A single minimal structured-output attempt failed before a provider response; a credential-free Google-host check returned `ENOTFOUND`. This does not establish an invalid key, successful access, token usage or a charge. No live financial suite ran.
- Preserved the prior submission at `.tools/checkpoints/before-gemini-implementation-2026-10-29.zip`. `git init` failed with a filesystem permission error; no repository/commit is claimed. Existing application and database processes were not restarted. No applied migration or posted record changed.
- Added `server/ai-provider.ts` with native Gemini REST and retained OpenAI support, configured by `AI_PROVIDER`, provider-specific keys and `AI_MODEL`. Used Google's current model/API documentation to select configurable `gemini-3.8-flash` and the documented JSON-schema/function-call formats. No new application dependency. Added safe error categories, 25-second timeout, no automatic retries, four-call concurrency bound and usage/model metadata. Both providers use the existing account/decimal/balance validation; model output cannot post itself.
- Strengthened insight arguments to reject extra fields and model-supplied organization scope. Added validated query arguments and retrieved correction/history IDs to evidence metadata. Financial amounts remain computed by SQL/application code, independently of the model.
- Replaced the weak eight-case live script with 40 labeled cases, split 20 development/20 holdout, and bounded four-case smoke mode. The harness creates new synthetic workspaces and predefined fixtures, compares complete entries and exact query/evidence results, checks correction retrieval, fingerprints journals around model calls, and records usage/source hashes. Clarification semantics explicitly require human review. Token guards stop later requests and are not hard billing caps.
- Implemented four primary destinations, a quieter Home page, expandable financial detail and a short USD money-in/out/transfer form. Review spells out account effects before confirmation; invoice payments, investments and debt repayments remain distinct from revenue/expenses. Full journal/FX/split entry remains available. AI clarification and ready-entry review now appear as separate steps. Reapplied the project-local Emil design/mobile guidance.
- Independent review found and fixed an ineligible default account when account code 1010 had been reassigned, and controls allowing edits while a previous preparation/posting request was pending. Added shared account-eligibility helpers and focused tests. Updated browser workflows for the simple form and mocked AI clarification/review. The browser launcher explicitly disables its provider key.
- Added a dedicated Compose `evaluate` profile so synthetic fixture creation does not give the normal app administrative credentials. Included evaluation modules in the runtime image. Added a non-writing posted-entry persistence check across app/database container recreation and included it in CI. Compose configuration validates; these containers/CI have not run.
- **Executed:** 51 isolated tests passed (22 provider, 23 evaluation, 6 simple-entry), strict TypeScript/production build and formatting checks, plus Compose configuration validation. **Blocked:** local PostgreSQL TCP returned `EPERM`; browser launch aborted before page load; provider DNS returned `ENOTFOUND`; no Docker runtime exists. The current 29 accounting + 14 database-backed AI contracts and 10 browser workflows remain pending. Earlier screenshots and suite results remain labeled historical; no new runtime success is inferred.
- Updated current documentation/checkpoint and labeled the visual report as the earlier planning snapshot. Refreshed the submission archive with a secret-exclusion/integrity check. Optional Jev/vector/framework experiments were not started because no live baseline has been measured. No purchase/subscription was made.

## 2026 10 29 Requested verification run and cloud-test preparation

- The user asked to run the tests autonomously and offered Vercel access. Re-ran the full test command: 51 tests passed, 43 were skipped, and the two database-backed suites failed during setup with `EPERM` connecting to PostgreSQL. The production build passed again. The live smoke command stopped during database setup without provider calls. Provider DNS still returned `ENOTFOUND`; the browser failed before page load.
- Saved a sanitized [verification attempt record](evidence/verification-attempt.json). No schema, application record, provider key or posted history changed during these attempts.
- Checked connected GitHub tools and searched the accessible repository catalog for Daybook/Spiich; no target was identified. Used the Plugin Management discovery guidance to check the offered Vercel option; it is available but not connected. Requested a private repository URL for the existing CI instead of assuming an unrelated repository was authorized.
- Added manual workflow execution and an opt-in Gemini smoke job that waits for database/browser/Compose checks, uses a repository secret only in its evaluation step, caps attempts and observed tokens, and publishes synthetic evaluation evidence. The workflow is prepared and locally syntax/format checked, not remotely executed. No source upload, secret transfer, deployment or purchase occurred.
- The user then created `rayidali/spiich_homework` and supplied its URL. Metadata confirms an empty public repository, but effective connector permissions report `push: false`. Requested write access to that repository and informed the user of its public visibility. No write was attempted without effective access.
- Follow-up diagnosis found the connector uses `gulfmarvel`. At the user's direction, checked the local CLI instead: it is authenticated as `rayidali` and reports ADMIN access to the target. No GitHub permission change is needed for that login. Attempted local `git init -b main`, which failed because this session cannot write `.git`; the policy explicitly grants that directory read-only access. A direct `gh api` read also failed to connect, while `gh repo view` succeeded. The user wants us to perform the local commands; continuation requires an environment that allows the Git metadata writes. No commit or push succeeded.
- Updated checkpoint/verification documentation and refreshed the submission archive. Hosting and CI access are separate from test success; no successful runtime claim was added.

## 2026 10 29 Local Git publication and CI diagnosis

- Confirmed local GitHub CLI identity `rayidali` and ADMIN access. The connector's different identity was irrelevant to the requested local publication. Escalated initialization of the project folder was rejected by session policy; initialized a separate checkout in permitted temporary storage instead.
- Preserved the existing remote initial commit, copied only the reviewed submission manifest, checked candidate bytes against configured private keys, and successfully committed/pushed using the local Git CLI. First application commit: `c718a1fd29bc9c6cdb0a397264709e3255f3d1b0`. No credential, local database, dependency directory, or archive was uploaded. No force push or global Git configuration change was made.
- The first remote run passed formatting, build, migrations, and backend tests against PostgreSQL. The production browser step failed, so dependent Docker/live jobs did not run. Added Playwright GitHub annotations and captured startup/failure diagnostics so the exact browser failure can be inspected through public check results; typechecking passed. Investigation remains in progress.
- The diagnostic run confirmed nine browser workflows pass; the short-form workflow times out locating its category dropdown by an exact label. Gave the dropdown an explicit accessible name matching its visible category/destination label, keeping the existing review, no-write-before-confirmation, and exact ledger assertions unchanged. Re-running CI to validate the full workflow.
- The next run passed all 10 browser workflows, Docker build/startup/health, and containerized backend tests. Its final container-recreation persistence check failed. The check used pooled HTTP connections across destruction of the app while synchronous Compose commands blocked socket-close processing; changed these deliberate before/after reads to close their connections and added a CI failure annotation for exact diagnostics. Persistence equality assertions remain unchanged; the next run will establish whether this resolves the failure.

- Final executable-source run: **[40994222818](https://github.com/rayidali/spiich_homework/actions/runs/40994222818)**, commit `634ab08f22627b26539af9227883c9208f2ae479`, succeeded. Both verify and compose jobs passed: 94 backend tests, 10 production browser workflows, Docker startup/health, containerized tests and unchanged posted-entry persistence. Live AI was intentionally skipped. Saved sanitized cloud evidence, synchronized current documentation, and refreshed the submission archive.
- Vercel CLI is installed, but its identity request failed on networking; no local authentication status is inferred. Offered the available Vercel plugin connection. No hosting project, managed database, provider-secret transfer or deployment was created.

## Remaining external verification

- Authentication preference clarified: use local Terminal/CLI sessions for GitHub and Vercel. The earlier Vercel plugin suggestion is superseded. Verified the installed Vercel CLI's login help; no plugin account connection, token transfer or deployment was performed.

1. Configure the live evaluation environment without exposing keys, validate Gemini access, and run smoke/development/holdout cases with the existing bounds. Inspect required clarifications manually.
2. Inspect the fresh CI screenshots and replace historical images after review. Check a physical phone and additional browsers.
3. Production load/failover/restore testing and identity/authorization remain outside the verified scope.
4. Prepare hosting only with an available authorized connection and a suitable hosted PostgreSQL database; Docker verification alone is not a deployed preview.

The submission should describe these limits plainly. No guarantee of hiring acceptance or million-user capacity is implied by the implementation.

## 2026 10 29 Local Vercel hosting

- Verified local Vercel identity `rayidali`, preserving the user's local-only authentication preference. Created a separate free Neon database through the already installed integration and a Daybook Vercel project with all-deployment access protection. No paid subscription or unrelated resource was changed.
- Added a Vercel API adapter, a bearer-protected daily scheduler, and post-response processing of durable anomaly jobs. Docker retains its existing continuous worker; Hobby hosting uses a daily schedule with bounded batches, which can leave larger backlogs until later invocations.
- Hosted setup applies checksummed migrations, gives `spiich_app` a generated strong password and runs the idempotent seed. Owner credentials are supplied only in the deployment build environment. Runtime credentials and Gemini are server-side. Private request/response files stay under ignored `.tools`.
- The first build successfully prepared the new database but omitted TypeScript because NODE_ENV=production skipped build dependencies. The installation command now explicitly includes them. Deployment verification remains in progress.
- Production build/typechecking passed; 58 isolated tests passed including seven cron authorization, sequencing and safe-error cases. Initial HTTP-based cron tests could not bind locally (EPERM); the handler cases now use direct request/response doubles. Full regression CI for this source is pending.
