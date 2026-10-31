# Verification record

## Compound grouping — deployed and CI verified

Questions can now group recorded amounts jointly by two or three ordered dimensions: account, person/business and month or quarter. Account/time views include every scoped posting account; person/business combinations fill missing periods only for tuples actually observed after the requested filters. Closing balances retain opening history. Exact arithmetic keeps each row’s account identity and period. The server caps the complete grid at 30,000 cells and 120 periods, then applies a global 50-row display limit with explicit truncation. This expands supported queries; it does not prove general question or formula intent. [Plain-language grouped-spending walkthrough](COMPOUND_GROUPING.md).

Exact-source CI passed **1,629 tests across 85 files and all 29 browser workflows**. The 98 named compound-grouping tests—45 compiler/output, four chat, 35 calculator and 14 real-PostgreSQL tests—are included in that test total. The one new compound-result browser workflow is included in the browser total. Provider responses and the browser chat response are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

## Net cash movement — deployed and CI verified

`net_cash_movement` measures signed posted cash change over an inclusive date range: cash debits minus cash credits. The server selects all cash-designated asset posting accounts, including archived history. Results use saved USD base values or one explicit native currency, with activity filters and grouping kept visible. Calculator movement ancestry retains periods and identities separately from as-of cash balances. This is net change, not gross payments, payment allocation, revenue, profit or a formal cash-flow statement. [Plain-language cash-change walkthrough](CASH_MOVEMENT.md).

The earlier `012f297` cash-movement release passed **1,530 tests across 81 files and all 28 browser workflows**. The 75 named cash-movement cases—26 compiler/output, seven chat, 30 calculator and 12 real-PostgreSQL tests—are included in that total. Provider responses in engineering tests are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

## Expense scope guard — CI verified and deployed

The earlier `6082a36` expense-scope release passed **1,455 tests across 77 files and all 28 browser workflows**. Its 12 real-PostgreSQL expense-scope cases passed; the model callbacks were stubbed. These totals include the named suites and must not be added together. Local pre-publication checks passed 189 focused tests, including 71 pure guard and 36 mocked integration cases, plus eight offline compiler checks, TypeScript and production build. CI browser workflows exercise the built app, not the protected hosted page or physical devices.

Checks cover schema-valid wrong accounts, global totals, metrics, dates and extra filters; coincidentally equal amounts do not pass identity verification. Correct narrow/composable plans and complete group descendants execute through one snapshot. Chart changes, archived descendants, disappeared known names, duplicate names, unknown explicit codes and ambiguous noun shorthand have distinct regressions. Unknown merchant names in both charts can still execute a valid vendor query without a proof. Original-user spans and explicitly unverified omitted dates are checked separately. First-user questions can retain a nonzero original index after an assistant-only preamble. Any prior user message makes the guard unassessed; integration cases prove that retained and dropped prior vendor filters both produce no scope proof while the complete conversation reaches the provider. This prevents false verification claims, not every possible incorrect follow-up answer.

This is deterministic contract evidence, not live model accuracy. No provider inference, new accuracy score or reopened evaluation budget was involved in this release. Protected health, metadata and SPA GETs are read-only deployment checks, not hosted visual inspection or live model comprehension. No fresh full-ledger comparison was performed, so unchanged current books are not claimed. Earlier model results remain tied to their original source.

## Conversation and admission checks — CI verified

The conversation-retention source passed **174 focused local tests**, production build and formatting. The checks cover full role/content transport beyond the old limits, unchanged 48,000-character aggregate allowance, raw-whitespace and UTF-8/JSON bounds, rejection before provider work and original-user calculation citations after seven follow-ups. Independent source review caught and corrected trimming before budget validation and a stale saved-proposal binding after a failed post.

The earlier `f4f3a7` conversation release passed **1,334 tests across 74 files and all 28 browser workflows**, including the eight new conversation cases. Actual PostgreSQL checks cover shared HTTP admission across chat, entry and category and the 15-message entry contract, with model callbacks stubbed. These counts include the named suites; they are not additive. Browser checks used the CI production build, not the hosted interface or physical devices. The HTTP test rejects malformed and oversized input before quota consumption, verifies the shared allowance and released leases, and checks correlated 429/Retry-After responses. Its future-window fixture does not prove natural UTC rollover or hosted limit exhaustion.

No provider calls, new model scores or reopened evaluation budgets were involved in this release. Protected HTTP checks verify deployed health, metadata and the SPA document; they do not measure rendered usability, live conversation comprehension or unchanged current journal contents. Earlier hosted model results remain tied to their original source.

## Current promoted compound-grouping release — 2026-10-31

Source **`93a8617932daff772c5b5d9c836be15692a64979` is promoted** at [Daybook](https://daybook-ledger-delta.vercel.app), deployment `dpl_2Rh1j9ryaPzor5vsREcDvYJHgFSQ`. [Full CI 41251437109](https://github.com/rayidali/spiich_homework/actions/runs/41251437109) passed verification, native research and Compose; live-AI was skipped. The actual stable alias and project production target match this READY/PROMOTED deployment, with all-deployment protection retained. [Release evidence](evidence/compound-grouping-release.json).

The active `composable` chat route combines existing report tools with validated ledger queries and exact scenario arithmetic. The model chooses a structured plan; application code compiles permitted queries and calculates the answer. It cannot execute arbitrary SQL or post entries. Cash sources are server-selected, assumptions require original-user evidence, and eligible explicit all-history requests retain their full date scope. Shared PostgreSQL request admission and safe request/provider/plan diagnostics are enabled. File Search, vector retrieval, Wren and reviewer agents remain separate research paths.

The preceding `7ac0a88` release passed **three known date-scope regressions** for $0.0100061 in three provider attempts, with all 74 journals and 22 accounts unchanged and all three requests matched to 12 runtime events. All-history guard provenance was observed, but the model already chose the canonical date (`changed: false`): no actual lower-bound replacement or schema-repair call occurred live. This is bounded regression evidence, not a new general accuracy score. The earlier frozen comparison's 18/20 result belongs to its own source. [Three-case acceptance](evidence/chat-history-acceptance.json). These calls were not repeated for the `f4f3a7` conversation release or the later expense-scope, cash-movement and compound-grouping releases.

## Comparison and preceding release checks — historical

The paired product comparison is complete: **composable queries18/20 versus authored tools6/20**, with7/7 versus6/7 on the predefined common-capability subset. Actual PostgreSQL replay checked both the chosen filters and exact results; the books stayed unchanged. Internal-AI review found no wrong displayed financial answer or hard-boundary violation in this small set. An account-group comparator false negative is documented separately; the primary score remains unchanged. [Evidence and CI](evidence/chat-query-runs/holdout-v1/ci.json), [two-page explanation](reports/chat-query-comparison.pdf), [details](CHAT_RELIABILITY.md).

The later candidate `7be9224` passed [full CI41237787408](https://github.com/rayidali/spiich_homework/actions/runs/41237787408), but its hosted acceptance **stopped after seven of eight requests**. Six answers passed review; the hiring calculation selected all assets where cash was required. Noncash balances happened to net to zero, so the displayed amount matched by coincidence; the source was still wrong. The stable alias was rolled back to the verified scoped-chat release `e7a514e`. The cohort is terminally closed at $0.0253555, with all 74 journals and 22 accounts unchanged and all seven requests correlated to the exact candidate runtime. [Incident and rollback](evidence/chat-broad-blocked-release.json). The later cash-source repair has separate CI and blocked hosted evidence below.

The preceding cash-source candidate `7b52a9b` was also never promoted. Its cohort remains closed after one pass and one HTTP502 / `AI_INVALID_RESPONSE` at `model_schema`, with $0.0088424 known use plus a retained $0.02 unknown reservation. The rejected field is still unknown; the later successful request does not reveal that cause. [Earlier staged incident](evidence/chat-cash-blocked-release.json).

**Previous schema-repair candidate — preserved failure.** Schema-repair source `012edb2432f0843bd1f8581a7aa114a42620373d` passed [full CI41241451555](https://github.com/rayidali/spiich_homework/actions/runs/41241451555) and reached READY/STAGED as `dpl_CFRd32kxBfYump4D8r93K3yQkzef`; it was never promoted. All six planned HTTP requests completed, but acceptance was **five passes and one scope failure**. C05 asked for all recorded Office supplies history; the model invented `from: 2000-01-01`. Its $1,740 total happened to equal the current full-history total, so this is a wrong scope with no observed dollar error. The cohort is terminally closed at **$0.0281190**, all known usage, six provider attempts and zero live schema repairs. All 74 journals and 22 accounts stayed unchanged; each request matched usage, final-plan, selected-tool and HTTP logs. At that checkpoint, the stable demo remained on `e7a514e`. [Preserved blocked-release receipt](evidence/chat-schema-repair-blocked-release.json). Completing all slots is not successful acceptance; no old failure or score was rewritten.

**Bounded schema repair passed CI; its second-call recovery remains unobserved live.** After an allowed financial tool returns schema-invalid arguments, the app may make one correction request only when the first attempt reported complete, consistent token usage. The same tools and guards apply; diagnostic feedback is untrusted and capped at 16 KB. Financial assumptions are still validated against only the original user conversation. HTTP, envelope, semantic, account and database failures do not trigger repair, and no third model call is allowed. Each provider timeout is at most 25 seconds within the remaining 40-second planning budget; repair is skipped with less than one second remaining. Safe issue-code/schema-path diagnostics and per-attempt usage, including known and unknown portions, are retained on success or error. This can improve schema reliability, not prove that the chosen query or formula matches every question. Offline review passed 76 targeted tests. All six preceding schema-repair checks and all three prior `7ac0a88` history checks used one model attempt, so none demonstrates second-call recovery succeeding live.

**Cash-source contract retained in the promoted release.** `cash_balance` requires empty `accountCodes` and lets the server select all cash-designated ASSET posting accounts, including archived history. It retains all-history cutoffs, saved FX amounts and explicit source metadata. The calculator rejects every generic `account_balance` query before database execution, including unused or wrapped queries, and carries actual cash account/date lineage through each calculation. Standalone asset-balance reports remain supported. This fixes the demonstrated asset substitution; it does not prove that every free-form question or formula has the intended meaning. Noncash balance arithmetic is deliberately unsupported. The new source does not inherit earlier study or acceptance scores. Independent read-only review reran 135 calculator tests and eight offline compiler tests successfully. The source agent reports 194 targeted offline checks plus TypeScript; the root production build passed. The new real-PostgreSQL regressions passed in CI41239769459. The separate six-slot/$0.10 acceptance helper passed 21 offline tests, including cash membership, noncash contrast, exact formula/lineage, closure and replay refusal; its actual two-request failure and retained unknown reservation are recorded above.

## Historical scoped-chat release after rollback — 2026-10-31

Executable `e7a514ef7072fbaabc6b63af026a6bab2fbd1478` passed [full CI41231800054](https://github.com/rayidali/spiich_homework/actions/runs/41231800054) and was deployed as `dpl_H7TtjDv11bmPNSiLnHT8QzuvGdX2` at that earlier checkpoint. The 66-file release adds account-scoped expenses, explicit expense top/all/total views, income totals and comparisons, scope-preserving date clarification and safe selected-query diagnostics. A separate closed hosted cohort passed16 exact-answer and7 clarification checks for $0.0298001; all74 current journal records and22 accounts stayed unchanged. Every request matched the selected tool and exact source in runtime logs. [Evidence](evidence/chat-scope-release.json).

The paired comparison remains complete and frozen. Earlier broader releases failed separate hosted source-identity/schema/scope checks; the later promoted repair has its own acceptance evidence above. Migration007 was additive and was not reverted by the routing rollback. [Reliability work](CHAT_RELIABILITY.md), [comparison protocol](research/CHAT_QUERY_EVALUATION.md).

## Previous category source, workflow CI and comparison — 2026-10-31

Executable **`b7bf5fe024f6fca33fa5a93ef5e6188e96455bae`** passed [CI 41226562746](https://github.com/rayidali/spiich_homework/actions/runs/41226562746): verification, native research and Compose succeeded; optional live-AI was skipped. All **18 browser workflows** and real PostgreSQL checks passed. CI exercised the actual Compose scheduler creating a monthly draft without calling the manual generator, then the anomaly worker raising an alert and resolving it after reversal while retaining its history. Currency precision/report/reversal boundaries and category proposal/posted-correction workflows also passed. These checks establish the tested engineering behavior, not model accuracy or real-device usability.

The separate live category comparison completed **54 development + 162 held-out observations**, with **114 paid v3 requests** and no v3 execution errors. The [independent audit](evidence/category-runs/completed-v3/independent-audit.json) passed **71 checks**, independently recomputing the plan, hash chain, snapshot parity, counts, learning, costs and allocation screen. It is an AI-assisted internal audit, not independent human adjudication.

| Held-out measure                                    | Gemini |   Jev | Rules/memory reference |
| --------------------------------------------------- | -----: | ----: | ---------------------: |
| Category plus taught preference                     |  33/33 | 31/33 |                  16/33 |
| All model-opportunity tasks                         |  42/42 | 40/42 |                  19/42 |
| Whole input handling, including deterministic gates |  54/54 | 52/54 |                  31/54 |

Both paid selectors chose semantically acceptable categories in all 33 category cases. All nine required clarifications were handled, including deterministic input gates; those gates are not model achievements. Jev's two misses were the one- and three-correction paper cases: it retained Supplies instead of the taught Printing preference. Jev minus Gemini was **−6.06 percentage points**, with exploratory paired group interval **[−18.18, 0]**. Its **76.56% lower tracked cost per correct category** did not satisfy the declared reliability condition. The [reviewed decision](evidence/category-runs/completed-v3/release-decision.json) retains Gemini within this selector's scope. [Full held-out report](evidence/category-runs/completed-v3/holdout/report.md).

Cumulative tracked cost estimates across all three versions are **60 Gemini calls / $0.030135100000** and **59 Jev calls / $0.006618486000**: **119 calls / $0.036753586**, with no unknown reservation. Both earlier adapter failures remain in their original outcomes and cumulative costs, excluded from v3 accuracy. The comparison ledger is closed. The synthetic groups supplied eligible context equally; this tests context-based preference following, not online weight training, database retrieval quality or complete-journal correctness.

**Hosted acceptance passed:** exact-source deployment `dpl_F1mVMsNU5QUttzpgaH441iQ7aJoE` was READY on the protected stable alias at that historical checkpoint. All **11 selected hosted API requests** returned HTTP 200 and passed their expected checks: four database-backed chat questions, five whole-entry examples covering supplies/card, rent/bank, invoice settlement and missing-account/purpose clarification, plus a supplies category SELECT with fixed lines and a laptop UNSUPPORTED handoff. The initial/final 73-entry journal count and financial fingerprint matched. No journal posting was requested; proposal storage/housekeeping can occur. [Release evidence](evidence/category-product-release.json).

The [separate hosted acceptance audit](evidence/category-hosted-acceptance-audit.json) passed **144 checks**. Its 56 GET snapshots confirmed the unchanged full dashboard and 73-entry financial history. All 11 response references were matched to actual Vercel `http_request` events from the exact deployment/source; two category-success events were also correlated. Hosted acceptance used a separate tracked estimate of **$0.0085057**, with no unknown reservation, rather than reopening the category-comparison ledger.

These are actual HTTP integration checks with AI-assisted qualitative review, not independent human adjudication or a fresh hosted browser/device test. Their usage is separate from the closed category-comparison ledger above. The earlier [core release](evidence/core-repair-release.json) separately established hosted error-reference/runtime-log correlation; successful API checks do not reproduce a current upstream failure.

The [original 40-case product evaluation](PRODUCT_AI_EVALUATION.md) remains a separate incomplete live evaluation. Its repaired fixtures teach through actual reviewed postings and isolate before/after workspaces. The completed nine-route study below does not replace that evidence. Hosted automatic daily cron firing and a fresh real-device usability review remain unobserved. Document upload is absent from the product and is not required by the assignment.

## Earlier provider-only entry repair — 2026-10-31

The [assignment review](ASSIGNMENT_REVIEW.md) separates real database/browser evidence, mocked AI behavior and unproven product claims. At that provider-only checkpoint, error correlation, correction trust/persistence and reversed history were still open; the later core release above addresses their implementation and engineering checks. The nine-route research study does not establish Jev categorization or improved accuracy after corrections.

Source `de67b49dfce110f560840d0b9106d628f30f5d52` passed [CI 41213514203](https://github.com/rayidali/spiich_homework/actions/runs/41213514203): verify, native research and Compose succeeded; optional live AI was skipped. Deployment `dpl_GopCJGQi67eHqSXLtRiVywVRRLbZ` reached READY. Three separate hosted API checks passed on the changed prompt: exact USD 340 Supplies/Card entry, clarification for rent without a payment account, and clarification for the user's friend/party example. All 73 journal records and the complete dashboard response remained unchanged. The cash question matched the independent dashboard in the first repaired deployment. The [sanitized receipt](evidence/entry-provider-recovery.json) binds results and limitations.

The first repair's rent check failed by guessing a bank account. That outcome remains recorded; its later success follows a source change, not an invisible retry. The initial CI failed a historical-source assertion; fixed nonexecuted source snapshots retain the original study hashes. Thirty-four provider tests and 58 combined provider/baseline tests passed locally; these overlap and must not be added together. TypeScript, build, native imports and formatting passed. Hosted checks used HTTP, not a browser; local browser launch was unavailable. CI browser workflows mock AI responses. Neither small live regressions nor prompt wording prove general semantic accuracy.

## Completed frozen study — 2026-10-31

The final source and reports are published in commit **`a5493c3317b5df2e70318cd6b1ada94220e211a9`**. [Full CI 41182776959](https://github.com/rayidali/spiich_homework/actions/runs/41182776959) completed successfully: application verification, native research and Compose passed; live-AI was skipped. The [final CI receipt](evidence/research-final-ci.json) binds that observed result to the exact commit. This CI validates the committed implementation and postprocessors; the separate held-out artifacts establish the measured model results.

Executable `0fe267b03b7baa0a2ff43c58165301b74261afa9` passed [full CI 41155033249](https://github.com/rayidali/spiich_homework/actions/runs/41155033249): application/backend/browser verification, Docker startup/persistence and native Wren/pgvector checks. Live-AI was skipped in CI. The matching local source passed **511 isolated TypeScript tests, 35 actual Wren Python tests, nine PDF exporter tests, strict TypeScript/production build and formatting**. [Local evidence](evidence/research-local-v4.json), [CI evidence](evidence/research-ci-v4.json).

The final corrected development smoke completed **54/54**: 40 execution successes, 13 withheld responses and one preserved response-contract error; 28 structured task successes. All 190 transport requests returned HTTP 200 with complete footers; this does not make every model response valid. Source/protocol and the full scoped ledger/document/vector fingerprint remained unchanged. Internal review found no new measurement blocker, while conservative scope/citation limitations remain documented. [Smoke evidence](evidence/research-smoke-v4-check.json), [run explanation](evidence/research-runs/smoke-v4/README.md).

Final source hash `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08` and reviewer threshold **0.8** were frozen before held-out attempts. **All 1,620 main episodes and 240 held-out reviewer outcomes are complete.** Independent final audits passed [41 main checks](evidence/research-holdout-final-check.json) and [31 reviewer checks](evidence/research-verifier-holdout-final-check.json). The main run retains 1,333 execution-status `ok`, 267 `blocked` and 20 `error` outcomes; 940 satisfy the structured-success rubric. The before/after scoped fingerprint matches `2f9897602b08ac17130f103a38093ca913bc3871c1ab7a4da871e7c028b68f8c`. No observed hard-gate violations were recorded; that is not a guarantee of semantic correctness. [Pre-run freeze](evidence/research-verifiers/verifiers-v1/verifier-freeze.json), [main manifest](evidence/research-runs/holdout-v1/manifest.json).

The same held-out run resumed after its preserved 777-episode interruption. Separate operational recovery passed full CI 41171119383 and 120 targeted tests; a single admitted provider probe succeeded, then its cohort closed permanently. All failed outcomes and reservations remain. Inference source and scoring were unchanged. The static-config dispatcher validates before the tool call; its timing cannot establish actual network-start spacing. Both studies and operational cleanup are complete. See the [operational record](research/TRANSPORT_INCIDENT.md).

Only **H2, lexical document access over broad tools**, clears the predeclared targeted rule: +46.7 percentage points [35.0, 60.0] across documents/scenarios. The [decision supplement](evidence/research-runs/holdout-v1/decisions/report.md) calls it a candidate for further experiment. R3 has the largest observed broad score, 127/180 (70.6%), but its targeted comparisons remain inconclusive. The predefined common-capability subgroup favors R0, 33/36 (91.7%), over R3, 27/36 (75.0%); broader coverage does not establish an across-the-board replacement. Intervals are exploratory, unadjusted and clustered by scenario group.

The separate reviewer stress study has 80 candidates (40 correct, 40 flawed) per method and zero request errors. With the deterministic gate, Gemini accepted 7/40 flawed answers and withheld 1/40 correct ones; Jev accepted 6/40 flawed answers and withheld 5/40 correct ones. The Gemini withholding-difference interval reaches +7.9 pp, above the +5 pp limit, so its criterion is inconclusive; Jev's +12.5 pp point increase is below the practical target. These are synthetic reviewer outcomes, not production prevalence or independent human adjudication. [Reviewer results](evidence/research-verifiers/verifiers-v1/holdout-results.json).

The [all-study cost export](evidence/research-final-costs/cost-reconciliation.md) reconciles 5,271 records to approximately $6.050602768 in estimates plus retained reservations. Additional spending is $5.23873405 Gemini / $0.033304824 Jev, below the authorized $6.40/$0.10 allowances. Successful embeddings without token metadata remain unknown-cost reservations. The external exporter passed **41 local synthetic tests**, TypeScript and formatting and is included in the passing final source CI. Do not sum these with overlapping historical suites or describe tracking estimates as invoices.

The [complete research narrative](reports/research-study.md), [16-page PDF](evidence/research-runs/holdout-v1/study-report.pdf) and supplements are published with the final source. Archive-verification receipts are stored privately under `.tools/publication-*-verification.json`; verify the delivered ZIP against its corresponding receipt rather than inferring archive integrity from a green CI run. Production was not redeployed. The product's full 40-case live evaluation, fresh visual/device checks, automatic scheduler observation, reviewer sharing and production-scale operations remain separate gaps; the synthetic study does not close them.

The sections below are chronological evidence from earlier checkpoints. Their statements about pending work apply to those dates, not to the current run. Original failures and incomplete runs are preserved.

## Shared evidence-scope correction — 2026-10-30

The complete funded smoke recorded 54/54 episodes with unchanged source/data, 47 execution successes, seven validation blocks and zero execution errors. Its [validity notice](evidence/research-runs/smoke-v3/validity-notice.json) identifies asymmetric period metadata between custom and Wren evidence; it cannot select an architecture.

The correction derives row period/identity/grain from validated plans or supported Wren ASTs, applies the same checks to both backends and R0, and fails closed on ambiguous scope. Internal code review found and corrected daily movements masquerading as balances, omitted raw-row identity, grouped vendor collapse and arithmetic wrappers erasing source scope. This is qualifier/provenance verification, not complete economic semantics or human prose adjudication.

Source hash `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08` passed **511 isolated tests in 32 files**, strict TypeScript/production build, global formatting, **35 actual Wren Python tests** and **nine PDF exporter tests**. [Local evidence](evidence/research-local-v4.json). The common-capability source amendment preserves all membership. Prompts, reference labels, fixtures and previous outcomes are unchanged. Full CI and `smoke-v4` subsequently completed as recorded above; no final held-out result is claimed.

## Funded continuation checks — 2026-10-30

The parent-bound study allowance and fatal runner-stop handling passed **453 isolated tests in 29 files**, strict TypeScript/production build and global formatting. [Local evidence](evidence/research-local-funded.json). Independent review found no critical issue. The real policy installation preserved all 841 historical usage records and prior policy/marker/recovery bytes and was verified across process reconstruction. [Installation receipt](evidence/research-funded-resumption.json).

The current key received HTTP 403 for the old managed File Search store. A fresh store is now verified with **39 active / 0 pending / 0 failed authorized documents**, preserving the old index state and existing database vectors. [Index evidence](evidence/research-funded-index-ready.json). Fresh read-only database checks matched **114 posted lines, 57 entries, 39 authorized documents and 39 embeddings**, with unchanged fingerprints. [Fixture evidence](evidence/research-funded-fixture-check.json). The original undispatched timeout is retained separately; the private dispatcher fairness correction preceded scored runs.

Published executable `eb75bf106cc91c023ee749873d1cd91057934cd3` passed [full CI 41152133267](https://github.com/rayidali/spiich_homework/actions/runs/41152133267): application/browser, Docker/persistence and native Wren/pgvector jobs succeeded; live-AI was skipped. [CI evidence](evidence/research-ci-funded.json). These are engineering/setup checks, not live answer accuracy. The final 54-episode development smoke and frozen held-out measurements follow; production was not redeployed.

## Historical changed-key check and spending guard — 2026-10-30

The following one-request restriction was superseded by the explicit funded allowance above. Its records and policy remain preserved as the new policy's parent.

The replacement local Gemini key passed exactly one fixed availability request: HTTP 200, 878 ms, 14 input/5 output tokens, $0.0000167 paid-equivalent estimated usage. [Receipt](evidence/gemini-key-check-2026-10-30.json). No study questions, documents, indexing, Jev requests or hosted deployment were involved. Account balance, project identity, remaining quota and existing File Search access are unverified.

At that historical checkpoint, a persistent one-request/$0.01 additional Gemini/$0 Jev policy remained in force after the success. A reconstructed default-budget instance rejected an ordinary call before reaching transport; all 840 previous usage records are preserved, with one new probe record. [Policy verification](evidence/gemini-frugal-checkpoint.json). Missing/malformed policy, changed history, wrong key, extra requests and unknown usage have offline coverage. The new revision passed **417 tests in 27 files** and strict TypeScript/production build. Published revision `675a7c4` passed [full CI 41147321748](https://github.com/rayidali/spiich_homework/actions/runs/41147321748): application/browser, Docker/persistence and native Wren/pgvector jobs succeeded; live-AI was skipped. [Sanitized CI evidence](evidence/research-ci-key-guard.json). The cloud result in the historical section below predates this guard.

At that checkpoint, no larger budget answer or additional study run existed. The subsequent funded allowance superseded this stop while preserving its records. The following section records the earlier published checkpoint.

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

## Historical pending list (superseded where noted)

This list belongs to the earlier37-test checkpoint. Later selected hosted questions and a review-only proposal succeeded; the original40-case product evaluation remains incomplete. Current research and verification status is recorded at the top of this document. The capacity and browser limitations below remain unverified.

- **Live AI at that checkpoint:** metadata access succeeded, but hosted generation timed out; diagnosis and bounded evaluation were still pending. This does not describe the later successful hosted checks or current active research run.
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
