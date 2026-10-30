# Daybook session checkpoint

Saved **2026-10-30, America/New_York** (verification timestamps may read 2026-10-30 in UTC). Read this first on resumption. Continue the implemented application; do not rebuild or restore an earlier ZIP over it.

## Active request: research planning only

The latest user request supersedes further implementation: propose a validation agent and multiple research routes (managed File Search/broader analysis, Gemini embeddings, Jev and Wren), with shared tests and comparative scores, **but do not implement anything yet**. The detailed plan is [docs/PLAN.md](docs/PLAN.md). It defines nine component-controlled configurations, mandatory deterministic validation, optional LLM/Jev reviewers, shared isolated fixtures, a proposed 120-question grouped development/holdout set, separate verifier/error-injection and security suites, paired comparisons, cost/latency reporting and staged execution. All dataset sizes, budgets, scores and route results are proposals; no research experiment ran.

Only documentation, public-source research and the submission/checkpoint archive were updated for this task. No application code, dependency, database, deployment, provider configuration, document index, new agent or paid API call was added. The deployed Daybook behavior and passing 103-test/10-browser baseline below remain unchanged. Do not start integrations or evaluations from this plan until a later user instruction authorizes implementation. The next conversation should discuss/refine the experimental tier, comparison controls, reference cases and proposed call/dollar limits.

## Where we stopped

The user reported failed chat, then asked whether Vercel needed a Git connection and whether the provider API had been tested directly. **Direct API tests isolated two issues:** the earlier model's generation calls stalled; journal proposals were rejected with the 100-line array maximum in the provider grammar. The hosted model and source default are now `gemini-3.1-flash-lite`, and numeric array maxima are omitted only from the provider grammar. Original Zod/account/money/balance validation is retained. No automatic retries or paid plan changes were added.

Selected hosted cash/search/expense questions and a review-only supplies proposal succeeded. Independent endpoints matched the returned values and the journal list stayed unchanged. Provider failures are still intermittent: an expense timeout passed on manual repeat, and a later search failed after an earlier success. Do not present this as universal availability or a completed live accuracy evaluation. See [chat recovery evidence](docs/evidence/chat-recovery-verification.json).

New executable source is `7ecb435c421862dba5efd4e3b6f743c93fd1888e`; local build, native imports and **60 isolated tests passed**, with two added schema regression tests. [Full CI 41103851106](https://github.com/rayidali/spiich_homework/actions/runs/41103851106) **passed 103 backend tests, 10 browser workflows, native module imports and Docker startup/persistence**. The user reported the fix worked; an independent hosted Acme search returned HTTP 200 in 1.679 seconds with 12 entries, matching the transaction-list endpoint. Previous provider failures remain recorded; the full live evaluation is still pending. Hosting is updated to deployment `dpl_HQefAFAGwPS2x52c1nXPetRYovKq`. Vercel was deployed directly with local authentication, so GitHub not being connected to Vercel is expected: GitHub stores source/runs CI but pushes do not auto-deploy.

| Item                                         | Saved state                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Product                                      | **Daybook**; Spiich is the assignment recipient                                                                                 |
| Working source                               | `/Users/rayidali/Desktop/spiich_codinghw`                                                                                       |
| Hosted app                                   | [daybook-ledger-delta.vercel.app](https://daybook-ledger-delta.vercel.app), Vercel login required                               |
| Repository                                   | [rayidali/spiich_homework](https://github.com/rayidali/spiich_homework), public                                                 |
| Tested executable commit                     | `7ecb435c421862dba5efd4e3b6f743c93fd1888e`                                                                                      |
| Successful full CI                           | [41103851106](https://github.com/rayidali/spiich_homework/actions/runs/41103851106)                                             |
| Latest remote before this documentation save | `5dbcfdb21d99934a8772b448f5a59ad7cb9a6cd1`; this save adds a documentation-only commit                                          |
| Verified totals                              | **103 backend tests and 10 browser workflows**, native hosted module loading, Docker startup/health/container tests/persistence |
| Live AI                                      | Selected live financial questions and an entry proposal passed with Flash-Lite; intermittent provider errors remain             |
| Submission                                   | `submission.zip`, root `daybook-ledger/`, refreshed from reviewed source/docs with credential and integrity checks              |

The previous full CI passed after the hosting changes; the new model/schema fix also passed full CI and selected live confirmation. The earlier 94-test baseline is historical, preserved in [cloud-verification-before-hosting.json](docs/evidence/cloud-verification-before-hosting.json). Current evidence is [cloud-verification.json](docs/evidence/cloud-verification.json); live hosting evidence is [hosting-verification.json](docs/evidence/hosting-verification.json).

## User preferences and authorization

- AI-assisted implementation is authorized. Keep clear decisions, logs and explanations the user can rehearse. Never guarantee hiring acceptance.
- Keep Daybook's independent identity. The user wanted fewer choices and a much simpler interface; the implemented baseline is Home / Transactions / Reports / Settings.
- **Use local Terminal/CLI authentication for GitHub and Vercel. Do not use or propose chat account connectors.** Local accounts are `rayidali`; the earlier GitHub connector used a different identity and is irrelevant.
- Paid Jev/models/services are acceptable when justified; no paid subscription or plan upgrade has been purchased. Current Vercel/Neon resources use the observed free/Hobby plans. Provider request usage/billing was not established by the timeout.
- Proceed with authorized work without repeatedly requesting permission. Preserve database history and checksummed migrations. Keep keys and connection URLs out of source, docs, screenshots, chat and ZIPs.

## Implemented product

- **Ledger:** PostgreSQL double-entry journal, exact decimal strings, native and base amounts, deferred balance constraints, immutable posted headers/lines, linked exact reversals, idempotent creation and stale-draft revision protection. USD base; supported foreign account currencies and recorded rates. Four applied migrations remain unchanged.
- **Chart/reports:** account hierarchy/CRUD/archive behavior, trial balance, P&L, balance sheet including unclosed earnings, account ledger with opening/running balances, date filters and exports. Only posted entries affect reports.
- **Background work:** recurring schedules create reviewable drafts; transactional outbox queues anomaly analysis. Leases, bounded claims, retries and unique alert keys support safe reprocessing. Median amount deviations, duplicates and unusual vendor categories have explainable evidence.
- **AI:** native Gemini REST and OpenAI Responses adapters share deterministic proposal validation and approved financial tools. The model proposes entries or selects a tool; application-authored SQL and code compute answers. No arbitrary model-written SQL is executed. Posting requires an explicit reviewed request.
- **Retrieval:** PostgreSQL/text retrieval of relevant history and confirmed corrections. No fine-tuning. Jev, pgvector, Mastra, Wren, receipt ingestion, Gemini Files/File Search and bank/CSV imports are **not integrated**.
- **UI:** short USD money-in/out/transfer form, account-effects review then confirmation, advanced split/foreign journal mode, separate AI clarification/review. Paying an existing invoice reduces receivables rather than counting revenue twice. Chart-code-independent account eligibility and preparation/posting race protection are implemented.
- **Evaluation:** 40 labeled cases, 20 development/20 holdout, four-case smoke mode; exact entry/tool/evidence checks, correction retrieval and organization isolation, journal fingerprints, usage metadata and attempt/token limits. Synthetic fixtures use new workspaces; model output is never posted. Clarification meaning requires human review. The live harness has not completed.

## Hosting: actual resources and behavior

| Resource               | Saved identifier / behavior                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| Vercel account/team    | `rayidali` / `rayidalis-projects`; Hobby at provisioning                        |
| Vercel project         | `daybook-ledger`, `prj_5lvzp08Wa2E1A3pZPkm0UF9u9oYR`                            |
| Team ID                | `team_8FfnxIHgE2sKsb8m2q0hXs33`                                                 |
| Verified deployment    | `dpl_HQefAFAGwPS2x52c1nXPetRYovKq`, READY, production                           |
| Separate Neon database | `daybook-db`, `store_bcO6NqHC5sMcY31n`; free through existing Neon installation |
| Region                 | `iad1` for Functions/database provisioning                                      |
| Access                 | All-deployment Vercel protection; public requests reach sign-in                 |
| Daily schedule         | `/api/cron`, `0 6 * * *` UTC; automatic firing not observed yet                 |

The pre-existing unrelated database was not reused or changed. Hosted synthetic data is separate from `.tools/postgres` and the local Docker volume.

The Vite output is served by Vercel. `api/index.js` and `api/cron.js` are tiny JavaScript exports of generated native ESM bundles; the application implementation remains TypeScript in `server/hosting/`. `scripts/bundle-hosting.mjs` uses esbuild to resolve extensionless TypeScript imports before deployment. CI verifies both wrappers load under native Node. `vercel.json` includes generated `.vercel-build/**`, uses Node project settings supplied at deploy, allows 60 seconds per function and rewrites SPA/API paths.

Successful API mutations register bounded durable job processing through `waitUntil`. Daily cron calls scoped recurring generation and one bounded job batch. Docker/native retain their continuous worker loop. Larger hosted backlogs can wait for later invocations; this is a demo hosting tradeoff, not evidence of production throughput. Cron is wrapped in Express and separately requires its bearer secret; raw Vercel requests do not provide Express's `req.get()`.

### Credentials and future deployments

- The local `.env` contains the Gemini key. It was supplied server-side to the hosted deployment; it was **not** uploaded to the GitHub repository or configured as a GitHub Actions secret.
- Runtime `DATABASE_URL` uses TLS, the pooled host and restricted `spiich_app` with a generated strong password. The migration owner URL is supplied only in the build environment. `scripts/prepare-hosting.ts` migrates, hardens the role and seeds idempotently.
- The Neon integration is connected to the Vercel project's **development environment only**. Hosted runtime/build values were supplied as deployment overrides. **A fresh CLI deployment must explicitly receive the required values; do not assume project-level production variables or a Git auto-deploy connection exist.** See [hosting](docs/HOSTING.md).
- Private API payloads/responses and local-session curl configurations live under ignored `.tools/vercel-session/`. Some contain provider/database/Vercel/automation credentials. Never print or archive them. They are local operational state, not portable submission content.
- `vercel whoami`/other Node CLI network calls failed in this session despite valid login. Authenticated HTTP requests using the authorized local CLI session worked. Treat network failure separately from authentication. Credentials may expire; use normal local authorization when needed, never ask for secrets in chat or silently change identity.
- The deployed application has no application-level user authentication. Vercel protection controls demo access. Reviewer sharing remains an explicit next decision; do not disable protection merely to make automation work.

## Verified evidence and its limits

| Check                       | Result                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounting PostgreSQL tests | 29 passing                                                                                                                                              |
| AI/database contract tests  | 14 passing with controlled provider responses                                                                                                           |
| Provider unit tests         | 22 passing                                                                                                                                              |
| Evaluation unit tests       | 23 passing                                                                                                                                              |
| Simple-entry tests          | 6 passing                                                                                                                                               |
| Hosted scheduler tests      | 7 passing: authorization, methods, sequencing, safe errors                                                                                              |
| Total backend               | **103 passing in CI**; 60 isolated tests also passed locally                                                                                            |
| Browser                     | **10 production Chromium workflows passing in CI**; desktop/mobile emulation and keyboard checks                                                        |
| Build/config                | Formatting, strict TypeScript, production bundle, native hosted-module imports, migrations and Compose validation passed                                |
| Docker                      | Build, complete stack startup/health, containerized tests and posted-entry persistence after app/database container recreation passed                   |
| Hosted HTTP smoke           | SPA document, health, metadata, trial balance, P&L and balance sheet passed                                                                             |
| Hosted scheduler HTTP       | 401 without its secret; authorized call generated 0 due drafts, processed 4 jobs                                                                        |
| Gemini                      | Model-metadata request succeeded; hosted financial question timed out with safe HTTP 504 `AI_TIMEOUT`                                                   |
| Not verified                | Successful live generation/accuracy, automatic daily cron firing, hosted browser visual layout, physical devices, Safari/Firefox, load/failover/restore |

The recorded hosted trial balance for October 2026 had **$190,072.00** on each side and **$0.00 difference**. The balance sheet had **$132,420.00 assets = $178.00 liabilities + $132,242.00 equity**. These are timestamped synthetic demo observations, not permanent balances or the five-event learning example.

Fresh screenshots are available in the successful CI run's browser-evidence artifact but have not been visually inspected here. Checked-in screenshots document the earlier design. Passing browser behavior tests does not establish physical-device quality or live model accuracy. The opt-in CI `live-ai` job was skipped. The financial-chat timeout does not establish its root cause, provider usage or charges; model metadata access is not a generation evaluation.

## Local runtime and data preservation

At this checkpoint the listener inspection returned **no listeners on 5173, 3001 or 55432**. This is a point-in-time observation; recheck before starting anything. No local server/database was started or stopped for this documentation save. `.tools/postgres` remains the development data directory.

Preserve:

- `.tools/postgres`, all posted history, account compatibility names and `spiich_app` role identity.
- Compose named volume **`spiich_postgres_data`**; do not run `down -v` as routine cleanup.
- Applied migration checksums `001_ledger.sql` through `004_provenance.sql`; add new migrations when needed.
- Default organization `00000000-0000-4000-8000-000000000001` and idempotent seed anchor/completion markers. Do not reseed by deleting history.
- Existing checkpoints, including `.tools/checkpoints/before-gemini-implementation-2026-10-29.zip` and `.tools/checkpoints/before-hosting-documentation-checkpoint-2026-10-29.zip`.

This session previously could not bind local test sockets, connect to development PostgreSQL (`EPERM`), launch its browser or create project-root `.git`; no local Docker runtime was found. Node provider DNS failed earlier, but approved HTTP later reached Google and Vercel. Do not restate earlier networking failures as proof all network paths remain unavailable or bypass environment restrictions.

## Git publication and resume

The source directory has no `.git`; its `.git` path is read-only under this session policy. The existing permitted publishing checkout is **`/private/tmp/daybook-publish.kbVq33`**, branch `main`, origin `https://github.com/rayidali/spiich_homework.git`. Local Git add/commit/push succeeded. Git reports an old missing credential-helper path, but another existing helper authenticates; global Git configuration was not changed.

Use that checkout while it exists. Temporary storage may disappear between sessions; check before using it, and recreate a permitted checkout from the existing remote if needed. Never overwrite source or the database while recovering Git. `.tools/publish-checkout.json` and `.tools/github-upload-manifest.json` record local publishing metadata. Only allowlisted source/docs are copied; `.env`, `.tools`, database data, dependencies, builds, browser state and ZIPs are excluded. Documentation-only commits can use `[skip ci]`; application changes require relevant checks.

## Next session: ordered work

1. Read this checkpoint, [hosting](docs/HOSTING.md), [verification](docs/VERIFICATION.md), and the latest [build log](docs/BUILD_LOG.md). Inspect Git/CI/deployment status without changing identity or printing secrets.
2. Review the new queued CI result and assess **intermittent provider failures** with bounded calls. Distinguish provider latency, request format/settings and hosting connectivity using sanitized timing/error evidence; direct tests showed model-dependent failures and a separate provider-schema rejection; the latter is fixed. Do not silently add retries or mislabel provider failures as bad keys.
3. Generation now works on selected requests; run the existing isolated smoke suite, inspect failures/clarifications, then development cases. Freeze model/settings/cases before the held-out repeated run. Keep the production demo untouched; use fixture-capable credentials only in the evaluation environment.
4. Retrieve and visually inspect fresh CI screenshots, replace historical images only after review, check the hosted browser flow and a real phone/additional browsers as available.
5. Observe a scheduled daily cron invocation; inspect durable backlog and failed jobs. The manual authorized call established the handler, not the platform timer or sustained processing rate.
6. Decide how reviewers will access the protected demo. Keep the application protected while it contains a writable shared workspace and a billable provider key.
7. Rehearse the six-minute demo, report limitations plainly, refresh the submission archive after changes. Optional Jev/vector comparisons follow a measured baseline, not before.

### Useful local commands

```sh
lsof -nP -iTCP:5173 -iTCP:3001 -iTCP:55432 -sTCP:LISTEN
npm run dev
```

If only the existing local PostgreSQL is running, use `npm run dev -- --reuse-db`; never start two servers against `.tools/postgres`. For capable runtime verification:

```sh
npm test
npm run build
npm run hosting:bundle
node -e "Promise.all([import('./api/index.js'), import('./api/cron.js')]).then(() => process.exit(0))"
npm run dev -- --test-browser --reuse-db --production
npm run format:check
npm run ai:evaluate -- --suite smoke
```

For Docker:

```sh
docker compose up --build --wait
docker compose --profile test run --build --rm tests
node scripts/check-compose-persistence.mjs --execute
docker compose --profile evaluate run --build --rm evaluate
```

The evaluation CLI defaults are smoke: 4 cases / 8 attempts / 32,000 observed tokens; development: 20 cases / 32 attempts / 150,000 tokens; holdout: 20 cases repeated three times / 96 attempts / 400,000 tokens. Correction probes may use multiple calls. Lower limits with CLI options as needed. No automatic retry; unknown usage stops subsequent calls. An in-flight response can exceed the token threshold, so it is not an absolute spending ceiling. See `npm run ai:evaluate -- --help`.

## Design, research and documentation

Project-local Emil Kowalski guidance remains at `.tools/design-skills/skills-main`, revision `a81dbca07f2217b7103e510c0f13f8d5b017afc9`; provenance and application are in [design](docs/DESIGN.md). It is excluded local tooling, not a globally installed package.

The [PDF](docs/reports/architecture-review.pdf) and [interactive HTML](docs/reports/architecture-review.html) are the earlier planning snapshot. Do not relabel their proposed features/UI as current deployment evidence. [Architecture](docs/ARCHITECTURE.md) preserves pinned research and production tradeoffs. No researched upstream app was installed or incorporated.

All project Markdown documents were synchronized for this checkpoint. [README](README.md) is the entry point, [API](docs/API.md) documents REST/cron behavior, [plan](docs/PLAN.md) orders remaining work, [walkthrough](docs/ACCOUNTING_WALKTHROUGH.md) separates learning amounts from seeded data, and [interview guide](docs/INTERVIEW_GUIDE.md) supplies accurate explanations. [Build log](docs/BUILD_LOG.md) is chronological; earlier pending/failure statements there are historical and superseded by this checkpoint.

The refreshed archive contains reviewed source, documentation and sanitized evidence under `daybook-ledger/`. Private session files are preserved locally for continuity and excluded. Authentication/authorization within the app, bank/invoice/tax workflows, period-end FX revaluation and measured production capacity remain outside the delivered scope.
