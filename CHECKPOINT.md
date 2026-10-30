# Daybook session checkpoint

Saved **2026-10-30, America/New_York** (verification timestamps may read 2026-10-30 in UTC). Read this first on resumption. Continue the implemented application; do not rebuild or restore an earlier ZIP over it.

## Active request: research implementation (supersedes planning-only checkpoint)

The user now explicitly authorizes implementation of the complete nine-route study, checkpoint tests, live Gemini/Jev experiments and a detailed scientific-style report with controls, comparable scores and graphs. The earlier planning-only text below is historical. Both provider keys are present in private `.env` (2026-10-30); no keys belong in source or chat. Jev research allowance is $4 of the user's $5 credit. Preserve the deployed application while experiments use separate synthetic data and restricted analytical access. New research source is under `research/`; do not confuse its in-progress tests with the prior fully passing application baseline. Implementation and evaluation are in progress, with no study result yet claimed.

## Current checkpoint: changed key checked under a one-request limit

The user replaced the local Gemini key and requested frugal use. Its value differs from the previous research request, and no inherited environment value overrides `.env`. One fixed `gemini-3.5-flash-lite` availability request succeeded at **2026-10-30T23:52:57.995Z**: HTTP 200, 878 ms, 14 input tokens, 5 output tokens, **$0.0000167 paid-equivalent estimated usage**. This is momentary API availability, not an account-balance, billing-tier, project-identity, document-index access or accuracy check. See [probe receipt](docs/evidence/gemini-key-check-2026-10-30.json) and [restriction verification](docs/evidence/gemini-frugal-checkpoint.json). Hosted credentials and deployment were not changed.

**The large study remains stopped.** A persistent policy beside `.tools/research/usage.json` permits only **one fixed probe / $0.01 additional Gemini / $0 additional Jev**. The one attempt is consumed. The policy, required-policy marker and recovery journal survive process restarts; ordinary runners are blocked even after successful recovery. Do not remove them or fall back to the earlier $10/$4 allowances. All 840 historical usage records are unchanged; the ledger now contains 841 records. Gemini's cumulative tracked estimate is $0.77137635, including the preserved unknown-use reservations. This cumulative total spans both keys and is not the new key's charge or account balance.

The user was asked for an additional Gemini limit ($0.25, $1 or $3); **no answer has been received**. Do not treat a preselected choice or elapsed time as permission. Before further requests, obtain the user's budget decision and implement an explicit, audited replacement for this consumed probe-only policy without deleting history. The existing File Search store may belong to the prior key's project; access with the new key is unverified. Do not automatically re-index.

The guard adds truthful key-change authorization and persistent limits. **417 isolated tests across 27 files and the TypeScript/production build passed**; the previous full cloud CI remains the published `05a9fe3` baseline until fresh CI is recorded. No new development score, held-out result or final freeze was produced. Source hash: `bbccba5d944d0af6e1d8c4edce5b7618153f597969d1fed577bacf052d0de6b9`.

Next research work, once an explicit budget is available: select a balanced development smoke before touching holdout, check any project-bound index access within that budget, freeze the source after development, then run the agreed comparison. The original plan remains 1,620 held-out route episodes plus 240 reviewer outcomes. Any reduction in repetitions must be a dated amendment before holdout, applied equally across routes; no favorable-case selection or silent partial-study completion.

The quota-stop details below describe the preceding checkpoint. The one-request restriction above takes precedence over their former spending and recovery instructions.

## Previous research checkpoint: daily quota stop, offline corrections

**No live runner or dispatcher is active.** Pilot-v2 terminated at **101/108 episodes** after Gemini reported its **500-request daily free-tier quota** and the persisted provider circuit opened. There are 83 `ok`, 9 `blocked`, and 9 `error` records; seven planned attempts are missing. `ok` does not mean correct. The full ledger/document/vector fingerprint remained **`2f9897602b08ac17130f103a38093ca913bc3871c1ab7a4da871e7c028b68f8c`**, and source integrity passed. Runner session 41536 exited 1; dispatcher cell `g10:91` and watcher session 2625 are finished. No ready jobs remain. Do not restart the old pilot under changed source.

Read [V2 interpretation](docs/evidence/research-runs/pilot-v2/README.md), its [bound validity notice](docs/evidence/research-runs/pilot-v2/validity-notice.json), and [dispatch evidence](docs/evidence/dispatch-pilot-v2.json). The dispatcher handled 365 requests: 360 HTTP 200, one HTTP 504, and four HTTP 429, all curl exit 0. Minimum measured Gemini pre-curl start spacing was 4,594 ms. The quota response identifies `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 500, with initial retry delay 29,601 seconds. A conservative reset probe would be after **2026-10-31 07:01 UTC / 03:01 New York**, subject to the documented reset and a successful actual probe. This is a daily limit, not a pacing failure. A new key in the same project shares the quota.

The user has been asked to enable Tier 1 billing for the existing Gemini project or choose continuation across daily resets. **No confirmation or account upgrade has been observed.** Existing research allowances remain **$10 Gemini / $4 Jev**, including unknown-use reservations. Do not change billing, rotate providers/models to evade quota, delete usage history, or silently retry failed scored IDs. The API's current circuit is open. The [one-shot recovery helper](docs/research/QUOTA_RECOVERY.md) is implemented and tested: it binds the previous three daily-quota 429 records and precise usage snapshot, preserves costs/caps, consumes its permit before a fixed non-study probe, and leaves ordinary calls blocked unless valid usage and valid output return. A failed probe requires separate investigation; its original quota evidence cannot simply be reused for another permit. Stale budget locks and corrupted usage files fail closed rather than being deleted or overwritten. No live recovery probe has occurred.

At the quota stop, cumulative research usage contained **727 Gemini calls**, with **$0.57577435 paid-equivalent reported usage + $0.19558530 unknown-use reservations = $0.77135965 tracked**, and **113 Jev calls / $0.00718754 tracked**. These are configured-rate estimates/reservations, not provider invoices. Keep the actual $5 Jev account credit distinct from the $4 local ceiling.

### Final development corrections before held-out freezing

- Queued curl completions now include a terminal marker, and the reader waits through empty/partial `.done` files under the original deadline. The V2 R6 cash failure is still an **inferred** read race: the final response was HTTP 200/exit 0, but the exact partial bytes were not captured. Twelve new regressions plus the core suite passed; historical outcome/reservation unchanged.
- A pre-holdout audit found the original R0 measurement schema could not return the tags used by the shared rubric. R0 now receives the same full assumption/clarification catalogs within its existing single call. Metadata is emitted by the model and never inferred from gold labels or passed to SQL. Four financial tools, clarification, proposal workflow, scope and call count remain the same. Provenance explicitly discloses normalized schemas. Nine new metadata tests plus prior baseline/validation tests passed. CLARIFY-versus-BLOCK remains a disclosed behavior-protocol limitation, not proof of harmful acceptance.
- R1–R8 share clearer output instructions: draft amounts belong in `proposalLines`, historical ledger metrics require posted evidence, each intermediate calculation needs provenance, and tags must match their exact meanings. Deterministic gates and reference labels are unchanged. No held-out outcomes informed this amendment.
- External analysis includes retrieval/failure/per-call timing, a predeclared common-capability subgroup with explicit source amendments, and PDF graphics/provenance. The narrative is `docs/reports/research-study.md`. Fixed-weight sensitivity and the audited recovery helper are complete. The final offline checkpoint passed **399 tests across 26 files**, strict TypeScript/production build and global formatting. See `docs/evidence/research-local-v3.json`, source hash `28ac6366b03d38da8eed431c3063494cea2e221c4324e37b43efe79976317b37`. Published as `05a9fe3`; full cloud CI `41142335257` passed verify, compose and research-native. The opt-in live-AI job was skipped. No final live smoke or held-out freeze exists.

**Next live work:** after account capacity is confirmed or the documented quota reset is eligible, run one audited availability probe. Then perform a small, separately named development smoke of corrected metadata/transport/shared instructions. Freeze the complete final source and preserved reviewer calibration using `scripts/research/freeze.ts`. Only then execute the planned **1,620 held-out route episodes** and **240 held-out reviewer outcomes**. These remain unrun. Do not tune after inspecting them. Final component selection, final figures/conclusions, CI and archive refresh remain outstanding. The goal is incomplete.

### Published and archived baseline

Latest published executable research source is **`05a9fe3488f7dcbd6d137c6a2780aab0f5675e3d`**; full [CI 41142335257](https://github.com/rayidali/spiich_homework/actions/runs/41142335257) passed verify, compose and research-native. Evidence is `docs/evidence/research-ci-v3.json`. A later documentation-only checkpoint commit may follow; the runtime fingerprint remains `28ac6366b03d38da8eed431c3063494cea2e221c4324e37b43efe79976317b37`. Production remains executable **`7ecb435c`** and has not received the research routes.

Pilot-v1 completed 108/108 but is explicitly invalid for architecture selection because of its control evidence adapter, backend grammar and initial dispatcher gaps. Raw records, source hashes, notices, per-call usage, supplemental analysis and its 12-page PDF remain intact. V2 is incomplete and diagnostic for the reasons above; neither can name a winner.

The submission archive is rebuilt after saving this checkpoint using `.tools/prepare-publication.py`. Its current hash, file count, CRC/secret-scan and byte-equality results are stored in ignored `.tools/publication-archive-verification.json` and `.tools/publication-verify-verification.json`; do not embed the ZIP's own hash inside its contents. Preserve `.gitattributes` PDF binary handling. `.tools/report-render/bin/python` has ReportLab and PyMuPDF for standalone PDF generation/inspection. The final publication flow must leave source, the permitted checkout and `submission.zip` byte-matched.

The sections below preserve earlier implementation checkpoints and deployment details. Their then-active run descriptions are historical; the current stop and ordered next work above take precedence.

## Latest completed engineering checkpoint

Research implementation published as **`07469a6ab8d2ca32b075bfb99ccbd264ddc05672`**. [Full CI 41135032615](https://github.com/rayidali/spiich_homework/actions/runs/41135032615) passed application verification/browser workflows, Docker tests/persistence, and the new isolated native pgvector/Wren database checks. Local checkpoint: **306 isolated tests + production build + formatting passed**, plus **22 actual Wren Python tests**. See [research CI evidence](docs/evidence/research-ci.json). The deployed application's executable commit remains `7ecb435c`; research was not production-deployed.

Reviewer development is complete: 240 outcomes across 80 cases and three reviewer methods, including four Gemini HTTP429 failures. Jev threshold is fixed at 0.8 using development labels only; raw outcomes/calibration remain under `docs/evidence/research-verifiers/verifiers-v1/`. No held-out reviewer result yet. Expanded freeze helpers bind complete source/reference/outcome hashes before held-out calls.

The 108-episode **pilot-v1** is running under process session 29822 as of this entry. Do not start another runner while `.tools/research/runner.lock` is live. Agent `/root/wren_research` owns a persistent private queue dispatcher; `.tools/research/pump-state.json` and `pump-metrics.jsonl` contain sanitized operational timing. Create `.tools/research/pump-stop` only to stop it after its current request. Initial pilot R0/R1 and one R7 timeout resulted from startup dispatch gaps; preserve these as harness failures. Wren planner selections have also failed the backend gate on early development questions. Do not tune source during this frozen run; diagnose and amend a separately identified development version afterward.

New queued requests expire within request deadlines. The old 300-second allowance described below is superseded. Service the queue continuously; a slow dispatcher creates real harness failures. Both runtime pacing and external dispatch pacing are enabled. The pending user question about enabling paid Gemini billing is unanswered; no upgrade is assumed.

## Research implementation checkpoint (2026-10-30, before scored pilot)

- New source: `research/`, `scripts/research/`, `tests/research-*.test.ts`, `docs/research/`. Nine route adapters, exact analytical compiler/calculator, source/unit validation, structured scoring and HTML/SVG report generation are implemented. Research generator is normalized to **gemini-3.5-flash-lite** after two 3.1 high-demand preflight failures; production still uses 3.1. Reviewer is a separate same-model invocation, not statistically independent weights. Jev is pinned to 1.14.0, Wren Rust core to 0.8.2, embedding model to 001/768 dimensions.
- Synthetic fixture: 120 questions / 60 grouped paraphrase pairs / 60 development and 60 held-out questions, six families; 160 reviewer candidates (80 correct/80 flawed); 60 component-security cases; 60 journals / 19 accounts / 40 documents. Gold labels are excluded from provider inputs. No human adjudication or blinded prose review has occurred.
- Local TCP and Unix socket probes still fail EPERM. Approved `curl -fsSL` works. The native Node research runner can use `RESEARCH_TRANSPORT=queue`: requests are privately queued under `.tools/research/queue`; execute `node --import tsx scripts/research/prepare-queue.ts 1`, then, only when queued>0, `curl -fsSL --config .tools/research/batch.curl`. Pump continuously during episodes; queued dispatch delay counts in harness wall latency. Curl files/bodies/headers contain secrets and must never be printed or published. Normal reproduction uses native fetch, without the queue.
- The existing Neon database hosts a **separate research schema** and `daybook_research_reader`, scoped to fixed synthetic workspace views. It cannot read research base tables or demo journal tables, create tables, or write. Runtime credentials are private in `.tools/research/database-private.json`; owner credentials are used only for setup/indexing. Original app tables and migrations were not changed. This is logical isolation on a shared physical database, not a new database server.
- Live database evidence: `docs/evidence/research-database-check.json`: custom compiler and actual Wren/PostgreSQL returned 164615.00 cash, matching the independent oracle; access/write gates and unchanged ledger fingerprint passed. `research-fixture-check.json` matched all 114 posted scoped lines/57 entries, all 39 authorized documents and their 768-dimensional embeddings against complete source contents. The full corpus includes a 40th foreign-workspace canary, excluded from the reader/File Search store.
- Both indexes complete. `.tools/research/index-state.json` records all 40 vectors and 39 authorized File Search documents. Store was created and indexed using Google APIs. Legacy generateContent File Search returned no usable grounding; current Interactions API returned actual File Search steps/citations, resolved against authorized original documents. Managed citation order is not raw top-k ranking; do not invent MRR/recall of hidden chunks. `research-retrieval-smoke.json` records all four retrieval variants finding Acme's contract; initial failures are preserved separately.
- `research-security.json`: **57 PASS / 0 FAIL / 3 UNASSESSED**, no hard-gate failures, fingerprint unchanged. These are component/projection checks, not proof that all natural-language attacks are handled. Three cases require live-model or absent-store behavior. Live adversarial episodes remain pending.
- Exploratory route preflights: R0 and R1 cash passed; R4 hiring initially computed the right amount but cited a source instead of its derived calculation, and validation rejected it. After the common protocol prompt clarified derived citations and metric names, the development preflight passed with 7080.00 recurring cost and 3000.00 recruiting. All attempts are separate timestamped JSON evidence. These are not held-out accuracy scores.
- Latest major local checkpoint had 176 passing isolated tests; subsequent suites added security, full fixture checks, route orchestration, verifier study and Interactions checks. A fresh aggregate count/build/CI is required before claiming a new complete baseline. Wren's real-engine Python suite passed 22 tests. The last full published application CI remains the 103-backend/10-browser run below.
- Cost ledger: `.tools/research/usage.json`, no secrets. Reserves are made before calls; unknown usage is retained conservatively. Gemini cap $10, Jev cap $4 of the user's $5 credit. Three consecutive unreported generation attempts open a persisted circuit. Interactions tool-use input tokens count toward cost; one early undercount was corrected with an audit artifact. Actual account billing/free-tier charges remain unknown; report paid-equivalent estimates separately from reservations.
- Next: finish portability/provider metadata amendments, format/hash the final source, run 108 development pilot episodes, the development reviewer calibration, then freeze settings and run the 1620 main held-out episodes and held-out reviewer cases. Complete report/graphs/paired uncertainty/ablations, product decision, full CI, documentation and submission archive. No research source has yet been published or production deployed. The goal is active and incomplete.

### Original planning checkpoint (historical)

The earlier task produced the preregistered [research plan](docs/PLAN.md) without implementation. The user's later explicit full-build request superseded that stop point. Planning commit `a328f9d` is the published ancestor; current research source is newer working source. Preserve the distinction between production app checks, research contract tests, development live measurements and held-out results.

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
