# Verification record

## Changed-key check and spending guard — 2026-10-30

The replacement local Gemini key passed exactly one fixed availability request: HTTP 200, 878 ms, 14 input/5 output tokens, $0.0000167 paid-equivalent estimated usage. [Receipt](evidence/gemini-key-check-2026-10-30.json). No study questions, documents, indexing, Jev requests or hosted deployment were involved. Account balance, project identity, remaining quota and existing File Search access are unverified.

A persistent one-request/$0.01 additional Gemini/$0 Jev policy remains in force after the success. A reconstructed default-budget instance rejected an ordinary call before reaching transport; all 840 previous usage records are preserved, with one new probe record. [Policy verification](evidence/gemini-frugal-checkpoint.json). Missing/malformed policy, changed history, wrong key, extra requests and unknown usage have offline coverage. The new revision passed **417 tests in 27 files** and strict TypeScript/production build. Published revision `675a7c4` passed [full CI 41147321748](https://github.com/rayidali/spiich_homework/actions/runs/41147321748): application/browser, Docker/persistence and native Wren/pgvector jobs succeeded; live-AI was skipped. [Sanitized CI evidence](evidence/research-ci-key-guard.json). The cloud result in the historical section below predates this guard.

No larger budget answer or additional study run exists. The following section records the previous published checkpoint.

## Previous research checkpoint — 2026-10-30

Research runtime **`05a9fe3488f7dcbd6d137c6a2780aab0f5675e3d`** passed [CI 41142335257](https://github.com/rayidali/spiich_homework/actions/runs/41142335257): application/backend and browser verification, Docker startup/persistence, and native pgvector/Wren checks. The opt-in live-AI job was skipped. [CI v3 evidence](evidence/research-ci-v3.json) records completed jobs/steps; exact new CI test counts were not extracted from protected logs.

The same runtime passed **399 isolated local tests across 26 files**, strict TypeScript/production build and global formatting ([local evidence](evidence/research-local-v3.json)). The database-dependent application tests and browser workflows ran in CI, not in this restricted local environment. New changes include completion-file framing, normalized control metadata, clearer output instructions and an audited one-shot quota recovery helper. Production remains unchanged at `7ecb435c`.

The first 108-episode development pilot completed but has a bound invalidity notice for adapter/grammar/dispatch defects. The second recorded **101/108 episodes**, then stopped at Gemini's observed **500-request daily free-tier quota**. Its full scoped ledger/document/vector fingerprint was unchanged, and source integrity passed. Raw V2 counts are **83 ok, 9 blocked, 9 error**, with seven attempts missing. An `ok` execution does not establish correctness. The dispatcher and watcher are stopped; the persisted provider circuit remains open. A genuine HTTP 504, four quota HTTP 429 responses and an inferred completion-file read race remain visible.

The [V2 diagnostic PDF](evidence/research-runs/pilot-v2/study-report.pdf), [raw report](evidence/research-runs/pilot-v2/report.html), [validity notice](evidence/research-runs/pilot-v2/validity-notice.json) and [dispatch evidence](evidence/dispatch-pilot-v2.json) document this incomplete run. PDF pages were rendered and checked for page bounds; selected chart/cover pages were visually inspected. This is report verification, not live model validation. The completed reviewer development study contains 240 outcomes with four provider errors and a threshold selected only on development data.

**Not measured:** 1,620 planned held-out route episodes, 240 held-out reviewer outcomes, independent human prose quality, and the final component decision. Account billing has not been changed; an audited availability probe and a small corrected development smoke must precede the final freeze. No failed scored episode is silently retried, and no unknown-use reservation is deleted.

## 2026-10-30 live AI recovery update

The hosted model and source default are now **`gemini-3.1-flash-lite`**. Direct API testing reproduced the earlier model's generation timeouts and confirmed working text/JSON/tool calls on Flash-Lite. A separate journal-proposal rejection was traced to the 100-line `maxItems` constraint in Gemini's decoding grammar: the transport now omits array maxima, while the full original Zod limit, account checks and exact-money/balance rules remain enforced locally.

Selected hosted checks succeeded: cash **$125,620.00**, **12 Acme Corp entries**, September expenses **$9,265.00**, and a review-only **$340 Supplies debit / Company credit card credit** proposal. Cash/search/expense values matched independent endpoints, and the 73-entry journal list was unchanged. An initial expense timeout succeeded on manual repeat, while a later search failed; **intermittent provider failures remain**. No automatic retry, paid-plan change or accuracy guarantee was introduced.

Local build/native imports and **60 isolated tests** passed, including two new schema regressions. [Full CI](https://github.com/rayidali/spiich_homework/actions/runs/41103851106) for source `7ecb435c421862dba5efd4e3b6f743c93fd1888e` **passed 103 backend tests, 10 browser workflows, native hosted imports and Docker startup/persistence**; the opt-in live evaluation job was skipped. These selected checks are not the full 40-case live evaluation. [Detailed evidence](evidence/chat-recovery-verification.json) records successes and failures. Earlier timeout-only notes below describe the 2026-10-29 snapshot.

> Saved 2026-10-29 America/New_York. Full CI on executable commit `576a2468feacf9bd1d040c75bb1c5ff203f28dae` **succeeded**: [run 40999183176](https://github.com/rayidali/spiich_homework/actions/runs/40999183176). Hosted HTTP checks are recorded separately. Live generation/accuracy, fresh visual inspection and physical-device checks remain pending.

## Historical hosted verification snapshot — 2026-10-29

| Check                 | Evidence                      | Result / scope                                                                                                            |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL/accounting | CI verify and container tests | 29 accounting + 14 AI/database contracts                                                                                  |
| Isolated tests        | CI and local execution        | 24 provider + 23 evaluation + 6 simple-entry + 7 scheduler                                                                |
| Backend total         | `npm test`                    | **103 passing**; provider responses controlled                                                                            |
| Production browser    | CI Chromium                   | **10 passing**; real accounting flows, mocked AI review, desktop/mobile emulation                                         |
| Build                 | CI                            | Formatting, strict TypeScript, Vite production output, both native hosted module imports                                  |
| Docker                | CI compose job                | Image build, complete startup, health, containerized tests, unchanged posted-entry persistence after container recreation |
| Hosted app/API        | Authenticated HTTP smoke      | SPA document, health, metadata, P&L, trial balance and balance sheet passed                                               |
| Hosted scheduler      | Authenticated HTTP smoke      | Missing bearer secret: 401; authorized: 0 due drafts, 4 jobs processed                                                    |
| Gemini access         | Authenticated Google request  | Configured model metadata accessible                                                                                      |
| Live financial chat   | Hosted API request            | **504 `AI_TIMEOUT` after 25 seconds**; successful generation not established                                              |
| Automatic timer       | Configuration only            | Daily 06:00 UTC cron; automatic firing not observed                                                                       |

The backend total is 29 + 14 + 24 + 23 + 6 + 7 = 103. The 60 isolated tests are included, not additional tests. The ten browser workflows are separate. CI's live-AI job was skipped. Browser checks disable the live key and do not measure model accuracy. Native import checks establish that both hosted modules load; live HTTP smoke independently established deployed API/report/scheduler behavior.

Evidence files:

- [Current CI result and job steps](evidence/cloud-verification.json). Both verify and compose succeeded; live-ai skipped.
- [Hosted HTTP observations](evidence/hosting-verification.json), deployment `dpl_HQ4Hm8iULs7nXjhgR2JzuhFAXjLA`.
- [Earlier 94-test baseline](evidence/cloud-verification-before-hosting.json), retained as historical evidence.
- [Earlier restricted local attempt](evidence/verification-attempt.json), retained rather than relabeled as a pass.

## Hosted financial observations

The protected [Daybook deployment](https://daybook-ledger-delta.vercel.app) returned October 2026 trial-balance totals of **$190,072.00 debits and $190,072.00 credits**, with **$0.00 difference**. Its balance sheet reported **$132,420.00 assets, $178.00 liabilities and $132,242.00 equity**, with **$0.00 difference**. The P&L endpoint responded successfully. These are synthetic seeded-workspace values at the observation time; they are not the five-event accounting fixture or permanent balances.

Anonymous requests reached Vercel sign-in. Private automation authenticated the HTTP checks without disabling deployment protection. Hosted SPA HTML delivery was checked; this is not a fresh browser layout or physical-device review.

The scheduler required both deployment access and its own bearer secret. The authorized manual call processed a bounded batch. It does not prove the automatic daily timer has fired, that queues always drain, or that recovery/load objectives are met.

## Historical timeout investigation — superseded by the recovery update above

The user saved a Gemini key locally and it was supplied server-side to Vercel. A Google model-metadata request succeeded for the configured model. A hosted financial question returned the handled 25-second timeout. This establishes neither a successful generation nor the cause of the timeout. No completed smoke/development/holdout score, successful live latency benchmark, provider usage or billing result is claimed. Do not call the key untested or infer it is invalid from the timeout.

The insight endpoint has no journal-posting path. Contract tests verify account/tool/argument checks, exact SQL results and organization scope using controlled responses; they do not establish semantic accuracy from a live provider.

Investigate the timeout using bounded sanitized probes, then run:

```sh
npm run ai:evaluate -- --suite smoke
npm run ai:evaluate -- --suite development
npm run ai:evaluate -- --suite holdout --repeats 3
```

Use a capable environment with migrated PostgreSQL and fixture-creation credentials separate from normal runtime access. The harness creates new synthetic workspaces and predefined fixtures, fingerprints journals, and never posts model output or resets the demo. Smoke defaults to four cases/eight attempts/32,000 observed tokens; development to 20 cases/32 attempts/150,000 tokens; holdout to 20 cases repeated three times/96 attempts/400,000 tokens. Lower limits using CLI options. No automatic retry. Unknown usage stops subsequent calls; an in-flight response can exceed the token threshold, so it is not a hard billing ceiling. Inspect clarification meaning manually before interpreting pass counts.

With Compose, `docker compose --profile evaluate run --build --rm evaluate` uses the separate evaluation profile. Freeze model/settings/cases before holdout; disclose reuse if held-out failures guide tuning.

## Historical hosting CI and publication

Source was pushed using local `rayidali` Git authentication from the permitted temporary checkout. The public repository contains reviewed source/docs and no local keys or database. The tested executable commit is `576a2468feacf9bd1d040c75bb1c5ff203f28dae`; later checkpoint changes are documentation/evidence only.

Push/PR/manual workflows run PostgreSQL tests, production browser workflows, native hosted module import checks and Docker startup/persistence. The optional manual `live_ai` input adds four smoke cases only after verify/compose pass, with a four-attempt/32,000 observed-token guard. It requires a GitHub repository `GEMINI_API_KEY` secret and optionally `DAYBOOK_GEMINI_MODEL`. That secret has **not** been configured; the live job was skipped. A hosted key is not automatically a CI key.

Fresh screenshots are in the successful run's browser-evidence artifact. They have not been visually inspected here; checked-in screenshots remain the earlier design. Physical phones, Safari/Firefox and a formal accessibility audit are unverified.

## Environment observations

Earlier local PostgreSQL/socket calls returned `EPERM`, browser launch failed, and Node provider DNS failed. Subsequent approved HTTP reached Vercel/Google and full remote CI passed. Distinguish these execution paths rather than claiming networking is universally unavailable. No local Docker runtime was found. At this checkpoint no listeners were observed on 5173/3001/55432; recheck before starting anything. No runtime or model calls were made for this documentation save.

The two upstream Zod/Rollup annotation warnings remain nonfatal. Documentation verification for this save covers Markdown formatting, local links, stale-status review, credential exclusion, and ZIP/source equality; unchanged application suites were not rerun unnecessarily.

## Historical implementation verification

The following records describe earlier iterations and their executed checks. Current counts and deployment evidence are above; do not sum historical totals into the current suite.

Implementation checks were recorded during the build and redesign session; documentation was synchronized on 2026-10-29 in the local macOS arm64 workspace. This file distinguishes executed checks from checks that need another environment.

### Executed successfully before this iteration

| Check                          | Evidence                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Real PostgreSQL integration    | Isolated native PostgreSQL 18.4 installed for development; application queries used the restricted role |
| Database and application tests | 29 passing tests in `tests/accounting.test.ts`                                                          |
| AI provider contracts          | 8 passing tests in `tests/ai-contract.test.ts`; controlled provider responses, no live model            |
| Production browser workflows   | 8 passing Playwright tests against the built app in Brave/Chromium                                      |
| TypeScript and bundle          | `npm run build`; strict TypeScript including unused declarations/parameters                             |
| Compose configuration          | Docker Compose v2.40.0 `config --quiet`; downloaded CLI checksum verified                               |
| Missing-key behavior           | `npm run ai:evaluate` exited 2 with an explicit missing-key message and made no model calls             |

The standalone `npm run dev -- --test` command also restarted its own PostgreSQL, passed all 37 tests, and exited successfully. A subsequent normal development startup served HTTP 200 and the clean demo's 72 posted entries, one draft, and three review alerts. No duplicate seed records appeared after restart.

The financial example asserts $25,340 closing trial-balance totals, $15,000 revenue, $2,740 expenses, $12,260 profit, $22,600 assets, $340 liabilities and $22,260 equity. Tests also cover direct-SQL invariant rejection, 12 simultaneous same-key creates, an edit/post race, stale review, foreign currency, historical reporting, equal-date pagination, month-end/leap-year recurrence, failed-template isolation, lease recovery, and exact large-number formatting.

Browser coverage exercises Daybook branding, exact chart data, keyboard focus restoration, mobile menu focus containment, reduced motion, touch input sizes, navigation, manual posting/reversal, reports/ledger, mobile viewport overflow, unavailable AI, complete unused-account management, recurring create/edit/pause, and anomaly review/reopen. Browser runs seed a new organization and do not reuse the demo workspace. Screenshots are available for [desktop](evidence/dashboard.png), [trial balance](evidence/trial-balance.png), and [mobile](evidence/mobile.png).

The handoff also validates local Markdown links and refreshes the submission ZIP from the saved source and documentation. Application tests were not rerun for this documentation-only checkpoint.

The production bundle builds successfully. The installed Zod version emits two nonfatal Rollup warnings about upstream `@__PURE__` comments; Rollup removes the misplaced annotations. No dependency source was modified to hide those warnings.

## Still pending

- **Live AI:** model-metadata access succeeded, but hosted generation timed out. Diagnose that failure, then run bounded smoke/development/holdout cases and review clarification meaning. No live accuracy or usage score exists.
- **Production capacity:** no million-user benchmark, multi-region exercise, load/failover test, or restore drill has been performed. See the architecture's workload and production plan.
- **Browser scope:** automated checks used one Chromium-family browser at desktop and 390px mobile widths, including a touch-enabled browser context. Safari, Firefox, a formal accessibility audit, and real mobile devices have not been checked.

## Reproduce

From a clean local checkout, with dependencies installed and ports free:

```sh
npm run dev -- --test
npm run build
npm run dev -- --test-browser --production
npm run format:check
```

If the development PostgreSQL is already running, add `--reuse-db` to launcher commands. If using an external PostgreSQL, set both URLs in `.env.example`; migrate before running `npm test` directly. Browser installation may require `npx playwright install chromium`.

On a Docker-enabled machine:

```sh
docker compose config --quiet
docker compose up --build --wait
docker compose --profile test run --build --rm tests
```

Open the UI, post a clearly labeled test entry, restart the app, and confirm that the entry and reports persist. Reverse the test entry to preserve the audit trail. `docker compose down` stops services without deleting the named volume. Removing the volume is a separate destructive reset and is not part of routine verification.

## Defects found and corrected during verification

- An assistant scroll effect implicitly returned a browser value React treated as a cleanup function; opening the assistant could crash the page. Changed the effect to return only its intended cleanup behavior and added a UI error boundary.
- A historical balance-sheet request incorrectly inherited the current-month start validation. As-of reports now validate only their cutoff date, with a regression test.
- Draft revisions now prevent stale edits and stale posting confirmations.
- Recurring generation initially shared one all-or-nothing batch. Savepoints now isolate invalid templates and retain a recovery message.
- Money display initially used conversion to `Number`; exact formatting now preserves very large amounts' cents.
- Seed completion now has a persisted date and completion marker so interrupted/repeated startup does not shift or duplicate history.
- Cursor payloads now receive full date/UUID validation rather than letting malformed values reach PostgreSQL.
- Repeated interrupt signals exposed a duplicate pool-close during development shutdown. Shutdown handlers now ignore repeated signals. A subsequent interactive-stop check was rejected by the execution environment's approval policy, so that particular manual path remains unverified after the fix; the standalone test launcher's start/stop cycle did pass.

- Current CI found an exact-label lookup failure in the short transaction form. The category/destination selector now has an explicit accessible name; the full posting assertions passed unchanged.
- The container-recreation checker now closes HTTP connections between reads so it does not retain a socket to a destroyed app while synchronous Compose commands run. The full posted-entry equality check subsequently passed.

## Hosting-specific regressions resolved

The hosting build now installs development compilation dependencies explicitly; the API bundles internal TypeScript imports as native ESM; both wrapper imports are checked in CI; and the scheduler uses an Express request wrapper before bearer validation. Live checks subsequently passed. See [hosting](HOSTING.md) for configuration, credential scope, the daily-worker tradeoff and remaining operational checks.

## Research engineering checkpoint — 2026-10-30

The isolated comparative harness was published as `07469a6ab8d2ca32b075bfb99ccbd264ddc05672`. [CI 41135032615](https://github.com/rayidali/spiich_homework/actions/runs/41135032615) passed `verify`, `compose` and `research-native`; the opt-in application `live-ai` job was skipped. The native research job booted its separate pgvector Compose service, executed real Wren/custom SQL and access-boundary checks, compared pre-index fixture contents and ran deterministic security checks without provider keys. It does not establish embedding quality or model accuracy.

The local checkpoint passed **306 isolated tests**, production build and global formatting. The pinned Wren engine separately passed **22 Python tests**. A later supplemental analysis test suite is additional work, not silently added to this recorded count. See [sanitized CI status evidence](evidence/research-ci.json). The live 108-episode development pilot and larger held-out study are separate measurement stages; no research winner or complete held-out score is claimed at this checkpoint. No production deployment changed.
