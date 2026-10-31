# Build log

> Current save: 2026-10-29 America/New_York. This log is chronological: earlier failures, pending checks and proposed tools describe their point in time. [CHECKPOINT.md](../CHECKPOINT.md), [verification](VERIFICATION.md) and [hosting](HOSTING.md) hold the reconciled latest state. Latest full CI passed 101 backend tests, 10 browser workflows and Docker persistence; the protected hosted demo is live, while Gemini generation timed out.

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

## External verification remaining before hosting (historical snapshot)

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

- A built deployment reached READY but authenticated API requests returned FUNCTION_INVOCATION_FAILED. Added explicit esbuild bundling of the hosted TypeScript entrypoints into native ESM and verified module loading locally; the wrapper and bundle are now checked in CI. Rebuilding and live smoke checks are in progress.

- Native ESM deployment succeeded and authenticated checks passed for health, metadata, SPA HTML, P&L, trial balance ($190,072.00 each side) and balance sheet ($0.00 difference). Public traffic reaches Vercel protection. Live financial chat returned AI_TIMEOUT without journal writes; an authenticated Google model-metadata request succeeded. Live generation accuracy remains pending. The cron handler needed an Express wrapper because raw Vercel requests do not provide req.get(); wrapper added, both native modules load locally, rebuilding for live verification.

- Final hosted scheduler checks passed: missing bearer secret returns 401, authorized execution processes a bounded batch (four jobs) and returns schedule counts. Health remained OK. Automatic daily firing is not yet observed. Stable URL: https://daybook-ledger-delta.vercel.app. Updated hosting/checkpoint/README and refreshed the credential-free submission archive.

## 2026 10 29 Detailed documentation and checkpoint save

- The user requested all project Markdown documents be updated in detail and the current state saved for continuation. Reviewed all 12 maintained Markdown files and the implemented hosting/configuration paths; updated README, AGENTS, CHECKPOINT, architecture, API, design, plan, walkthrough, interview guide, hosting, verification and this log. Earlier log entries remain chronological evidence.
- Read public GitHub results using the requested local publication workflow. The final executable commit `576a2468feacf9bd1d040c75bb1c5ff203f28dae` completed [CI run 40999183176](https://github.com/rayidali/spiich_homework/actions/runs/40999183176) successfully: verify/compose passed, live-ai skipped. Current backend total is 101 (29 accounting + 14 AI/database contracts + 22 provider + 23 evaluation + 6 simple-entry + 7 scheduler), plus 10 browser workflows. Native imports, Docker startup/health/container tests and posted-entry persistence passed. Preserved the earlier 94-test evidence separately and updated sanitized current CI evidence.
- Reconciled stale status statements: Vercel/Neon hosting is live, Gemini model-metadata access succeeded, the hosted financial-chat request timed out, the scheduler passed direct HTTP authorization/work checks, and an automatic daily firing remains unobserved. No successful live generation, usage/billing result, visual review, physical-device result or scale benchmark was inferred.
- Documented production deployment overrides versus persistent project variables, separate hosted/local data, build-only owner access, the restricted runtime role, daily/request-triggered bounded job tradeoffs, lack of Git auto-deployment and the unresolved reviewer-sharing decision. No credentials or private payloads were placed in documentation.
- Saved local Git recovery, resource identifiers, existing data/volume/migration safeguards, archived pre-save handoff and ordered next-session work. Listener inspection showed no local servers on 5173/3001/55432; no server/database was started or stopped. No application code, migration, data, credentials, deployment settings, subscriptions or provider behavior changed for this documentation task. No model call ran.
- Validation for this save covers Markdown formatting, local links, stale-status reconciliation, credential exclusion and archive integrity/source equality. Application regression was not rerun for unchanged executable source; the successful final CI above provides that evidence. Refreshed `submission.zip` under `daybook-ledger/` and published the documentation save through the existing local Git checkout, using a documentation-only CI skip.

## 2026 10 30 Chat failure investigation and provider compatibility fix

- The user reported a failed financial question, then asked whether an unlinked Vercel Git repository was acceptable and whether the provider API should be tested first. Confirmed deployment was a direct authenticated upload, separate from GitHub source/CI; no automatic Git-to-Vercel deployment was configured or added.
- Reproduced hosted AI_TIMEOUT. Direct minimal generation using gemini-3.8-flash timed out before headers at 30 seconds; a stateless Interactions probe also timed out at 55 seconds. The latest alias returned 503 UNAVAILABLE/high demand. Metadata/list access alone had been insufficient. A listed 2.5 model returned 404/no longer available to new users. These observations do not establish a permanent outage or usage/billing for timed-out calls.
- The same key successfully generated with gemini-3.1-flash-lite: minimal text, structured JSON and the exact financial tool request. Changed the hosted model override and source Gemini default to that tested model; no paid plan, new key, automatic retry or accounting rule changed. Hosted cash and Acme search answered successfully; cash matched the dashboard. The first expense request timed out, while a manual repeat succeeded. Provider availability remains variable; no universal reliability/accuracy claim is made.
- Investigated a separate 400 on natural-language entry: the complete proposal schema failed, removing only the metaschema did not help, and removing the 100-line maxItems constraint from the provider grammar succeeded. Added a transport-only transformation omitting numeric maxItems. The full original Zod/account/money/balance rules still validate responses, including the 100-line maximum. Token bounds remain unchanged. Added regression checks for grammar shape/property names and rejection of 101 returned lines.
- Local validation: 60 isolated tests passed (24 provider, 23 evaluation, 6 simple entry, 7 hosted scheduler). Production build and full CI/deployment verification are being completed; current full-regression evidence remains the previous 101-test run until replaced. No model output was posted.

- Deployed the schema fix as dpl_HQefAFAGwPS2x52c1nXPetRYovKq. A hosted supplies proposal returned READY with the expected date, debit 5030/credit 2100 for 340.00; journal-list equality before/after the checks held across 73 entries. Cash/search/expense outputs matched independent dashboard/list/P&L endpoints. Recorded intermittent failures honestly: first expenses timed out then manual repeat succeeded; later search returned AI_PROVIDER_ERROR. No automatic retry loop or claim of universal reliability was introduced.
- Production build and native hosted imports passed. New full CI run 41103851106 for 7ecb435 is queued; previous full CI remains historical until the new result arrives. Saved sanitized recovery evidence, updated active documentation/checkpoint, and refreshed private local deployment state without exposing credentials.

- Updated documentation and the secret-excluded submission archive after the fix; source publication and hosting remain separate. The full evaluation harness, fresh hosted browser review and continuous availability are still unverified. No journal entry was created or posted by these AI checks.

## 2026 10 30 User confirmation and final regression result

- The user reported the assistant worked and asked for an independent check. Sent one hosted Acme transaction question; it returned HTTP 200 in 1.679 seconds (provider duration 1,243ms), selected the scoped transaction-search tool and returned 12 posted entries. The independent transaction-list endpoint returned the same count. No posting or data mutation was requested.
- Full CI run 41103851106 on 7ecb435 completed successfully: verify/compose passed, including 103 backend tests (24 provider tests after the two new regressions), 10 browser workflows, native imports and Docker startup/health/containerized tests/persistence. The separate live-evaluation job was skipped. Preserved prior CI evidence, updated current sanitized evidence and checkpoint, and refreshed the submission archive.
- Earlier intermittent failures remain documented; this confirmation does not establish a full model accuracy score or continuous availability. No further application/configuration/deployment change or retry was made.

## 2026 10 30 Comparative research plan — no implementation

- The user proposed a second validation agent, Gemini embeddings, Jev, Wren and multiple scored routes, asking for a research-paper-style plan and explicitly forbidding implementation for now. Replaced the stale one-day delivery plan with a detailed staged experimental protocol, preserving its prior version locally and its referenced comparison anchor.
- Reviewed primary Gemini File Search/embedding docs, the TypeSafe documentation index then Noul/Choice/confidence pages, pgvector and the Wren repository/README. Recorded relevant capability boundaries, including managed retrieval versus custom embeddings, Jev's typed decisions rather than a guaranteed correctness score, and Wren's current OSS/commercial boundaries. No upstream package was installed or executed.
- Planned nine controlled configurations instead of a confounded cumulative stack; common accounting-aware query/scenario capability, matched corpus/model budgets, separate retrieval/query/verification comparisons, a proposed grouped 120-question development/holdout set, a separate 160-candidate validator stress set and 60-case hard gates. Defined task-success/quality metrics, costs/latency, uncertainty, ablations, reproducibility, selection rules and a pilot before a costly main run. No score or measured improvement was invented.
- Updated checkpoint and continuation instructions to make planning-only scope explicit. No application code, dependency, migration, financial data, hosted resource, provider setting, document index, API evaluation, agent execution, purchase or deployment changed. Public documentation reads were the only external research. Documentation formatting/local links and the refreshed archive are the relevant checks; unchanged application suites were not rerun.

## 2026 10 30 Research implementation authorized and integration checkpoints

- The user explicitly superseded planning-only scope, authorized implementation, supplied a private Jev key with $5 credit and requested scientific controls, comparable scores and graphs. Reserved at most $4 for Jev and $10 for Gemini; no subscription or hosting upgrade was purchased. Provider costs are paid-equivalent estimates plus explicit unknown-usage reservations, not account invoices.
- Built nine controlled route adapters, a bounded typed analytics compiler, exact decimal scenario calculations, document retrieval and optional semantic reviewers. Production accounting and posted history remain separate. The control reproduces the deployed four-tool/proposal architecture with normalized model/date/fixture adapters; all routes use Gemini3.5FlashLite after observed3.1 availability failures. The critic is a separate same-model call, with correlated errors explicitly acknowledged.
- Added an independent synthetic reference pack and separate evaluation code:120 questions in60 paraphrase groups, six families,60/60 group-held-out split;40 documents;160 reviewer candidates;60 security challenges. Labels never enter prompts. Automated scores cover structured facts/protocol only; the10-point human clarity score remains unmeasured.
- Revalidated environment constraints: TCP/Unix sockets denied, approved HTTP successful. Provisioned only a separate research schema and restricted reader in the existing Neon database; verified no access to demo journals/base tables and no write/table privileges. Real Wren-generated SQL and custom SQL both matched independently calculated164615.00 cash. Complete fixture verification matched114 scoped lines,57 posted entries and39 authorized source documents/embeddings.
- Installed and pinned the actual Wren Rust semantic core0.8.2 and SQLGlot30.27.0 in ignored local tooling. SQL AST checks apply before/after expansion, with bounded resources and AST-derived currency/count evidence. Unknown CTE/join lineage fails closed; this is a disclosed integration restriction, not a claim about Wren's full capability.22 real-engine tests passed.
- Live provider checks uncovered and corrected a documented-vs-runtime embedding API mismatch (nested configuration returned3072 dimensions; documented flat fields returned768), explicit pgvector schema/operator resolution under the restricted search path, and legacy File Search responses without usable grounding. Interactions File Search returned real search steps/citations. Generated summaries are never used as source evidence; citations resolve to authorized original documents.
- All40 synthetic vectors and39 authorized File Search documents are indexed. One interrupted vector request was retained as a failed charged-reservation attempt; ingestion resumed idempotently. All four retrieval variants subsequently found the correct Acme contract. Previous failures remain in evidence.
- Independent code reviews and regression tests found/fixed currency relabeling, counts/IDs treated as money, unsupported calculation operands, duplicate calculation/query IDs, missing percentage operations, incomplete usage circuits, deadline enforcement and manifest/restart gaps. Security suite reports57 component passes, zero failures and3 unassessed; no fabricated full prompt-safety claim.
- Live R0/R1 cash preflights passed. A hiring preflight's correct arithmetic but wrong derived citation was rejected; after clarifying the common protocol, the development preflight passed with7080.00 monthly cost/3000.00 recruiting. These exploratory checks are not main-run scores. Full pilot, reviewer calibration, held-out evaluations, analysis, publication and refreshed submission remain to complete.

## 2026 10 30 Portable research database and CI preparation

- Added explicit native PostgreSQL research transport while retaining Neon HTTP as the default. Native queries preserve numeric/bigint strings, use bounded connections, and close on failure. Batches use one repeatable-read transaction with read-only defaults and rollback. Fifteen mocked-driver tests and the 25 existing research-core tests passed; these are adapter-contract tests, not live native database evidence.
- Added a separate pgvector Compose file on loopback port 5433 with the `daybook_research_data` volume. The application Compose file, `spiich_postgres_data`, local PostgreSQL data and applied application migrations remain unchanged. Documented complete fresh-checkout setup, indexing, evaluation, resume and artifact handling in `docs/research/REPRODUCE.md`.
- Corrected research database verification for fresh standalone databases: an absent demo journal table now records `NOT_APPLICABLE`/`passed: null` with SQLSTATE `42P01`; absence is not counted as a permission pass. Actual demo-table denials still count, while a missing research base table or unrelated/network error fails the check. Setup/check isolation descriptions identify the selected transport without inferring server topology. Six regression tests cover these distinctions and fingerprint changes.
- Added a provider-free `research-native` CI job for the pinned pgvector container, actual Wren engine tests, complete pre-index source comparisons, custom/Wren query execution and deterministic reader/security boundaries. The job saves only newly generated sanitized evidence and the pulled image digest. It does not index documents or claim model/retrieval accuracy. The new job has not yet been run; Docker/native end-to-end success remains pending a completed CI artifact.

### 2026-10-30 — Reviewer development calibration and experiment controls

Completed 240 reviewer outcomes on 80 development candidates (40 correct, 40 deliberately flawed), with every case sent to deterministic checks, Gemini and Jev. Four Gemini rate-limit errors remain in the record, with conditional and fail-closed metrics separate. Jev's development-only threshold selection fixed 0.8 under the declared maximum five-percentage-point additional false rejection rule. These are development results, not held-out confirmation or a production accuracy estimate.

Before the main pilot, added a shared Gemini pacing controller (4,200 ms minimum generation-start spacing), deadline-aware queued requests and cancellation of undispatched expired work, and a provenance binding that validates the complete source, reference labels and preserved development outcomes before held-out requests. The original narrow calibration hash remains preserved; expanded provenance is a separate amendment. No automatic retry or failure replacement was introduced. Source and data fingerprints now control whether complete results are eligible for conclusions. The protocol documents exact metric-key scoring, unavailable human review and managed-search/SQL-lineage limitations.

The new local checkpoint passed 293 isolated tests while the report audit was still in progress; a production build and final aggregate check follow completion of that audit. No new full CI result or held-out route score is claimed here.

### 2026-10-30 — Research source published and full CI passed

Published research implementation `07469a6ab8d2ca32b075bfb99ccbd264ddc05672` via the existing locally authenticated temporary checkout. The allowlist included 202 source/document/evidence files; actual-secret scanning and source/checkout byte equality passed. No credentials, private queue files, Python environment or database directories were uploaded. Full CI run `41135032615` passed application/browser verification, Docker tests/persistence and the newly added native pgvector/Wren research checks. Local source checkpoint passed 306 isolated tests, production build and formatting; Wren's real-engine suite passed 22 tests.

Started the 108-episode development pilot under `pilot-v1`. Initial external-dispatch gaps caused recorded timeouts; continuous dispatch replaced manual gaps without changing model prompts. Later held-out timing must use that stable dispatcher. Early Wren routing failures remain preserved for diagnosis after the frozen pilot finishes. No result was replaced and no production deployment was made.

### 2026-10-30 — Completed first pilot; corrected measurement and planner interfaces

The first pilot completed108/108 episodes with unchanged ledger/document/vector fingerprint. It is ineligible for selection: R0's adapter omitted user and derived-calculation evidence, incorrectly penalizing valid outputs; Wren could select the wrong backend field from the shared grammar; three startup dispatch timeouts were harness failures. Original outcomes, scores, usage and the explicit validity notice are preserved. This is development diagnosis, not held-out tuning.

R0 now uses the shared deterministic validator/evidence path without another model invocation. Backend-specific schemas prevent requesting the wrong query interface; Wren receives types from its actual semantic model. Two subsequent development probes failed SQL validation (an integer boolean before typed context, then a misspelled column); neither was silently retried or omitted. Backend instructions were clarified generally, and all original source data/reference labels stayed fixed. The next checkpoint passed339isolatedtests, build andformatting; pilot-v2 began with continuous dispatch active before its runner.

Added external supplemental retrieval/timing and common-capability analysis, plus a standalone PDF exporter. Missing per-call durations remain partial/unknown, not measuredzero. The firstpilot's known validity defects override mechanical completeness in interpretation. Held-out results and final product selection remain pending.

### 2026-10-30 — Corrected source passed cloud checks; transport race identified

Published corrected runtime as `3d906ce127d260a342257f60fd1f8d24576157ec`; full CI `41138538661` passed application/browser verification, Docker/persistence and native Wren/pgvector checks. A following attributes-only commit `1e5e152` marks PDFs binary, preserving their bytes and avoiding misleading whitespace diffs. The submission ZIP was refreshed with243reviewedfiles and passed secret, CRC and exact-byte checks; ongoing run evidence will require another final refresh.

Pilot-v2 has a genuine provider HTTP504 and a separate inferred queue completion-file race. In the latter, the final recorded response was200/exit0, but the runner consumed an incomplete completion marker and preserved a failed episode/unknown-usage reservation. The diagnostic is recorded separately and the transport will be corrected after this frozen run, before held-out testing. No old episode or model response was silently replaced. R0 now passes the initial cash and revenue cases with proper provenance; Wren has successfully executed financial and analytical queries. These are development observations, not final route accuracy estimates.

### 2026-10-30 — Daily quota stop and scientific comparability corrections

Pilot-v2 recorded 101 of 108 planned episodes before Gemini's daily free-tier quota (500 requests per project/model) produced four HTTP 429 responses and opened the persisted circuit. Seven attempts remain missing. The run preserved source integrity and the complete ledger/document/vector fingerprint. Dispatcher/watcher stopped cleanly; no pending ready requests remain. A separate HTTP 504 and inferred partial completion-file read are recorded independently. No failure or unknown-use reservation was replaced. A bound validity notice labels the entire partial development run ineligible for architecture selection.

After the run ended, the queued transport gained a complete footer marker and regression coverage for empty, partial, malformed, failed and late completions. Twelve new framing tests and the existing core suite passed. A pre-holdout audit also found that R0's measurement contract lacked the shared tag vocabulary. Its existing single call now emits assumption/clarification metadata without changing financial operations, scopes or SQL; missing/wrong tags receive no inferred credit. Nine new metadata tests and prior baseline/validation tests passed. The shared broader-route prompt now distinguishes draft intent from posted facts and requires complete intermediate calculation provenance. Financial guards and reference answers remain unchanged.

The user was asked to enable billing on the existing Gemini project or choose continuation across daily quota resets. No account change or new payment was made here. A safe, explicitly gated one-shot recovery mechanism is being implemented so future continuation can retain all historical reservations. At the stop, Gemini's tracked total was $0.77135965 ($0.57577435 reported paid-equivalent plus $0.19558530 reserved unknown use); Jev's was $0.00718754. These are estimates, not invoices. The $10/$4 ceilings remain.

All held-out route and reviewer measurements remain unrun. The current work produces diagnostic graphs, an updated narrative and reproducible offline checks; it does not select a winner or deploy the experiment into the product. Final aggregate checks, cloud CI and archive refresh follow the remaining offline changes.

### 2026-10-30 — Final offline development checkpoint

Completed the one-shot quota recovery helper with 28 targeted tests and an explicit public procedure. It binds the prior quota incident, exact usage snapshot, request/model and private authorization; reserves before the single probe; and preserves all historical attempts/caps. Failed/pending probes remain blocked. Review also identified and corrected inherited stale-lock takeover and corrupted-ledger overwrite risks. No recovery permit or live probe was created.

The aggregate local suite passed **399 tests in 26 files** (database-dependent accounting/AI contracts excluded), followed by a successful strict TypeScript/production build and global formatting. The source fingerprint is `28ac6366b03d38da8eed431c3063494cea2e221c4324e37b43efe79976317b37`. Fixed secondary weight sensitivity, dual-source capability amendments, pre-holdout audit, V2 supplemental figures and a 12-page diagnostic PDF are complete. All PDF pages carry the incomplete/no-selection notice; selected pages were visually inspected. Maintained documentation links and current-vs-historical claims were reviewed.

Next is publication through the existing local Git identity and fresh full cloud CI. Live corrected development smoke, final freeze, all held-out measurements and architecture selection remain pending account capacity. Production has not been redeployed.

### 2026-10-30 — Final corrected source published and full CI passed

Published research revision `05a9fe3488f7dcbd6d137c6a2780aab0f5675e3d` through the existing locally authenticated checkout. [CI 41142335257](https://github.com/rayidali/spiich_homework/actions/runs/41142335257) passed application/backend and browser verification, Docker startup/persistence, and the native pgvector/Wren job; the opt-in live-AI job was skipped. The local checkpoint remains 399 isolated tests plus build/formatting. Sanitized job/step evidence is `docs/evidence/research-ci-v3.json`; no exact new CI count was inferred from inaccessible logs.

The diagnostic report, all original pilot outcomes, source amendments, scoring sensitivity and recovery procedure are saved. Updated current documentation and refreshed the submission archive through the allowlisted publication helper with credential, CRC and exact-byte checks. No provider call, paid-tier upgrade, recovery permit, production deployment or held-out measurement was made during this final save. Continuation still needs account capacity and the explicit audited probe/development smoke/freeze sequence. No architecture winner is claimed.

### 2026-10-30 — Replacement Gemini key checked with persistent frugal limits

The user changed the local key and said its funds were low. Privately verified a changed value with no inherited environment override; no credential or fingerprint entered public evidence. Added truthful `user_configured_key_change` authorization instead of inventing a billing change or quota reset. A persistent shared-ledger policy fixes additional allowance at $0.01 Gemini/$0 Jev and one fixed availability request. Its baseline hash, required-policy marker and consumed permit preserve history and prevent default-$10 runners from restarting after success. Missing/malformed policy and interrupted/unknown usage fail closed.

Exactly one live request succeeded: HTTP 200 in 878 ms, 14 input/5 output tokens, $0.0000167 paid-equivalent estimated usage. The original 840 records stayed unchanged; one new record was appended. A reconstructed default-budget object rejected an ordinary call before transport. No Jev, embedding, document ingestion, scored question, billing upgrade or hosted credential/deployment change occurred. Balance, project identity and old managed index access are unknown. Larger budget question is pending; no preselected answer was assumed.

Validation: 18 new guard tests, 72 targeted tests and then 417 aggregate isolated tests across 27 files passed; strict TypeScript/production build passed. Previous cloud checks remain separately attributed until this revision completes CI. Original pilot outcomes and scientific conclusions are untouched; no winner or completed held-out study is claimed. Updated active documentation and checkpoint, with a secret-excluded archive refresh to follow.

Published guard revision `675a7c481c3d3d895ee4e7e72990c628ba341f70` through local Git authentication. Full CI `41147321748` passed application/browser verification, Docker startup/persistence and native Wren/pgvector checks; the live-AI job was skipped. Recorded sanitized evidence, saved this documentation result and refreshed the submission ZIP with secret/CRC/byte-equality checks. Total new Gemini requests remains exactly one; the consumed probe-only restriction is unchanged.

### 2026-10-30 — Full study continuation authorized and funded

The user accepted the approximately $6.40 estimate, requested continuation until the goal is complete, and reported adding $5 to Gemini with about $8 available. Explained the official Google AI Studio Billing/Buy credits path; no payment, auto-reload, account switch or subscription was performed by the assistant. The estimate is not a guaranteed bill. The consumed one-probe stop is superseded by an audited $6.40 additional Gemini/$0.10 additional Jev study allowance, retaining original cumulative caps and historical unknown-use reservations.

Preparing a parent-bound persistent allowance, fatal policy-stop handling and the private continuously serviced curl queue. The existing runner already supports the balanced 54-episode development smoke, so question selection and main 1,620/240 design remain unchanged. Existing managed store access will be checked before any necessary index migration. All new experiment results remain pending at this entry.

### 2026-10-30 — Funded preflight and engineering verification complete

Installed the parent-bound $6.40 additional Gemini/$0.10 additional Jev allowance, preserving every prior usage record, policy and unknown-use reservation. Fatal budget, credential and policy failures now stop a run after preserving the first error, leaving unattempted episodes missing. The published executable revision `eb75bf106cc91c023ee749873d1cd91057934cd3` passed 453 isolated tests, strict TypeScript/production build and formatting; full CI 41152133267 passed application/browser, Docker/persistence and native Wren/pgvector jobs. Live-AI was skipped in CI.

The current key could not access the previous managed File Search store (HTTP 403). Preserved that store's state and rebuilt the same 39 authorized synthetic documents under the current credential; the final read-only check reports 39 active, zero pending and zero failed. Existing embeddings were retained. Fresh database verification matched all 114 posted lines, 57 entries, 39 authorized documents and their embeddings, with identical before/after and prior fingerprints. One unclaimed database request timed out during concurrent indexing; earliest-expiry dispatch with creation-time tie-breaking corrected queue starvation before scored runs. Its original failure remains recorded separately.

The preflight dispatcher completed 123 requests with complete footers: 122 HTTP 200 and the initial store-access 403, no curl failures or dispatched expiries. Incremental tracked Gemini use is $0.0274683; additional Jev use is zero. These are estimates/reservations, not invoices. The new 54-episode development smoke starts next; held-out comparison and final conclusions remain pending. Production is unchanged.

### 2026-10-30 — Complete funded smoke exposed evidence-scope asymmetry

The fixed smoke completed all 54 episodes: 47 execution successes, seven validation blocks and zero execution errors. Source and full scoped ledger/document/vector fingerprints remained unchanged. The dispatcher completed 197 HTTP-200 requests with full footers and no curl failures/expiries, then stopped cleanly. Gemini tracked use was $0.17572225 and Jev $0.001052184. All original outcomes, scores and costs are preserved.

Review found one blocking measurement defect: custom monthly results inherited a whole-query date range, while Wren evidence omitted scope and was checked more permissively. Correct rent values were penalized asymmetrically. A bound validity notice makes the smoke diagnostic only. Before holdout, a shared machine-derived period/identity contract is being implemented from validated custom plans and supported parsed Wren ASTs; unknown scope must fail closed. No prompts, reference labels or production code are being tuned from these results. Missing derived citations, exact entity/tag mismatches and absent route capabilities remain valid failures.

The final reporting audit also found missing predeclared targeted-family effect and reviewer-tradeoff tables. An external analyzer is being added without changing model execution. The PDF exporter now accepts separately hash-bound common-capability, fixed-weight sensitivity and decision analyses. Nine exporter tests pass; the two new common/sensitivity pages rendered and were visually inspected using preserved historical diagnostics. Original PDFs were not replaced. Final held-out results and architecture recommendation remain pending.

### 2026-10-30 — Shared scope correction and decision supplement verified

Completed the shared machine-owned row-scope contract across custom analytics, actual parsed Wren SQL, R0 evidence, mandatory validation and scoring. Month intervals are clipped to query bounds; grouped identities retain their grain; unsupported expressions and ambiguous equal-value calculation operands fail closed. Independent internal review caught and regressed daily-flow/as-of confusion, raw rows missing event identity, vendor-bucket collapse and calculation wrappers dropping dates or identities. No model prompts, reference labels, question membership, fixture contents or original study records changed. This remains bounded provenance checking, not complete economic-semantic proof.

The external decision analyzer adds the prespecified targeted paired effects, clustered reviewer uncertainty, explicit conservative criteria, Pareto comparisons and operational complexity descriptions. Its 20 new synthetic tests passed. The PDF exporter includes common-capability, fixed-weight, decision and complexity appendices with input bindings; nine tests and visual checks of five newly rendered appendix/decision pages passed on diagnostic data. No held-out result was inspected or generated.

Aggregate local verification passed **511 tests in 32 files**, strict TypeScript/production build and global formatting; actual Wren Python verification passed **35 tests**. Source hash: `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08`. The v4 capability amendment binds baseline and routes without changing membership. Next is local-authenticated publication, full cloud CI and a separately named corrected development smoke. Additional spending remains $0.20319055 Gemini and $0.001052184 Jev; production is unchanged.

### 2026-10-30 — Corrected source passed full CI and final development freeze

Published executable `0fe267b03b7baa0a2ff43c58165301b74261afa9`; full CI 41155033249 passed application/browser, Docker/persistence and native Wren/pgvector jobs, with live-AI skipped. The corrected smoke completed all 54 fixed development episodes with unchanged source/protocol/data: 40 ok, 13 withheld and one preserved response-contract error; 28 structured successes and zero observed hard-gate violations. All 190 dispatches were HTTP 200 with complete footers and no curl failures/expiries. Transport success is distinct from valid model output.

Internal review confirmed symmetric custom/Wren scope handling, real reviewer calls and retained usage. No new measurement blocker was found. Conservative ambiguous-operand withholding, wrong derived citations, missing formal tags and absent baseline capabilities remain failures. R2's correctly cited hiring calculation succeeded, demonstrating that the arithmetic/citation guard can accept the valid scenario. These reused development cases do not provide a held-out accuracy estimate or select an architecture.

Final freezing succeeded at source hash `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08`, binding the preserved development calibration and threshold 0.8 before any held-out attempt. The corrected smoke used $0.14623505 Gemini and $0.000755538 Jev; additional funded totals are $0.3494256/$0.001807722, including unknown-use reservations. The remaining task is the full frozen 1,620/240 comparison, final statistical/visual report, recommendation and evidence publication. Production is unchanged.
