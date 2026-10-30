# Daybook session checkpoint

Updated **2026-10-29** after the user authorized implementation following the visual architecture report. Read this file first; continue the existing application rather than rebuilding it.

## Current state

Latest user request: run tests and push through the local Terminal/Git login. **Daybook was pushed successfully** to `https://github.com/rayidali/spiich_homework` as commit `c718a1fd29bc9c6cdb0a397264709e3255f3d1b0`, preserving the original initial commit. The repository is public. Local `gh` is authenticated as `rayidali` with ADMIN access; no account change is needed and the different-account GitHub connector was not used to publish.

The project directory still cannot create `.git`. A separate permitted checkout was initialized at `/private/tmp/daybook-publish.kbVq33`; it contains only the 95 reviewed submission files, no `.env`, local database, dependencies, or provider key. Existing public Git objects were fetched with approved HTTP commands, then normal local `git add`, `git commit`, and `git push origin main` succeeded. Use this checkout for further local commits while it exists; do not relocate Git metadata into the protected project directory or reset the working source/database. Git printed a stale missing credential-helper path, but another configured helper authenticated the successful push; global Git configuration was not changed.

The [successful CI run](https://github.com/rayidali/spiich_homework/actions/runs/40994222818) on commit `634ab08f22627b26539af9227883c9208f2ae479` passed **94 backend tests, 10 production browser workflows, Docker build/startup/health, containerized tests, and posted-entry persistence across app/database recreation**. Earlier failed runs exposed a short-form dropdown label lookup and stale HTTP connections in the persistence checker; both fixes were pushed and the original accounting assertions retained. Machine-readable results are in [cloud-verification.json](docs/evidence/cloud-verification.json). The earlier local failures remain historical in [verification-attempt.json](docs/evidence/verification-attempt.json).

The live Gemini job is opt-in and requires the repository's `GEMINI_API_KEY` secret. The local key has not been transferred, and no live evaluation has run. Fresh browser screenshots are in the successful run's browser-evidence artifact; checked-in images still show the earlier design and need replacement after visual review.

The user asked about Vercel access. The Vercel CLI is installed (65.2.0), but `vercel whoami` failed on a network request; local login status is unconfirmed. The Vercel plugin is available but not connected; an installation/connection option was offered. No token was requested in chat and no deployment or hosted database was created.

**Gemini/OpenAI support, stronger evaluation and the simpler interface are implemented in source.** The user saved the Gemini key in the local `.env`; it must never be displayed or copied into source, documentation, screenshots or the archive. The key has not been validated against Google because this session cannot resolve the provider hostname.

- Product: **Daybook**. Spiich is the assignment recipient, not the product name.
- Workspace: `/Users/rayidali/Desktop/spiich_codinghw`.
- Package/archive root: `daybook-ledger`; Compose project: `daybook`.
- Preview: `http://localhost:5173`; API: `127.0.0.1:3001`; development PostgreSQL: `55432`.
- The project folder has no `.git`; the separate publishing checkout and remote now have committed history. The previous submission is preserved at `.tools/checkpoints/before-gemini-implementation-2026-10-29.zip`. Do not restore it over current work during normal resumption.
- Paid providers/Jev are acceptable when justified. No purchase or subscription was made. Jev, pgvector, Mastra, Wren and managed document retrieval are **not integrated**.

The previous discussion-only instruction is superseded: the user said to take the clipboard key and begin. Clipboard access failed, so the user saved the key locally instead. One minimal structured-output connection attempt failed without a provider response; a credential-free host check returned `ENOTFOUND`. Key validity, provider token usage and charges cannot be confirmed from that failure. No live financial evaluation ran.

## New implementation

- `server/ai-provider.ts`: native Gemini REST and retained OpenAI Responses adapters, configurable provider/model, 25-second timeout, no automatic retries, four-request concurrency limit, strict response validation, one allowed financial call, safe error codes, usage/model metadata and evaluation budgets. No new application dependency.
- Gemini default: `gemini-3.8-flash`; OpenAI default: `gpt-6-luna`. Both are configurable with `AI_MODEL`; remove a stale override when switching provider. `.env.example` and Compose support both keys.
- `server/ai.ts`: shared account/decimal/balance checks, strict financial arguments that reject attempted organization overrides, retrieved history/correction IDs, and exact SQL-derived financial answers. Provider output never posts itself.
- `scripts/evaluate-ai.ts` and `scripts/evaluation/`: 40 labeled cases (20 development, 20 reserved holdout), four-case smoke mode, exact full-line/date/rate checks, exact query/evidence checks, correction before/after probes and organization-isolation evidence. Runs create new synthetic workspaces and predefined fixture postings, never mutate the demo or post model outputs. Clarification meaning explicitly needs human review.
- UI: Home / Transactions / Reports / Settings; Home prioritizes cash, profit, recording and review. Details remain expandable. Short USD money-in/out/transfer form leads to explicit account-effects review and confirmation. Receivable/equity/liability cases remain distinct from revenue/expenses; full journal mode supports foreign currencies and splits. AI clarification precedes its review screen.
- `web/src/quick-entry.ts`: eligible account choices/defaults independent of chart codes. An independent review caught and fixed invalid default selection on customized charts and editing races during preparation/posting.
- Browser launcher disables the model key. Ten browser workflows are authored, including short-form accounting and mocked AI review with no automatic posting.
- Compose has a separate `evaluate` profile for synthetic fixture creation; normal app credentials remain restricted. `scripts/check-compose-persistence.mjs --execute` recreates app/database containers and checks an existing complete posted entry without journal writes or volume deletion. CI includes it.

## Verification: current versus historical

| Check                                       | Current evidence                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Offline provider tests                      | **22 passing** with mocked transport                                                   |
| Evaluation scorer/options/dataset tests     | **23 passing** without model/database calls                                            |
| Simple-entry selection tests                | **6 passing**                                                                          |
| Strict TypeScript / production bundle       | Passed; two known nonfatal upstream Zod annotation warnings                            |
| Formatting / Compose configuration          | Passed                                                                                 |
| Current PostgreSQL suites                   | **Passed in CI**: 29 accounting + 14 AI contracts                                      |
| Current browser suite                       | **Passed in CI**: all 10 production Chromium workflows                                 |
| Live provider access / accounting accuracy  | **Pending**: key saved, provider DNS blocked                                           |
| Full Docker startup / persistence           | **Passed in CI**: build, startup, health, containerized tests and container recreation |
| Physical phone / Safari / Firefox           | Not verified                                                                           |
| Million-user capacity / production failover | Not measured or claimed                                                                |

The current automated total is **94 backend tests and 10 browser workflows passing in CI**. The 51 isolated tests are included in the backend total. Earlier checked-in screenshots still show the previous design; new captures exist in the CI artifact but have not been visually inspected here. Contract/browser tests do not establish live model accuracy or physical-device behavior.

## Environment and data preservation

At implementation startup, Node PID `2666` listened on `3001`/`5173` and PostgreSQL PID `2669` on `55432`. Recheck before acting; PIDs are observations, not permanent identities. The processes were not stopped/restarted during this iteration, so the existing API can still have the old provider configuration until restarted. Frontend hot reload does not reload the API or `.env`.

This session cannot connect to the existing local database (`EPERM`), launch the test browser, resolve Google API DNS, read the macOS clipboard, or create `.git`. Do not bypass those restrictions or repeatedly retry unchanged failures. Complete runtime verification from a normal Terminal or an environment with the necessary access. No Docker Desktop, OrbStack, Rancher Desktop or Docker socket was found.

Preserve:

- `.tools/postgres`: actual development data.
- Database/role compatibility identifiers: `spiich` / `spiich_app`.
- Compose named volume: **`spiich_postgres_data`**.
- Applied, checksummed migrations `001_ledger.sql` through `004_provenance.sql`; none changed in this iteration.
- Default organization `00000000-0000-4000-8000-000000000001`. Previous clean seed: 72 posted entries, one draft and three alerts; current counts could not be queried in this restricted session.
- Posted history: never edit/delete it to reset a demo; corrections use linked reversals.

## Resume and verify

The source above has passed full CI; repeat relevant checks when source changes. Prioritize live evaluation, fresh screenshot review and the requested hosting discussion. For local publication, use the separate checkout and normal Git commands; the primary working source stays in this project directory.

1. Read this checkpoint, [README](README.md), [verification](docs/VERIFICATION.md), and the latest [build log](docs/BUILD_LOG.md).
2. Inspect listeners before starting another server:

   ```sh
   lsof -nP -iTCP:5173 -iTCP:3001 -iTCP:55432 -sTCP:LISTEN
   ```

3. In a capable Terminal, restart the existing dev process to load the new server and key. If all ports are free, use `npm run dev`. If only PostgreSQL remains running, use `npm run dev -- --reuse-db`. Preserve the database directory; never start a second PostgreSQL against it.
4. With PostgreSQL running, verify current source:

   ```sh
   npm test
   npm run build
   npm run dev -- --test-browser --reuse-db --production
   npm run format:check
   npm run ai:evaluate -- --suite smoke
   ```

5. Inspect smoke results and the proposed entries/clarifications. Then run `npm run ai:evaluate -- --suite development`. Freeze model, cases, contexts and settings before `npm run ai:evaluate -- --suite holdout --repeats 3`. Record failures; once holdout failures guide tuning, report that reuse rather than claiming unseen results.
6. On a Docker-enabled host:

   ```sh
   docker compose up --build --wait
   docker compose --profile test run --build --rm tests
   node scripts/check-compose-persistence.mjs --execute
   docker compose --profile evaluate run --build --rm evaluate
   ```

7. Inspect desktop/phone flows, update screenshots and evidence, rehearse the demo, and refresh the ZIP after changes. Optional retrieval/Jev comparisons follow successful baseline verification; they are not prerequisites.

The smoke suite has four cases and defaults to eight attempts / 32,000 observed tokens. Development defaults to 32 attempts / 150,000 tokens; holdout to 96 attempts / 400,000 tokens. Use lower CLI limits as needed. No automatic retries. Unknown usage or access/quota failures stop the run. The token threshold stops subsequent requests; an in-flight response can exceed it, so it is not an absolute billing ceiling. Provider calls may be billed. Run `npm run ai:evaluate -- --help` for options.

## Design and research continuity

The project-local Emil Kowalski guidance is at `.tools/design-skills/skills-main`, revision `a81dbca07f2217b7103e510c0f13f8d5b017afc9`. It is not a globally installed skill. Provenance and applied design/mobile rules are in [design](docs/DESIGN.md).

The [PDF report](docs/reports/architecture-review.pdf) and [interactive HTML](docs/reports/architecture-review.html) are the planning snapshot before this implementation. They explain Spiich/Midday/Actual lessons, system boundaries, examples, proposed UI and the 12-hour core + four-hour reserve allocation. Follow this checkpoint for current status. Public research, pinned source reviews and their limits are recorded in [architecture](docs/ARCHITECTURE.md); no upstream product was installed or incorporated.

## Documentation and submission

- [README](README.md): startup, provider setup and scope.
- [Architecture](docs/ARCHITECTURE.md): invariants, adapters, research and scaling boundaries.
- [Plan](docs/PLAN.md): delivery allocation and controlled comparison.
- [API](docs/API.md): REST contracts and errors.
- [Design](docs/DESIGN.md): simpler flow, guidance provenance and historical screenshots.
- [Verification](docs/VERIFICATION.md): executed checks and outstanding runtime work.
- [Accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md): beginner examples.
- [Interview guide](docs/INTERVIEW_GUIDE.md): explanations and demonstration.
- [Build log](docs/BUILD_LOG.md): actual changes and decisions.
- [AGENTS.md](AGENTS.md): concise continuation instructions.

The submission ZIP uses the `daybook-ledger/` root and excludes `.env`, `.tools`, `.git`, dependency/build/test directories and credentials. Refresh it after changes. Authentication, invoice/bank-feed/tax workflows, period-end FX revaluation and measured production capacity remain explicit boundaries.
