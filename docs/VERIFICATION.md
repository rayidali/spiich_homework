# Verification record

> Updated 2026-10-29 after Gemini/evaluation/UI implementation. New isolated tests, TypeScript/build and Compose configuration pass. The previous 29 database tests, 8 provider contracts and 8 browser workflows are historical evidence; the changed database/browser suites have not run in this restricted session. See [CHECKPOINT.md](../CHECKPOINT.md).

## Current implementation checks and blockers

At the user's request, a new full `npm test` attempt produced **51 passing tests, 43 skipped tests and two failed suite setups** because PostgreSQL connections are denied with `EPERM`. `npm run build` passed again. The four-case live smoke command failed during database setup before any provider call. A new DNS check returned `ENOTFOUND`, and the browser still failed before page load. The machine-readable [attempt record](evidence/verification-attempt.json) preserves those results without credentials. These are environment failures, not successful runtime verification.

- **Provider unit tests:** 22 passing, with mocked transport and no external requests. Covers Gemini/OpenAI, schemas, allowed calls, extra-call rejection, malformed/truncated output, safe error mapping, timeouts, usage and budgets.
- **Evaluation unit tests:** 23 passing, covering full-line comparisons, extra lines/wrong rates, exact evidence, clarification routing, dataset splits and CLI limits. These do not establish model accuracy.
- **Simple-entry unit tests:** 6 passing, covering customized chart defaults, active/USD eligibility, receipt/repayment directions, transfers and stale selections. The current isolated total is **51 passing tests**.
- **Build/configuration:** strict TypeScript, production Vite build and Compose configuration passed. The two previously documented Zod annotation warnings remain nonfatal.
- **Database/browser regressions:** the current source contains 29 accounting tests, 14 database-backed AI contracts, and 10 browser workflows. A local PostgreSQL connection failed with `EPERM`; the test browser aborted before page load. These revised suites are pending, not passed.
- **Key/connectivity:** the user saved the Gemini key in private `.env`. One minimal structured-output connectivity attempt failed before a provider response; a credential-free host check reported DNS `ENOTFOUND`. No provider result, token usage, key validity or charge can be confirmed. No live financial evaluation ran.
- **Docker:** no runtime/socket is installed on this Mac. The new persistence check and dedicated evaluation service are configured but unexecuted. CI has not run remotely.
- **Screenshots:** existing screenshots show the earlier verified interface. No image is presented as proof of the new layout. Real-phone verification remains pending.

Run these from the project in a normal Terminal with the existing development PostgreSQL running:

```sh
npm test
npm run build
npm run dev -- --test-browser --reuse-db --production
npm run format:check
npm run ai:evaluate -- --suite smoke
```

The smoke suite defaults to four cases, eight attempts and 32,000 observed tokens. Development defaults to 20 cases, 32 attempts and 150,000 observed tokens; holdout defaults to 20 cases repeated three times, 96 attempts and 400,000 observed tokens. Correction cases include a before/after call. Use `--max-attempts` and `--max-total-tokens` to lower bounds. Usage that cannot be observed stops the run; one response may cross the token threshold. Provider calls may be billed. The harness creates new synthetic workspaces and predefined fixture postings, never posts model output, and never resets the demo. Inspect the clarification review rubric and failures before treating any automated pass as useful behavior.

After smoke/development checks and fixes, run the reserved split without tuning on its results:

```sh
npm run ai:evaluate -- --suite development
npm run ai:evaluate -- --suite holdout --repeats 3
```

For Compose, start the stack, then run `docker compose --profile evaluate run --build --rm evaluate` for smoke cases. Its fixture-creation credentials are isolated from the normal app service. Evidence is written to the mounted `docs/evidence` directory. Run `node scripts/check-compose-persistence.mjs --execute` after container startup to recreate the app/database containers and compare an existing complete posted entry, without journal writes or volume deletion.

### Prepared remote verification

The existing GitHub Actions workflow now also supports manual execution. Normal push/PR/manual runs execute database/application tests, browser workflows and Compose/persistence checks. Selecting the manual `live_ai` input additionally runs four Gemini smoke cases after both prerequisite jobs pass, using at most four attempts and a 32,000 observed-token guard. This job reads only the repository's `GEMINI_API_KEY` secret and optional `DAYBOOK_GEMINI_MODEL` variable; no key is embedded in the workflow. Synthetic results are uploaded as an artifact. The user supplied `rayidali/spiich_homework`, but the connection currently reports read-only access, so nothing has been uploaded or run remotely. The available connector has repository-write and run-inspection tools but no workflow-dispatch or secret-management tool, so those steps may require GitHub's UI unless another authorized capability becomes available.

The local CLI was subsequently verified as `rayidali` with ADMIN access to the target. The read-only connector is authenticated as a different account, `gulfmarvel`. The user prefers local Git. Local initialization was attempted and failed with `.git: Operation not permitted` under this session's filesystem policy; direct `gh api` access also failed to connect. GitHub account permissions are therefore not the blocker for the preferred local workflow. No upload or remote test run has succeeded.

## Historical implementation verification

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

- **Live AI:** a key is now saved, but provider-host DNS prevented validation. The contract tests establish application defenses, not live model accuracy, latency, or account access. Run the new bounded smoke/development/holdout harness and inspect clarification meaning manually.
- **Container execution:** no Docker daemon was available on this machine. Compose parses/validates, but image build/startup and volume persistence need an actual Docker run. The CI configuration includes these checks and has not been executed remotely.
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
