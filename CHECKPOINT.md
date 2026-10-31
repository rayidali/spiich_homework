# Daybook session checkpoint

Saved **2026-10-31, America/New_York**. Read this first on continuation. The implemented application and scientific study already exist; do not rebuild them or repeat completed provider runs.

## Current state

**The scientific measurements, analyses and report are complete, the source is published, and final cloud CI passed.** The user explicitly authorized continuation until delivery and reported about $8 Gemini credit. No further provider work or purchase is needed for this study. Final delivery uses the source-bound archive verification described below.

- Main holdout: **1,620 unique planned/scored trials**, 180 per route, 60 questions × nine routes × three repeats. Execution statuses: 1,333 ok, 267 withheld, **20 retained errors**. There are 940 structured successes across the recorded matrix; execution success is not answer correctness.
- Reviewer holdout: **240 outcomes**, 80 candidates × deterministic/Gemini/Jev; 80 per method, **zero execution errors**. Exactly 80 Gemini and 80 Jev calls completed.
- Main runner **87891**, dispatcher **g10:215**, watcher **24141**: stopped cleanly. Reviewer runner **59490**, dispatcher **g10:219**, watcher **56554**: stopped cleanly. No runner/budget/owner lock or pending request remains. Do not restart either phase.
- Final complete ledger/corpus/vector fingerprint matches the starting value: `2f9897602b08ac17130f103a38093ca913bc3871c1ab7a4da871e7c028b68f8c`.
- Main integrity audit: **41/41** checks. Reviewer integrity audit: **31/31**. Final analysis/cost audit: **59/59**. These are AI-assisted internal audits, not independent human scientific review.
- The **16-page PDF** passed text-bounds checks and AI visual inspection of every rendered page. Human prose/reference adjudication remains unmeasured.
- Production is unchanged. No research route was promoted into hosted chat.

Start with the [completed study narrative](docs/reports/research-study.md), [visual PDF](docs/evidence/research-runs/holdout-v1/study-report.pdf), [full HTML results](docs/evidence/research-runs/holdout-v1/report.html), [worked examples](docs/reports/research-worked-examples.md), and [interview guide](docs/INTERVIEW_GUIDE.md).

**Explanatory follow-up, 2026-10-31:** the user requested a two-page plain-English paper and asked specifically about Jev for transaction categorization. The [short PDF](docs/reports/daybook-ai-explained.pdf) and [HTML](docs/reports/daybook-ai-explained.html) explain all nine routes, score construction, test limits, source documents, Wren/Jev and the recommendation. Production has no document-upload UI/API. Categorization already uses saved corrections and similar posted entries as context, but the nine-route fixtures contain no correction records and do not measure learning over time. Jev categorization is proposed, not implemented or tested; the [follow-up design](docs/INTERVIEW_GUIDE.md#transaction-categorization-and-the-proposed-jev-comparison) records the next controlled comparison. No new provider calls, product changes or deployment were made for this explanation.

## Results and defensible recommendation

R3 managed File Search has the highest observed broad structured-task success: **127/180 (70.6%)**, followed by R4 hybrid **118/180 (65.6%)** and R2 lexical **110/180 (61.1%)**. On the predefined common-capability subset, R0's existing narrow tools score **33/36 (91.7%)**, versus R3 **27/36 (75.0%)**. Expanded coverage does not establish a wholesale replacement of existing tools.

**Only H2, adding lexical document access to broad tools, passes the predefined component screen:** targeted documents/scenarios gain **+46.7 percentage points [35.0, 60.0]**. Managed retrieval's targeted advantages over lexical/hybrid remain inconclusive; vector search, reranking, Wren and reviewers do not establish the required further gain. Recommend document access as a candidate for the next controlled product experiment while preserving useful narrow tools. A new intent router combining paths is an unmeasured configuration, not a tested result.

Reviewer joint policies accept **7/40 flawed candidates for Gemini+code** and **6/40 for Jev+code**, versus **28/40 for the limited deterministic stress checker**. They withhold **1/40 correct (2.5%)** and **5/40 (12.5%)**, respectively. Gemini's withholding interval exceeds the allowed upper bound; Jev's observed withholding exceeds the practical target. Neither qualifies for universal automatic adoption. The generated reviewer report's threshold-feasibility caption refers to development, not Jev's held-out performance.

All intervals are exploratory, clustered and unadjusted. The synthetic holdout has 30 scenario groups, five per family; repeats/paraphrases are correlated. No independent human prose score, production accuracy or million-user capacity is claimed. [Decision supplement](docs/evidence/research-runs/holdout-v1/decisions/report.md).

## Spending and protected state

Final shared research ledger: **5,271 records = 841 baseline + 4,430 continuation**.

| Scope                                                 |      Tracked USD, approximately |
| ----------------------------------------------------- | ------------------------------: |
| Main held-out routes                                  |                     4.887828362 |
| Held-out reviewer calls                               |                     0.030792290 |
| All research, including development/indexing/recovery |                 **6.050602768** |
| Original 841-record baseline                          |                     0.778563894 |
| Funded continuation, both providers                   |                 **5.272038874** |
| Continuation Gemini                                   | **5.238734050**, below 6.40 cap |
| Continuation Jev                                      | **0.033304824**, below 0.10 cap |

The full ledger consists of about **$5.620660418 reported-use estimates + $0.429942350 retained unknown reservations**. All 804 unknown-cost records remain. Successful embeddings without usage metadata are included; an unknown cost is not necessarily a network failure. Records count reservations, not necessarily dispatched requests. These are estimates/reservations, not invoices or a verified account balance. Production traffic and unrecorded external services are outside this ledger.

The sanitized final snapshot and exact decimal partitions are in [research-final-costs](docs/evidence/research-final-costs/cost-reconciliation.md). Its exported usage SHA256 is `df6f0c25f3e5674a463608f00bead57ecc5bf4339a0c1c73057a7f077b97b5e7`. Exact sums preserve stored Number serialization artifacts; they do not invent additional pricing precision.

Preserve the private `.tools/research/usage.json`, installed parent/child policies, required markers, original key bindings and every recovery journal. The additional caps remain $6.40/$0.10 within original cumulative $10/$4 ceilings. No automatic refill, model rotation, retry or policy reset is authorized. Keys, database URLs, raw request/response/header/config files, browser state and private index identifiers must never enter source, docs, screenshots or the ZIP.

## Frozen study and audit evidence

| Binding                                                 | Value                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| Inference source hash                                   | `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08` |
| Original verified inference commit                      | `0fe267b03b7baa0a2ff43c58165301b74261afa9`                         |
| Last published operational commit before final delivery | `79dbdc9b2eddd9953815cebfc0f01a9d22c37f10`                         |
| Published final source, data and reports                | `a5493c3317b5df2e70318cd6b1ada94220e211a9`                         |
| Frozen index hash                                       | `f0420b1c0fc1dda49d4cbc937f2fce4c57f43660688de0c5a4914d001279a2a1` |
| Jev reviewer threshold                                  | **0.8**, selected on development and unchanged                     |
| Final main episode SHA256                               | `23a81919b83fec491d728d5abe6660389c7446d5808db805246c799f08d8b51e` |
| Final main results SHA256                               | `eeb43bbad42e974dcb3c6fbc030f314304be49130b475313d8e785613da1ee29` |
| Final PDF SHA256                                        | `ce197068fb0bc16e3e9ceeb337bbc108b5cc448105d16a4f4a97ce746e03c801` |

Do not edit the frozen `docs/PLAN.md`, runtime, fixture, labels, prompts, indexes or threshold and present the old holdout as a test of the changed system. A future experiment needs a new version and must disclose use of these results.

Receipts: [main audit](docs/evidence/research-holdout-final-check.json), [reviewer audit](docs/evidence/research-verifier-holdout-final-check.json), [analysis/cost audit](docs/evidence/research-final-analysis-check.json), [main resume transport](docs/evidence/research-main-resume-dispatch-summary.json), [reviewer transport](docs/evidence/research-reviewer-dispatch-summary.json), [PDF inspection](docs/evidence/research-final-pdf-visual-review.json).

The primary supplements are complete: [retrieval/timing/failures](docs/evidence/research-runs/holdout-v1/supplemental/index.html), [common-capability v4](docs/evidence/research-runs/holdout-v1/common-capabilities/report.md), [fixed weights](docs/evidence/research-runs/holdout-v1/sensitivity/report.md), and [decisions](docs/evidence/research-runs/holdout-v1/decisions/report.md). All 30 referenced provenance file hashes matched and five analysis outputs reproduced in the final audit. The retrieval supplement binds episode/usage hashes; other supplements bind the primary results and, where applicable, reviewer artifacts.

## Preserved interruption and recovery

The original main run stopped at 777 trials after transport timeouts and an open circuit. Its outcomes, usage, unavailable after-check and diagnostics remain in the immutable [interruption archive](docs/evidence/research-runs/holdout-v1/interruption-01/snapshot.json). The original 777 episode bytes and 1,892 corresponding usage records were verified unchanged; no failed cell was retried.

Two failed operational checks remain consumed: a pre-launch newline-guard rejection, then a process-substitution DNS failure. Each retains its $0.0010841 reservation. The later finite operator registry succeeded once and **closed permanently**. Its cohort `6cdf5fcf-5749-469b-94ce-0d065c9c591a` cannot be replayed or renewed. Do not invoke any old recovery installation, admission or execute command.

Ordinary static-config curl worked where shell process substitution failed. The resumed dispatcher used reviewed pre-tool validation followed by plain curl. Preparation/submission pacing did not measure actual network starts and cannot eliminate platform scheduling gaps. The resumed main segment completed 2,948 HTTP-200 requests; reviewer transport completed 160. Both stopped cleanly. [Complete transport history](docs/research/TRANSPORT_INCIDENT.md) retains the earlier failures and limitations.

Private operational files are retained for provenance, not instructions to relaunch: `ACTIVE_DISPATCHER.json` is stopped; old continuation-state/session fields may be historical. The previous full operational checkpoint is `.tools/checkpoints/checkpoint-before-final-research-delivery.md`. No provider work remains.

## Final verification and delivery

Final source/data/report commit **`a5493c3317b5df2e70318cd6b1ada94220e211a9`** passed [full CI 41182776959](https://github.com/rayidali/spiich_homework/actions/runs/41182776959). The `verify`, `research-native` and `compose` jobs succeeded, covering application/browser checks, the new cost exporter, actual Wren/native database checks, full Docker startup and posted-entry persistence. `live-ai` was skipped; completed provider measurements are recorded separately. See the [sanitized final CI receipt](docs/evidence/research-final-ci.json). A subsequent documentation-only delivery commit records these observations without changing the tested executable.

Final narrative review passed 18 automated checks plus claim review, binding exact formatted hashes in [the narrative receipt](docs/evidence/research-final-narrative-check.json). Repository formatting and current local-link checks passed. The 16-page PDF, detailed narrative, worked examples, raw scored outcomes, supplements and cost reconciliation are included in the source handoff.

The final archive is `submission.zip`, rooted at `daybook-ledger/`. The publication helper freezes a source manifest, scans secrets, syncs the permitted checkout, then verifies archive CRCs and exact source/checkout/ZIP bytes. Exact final manifest and archive hashes belong in private `.tools/publication-archive-verification.json` and `.tools/publication-verify-verification.json`, avoiding a self-referential hash inside the archive. Consult those receipts when checking a resumed handoff; do not regenerate study measurements.

Historical verification remains preserved: frozen inference passed 511 isolated TypeScript tests in 32 files, 35 actual Wren Python tests, nine PDF tests and CI 41155033249. Later operational recovery passed 120 targeted tests and CI 41171119383. The new cost exporter passed 41 local synthetic tests and the final full cloud run. Do not add overlapping reruns into a claimed test total.

No new experiment or automatic product deployment is required to complete this study. Future product work is separate and must retain the measured limitations below.

## Product and runtime baseline

Product name is **Daybook**; Spiich is the assignment recipient. React/TypeScript, Express **REST**, PostgreSQL exact-decimal double entry, immutable postings and linked reversals are implemented. Accounts, stored FX, reports, recurring drafts, durable anomaly jobs and correction-assisted categorization are present. The simpler UI uses Home / Transactions / Reports / Settings. Preserve that baseline.

The deployed assistant uses four authored financial tools with Gemini 3.1 Flash-Lite or the selectable OpenAI adapter. Research uses Gemini 3.5 Flash-Lite and separate synthetic fixtures; pgvector, File Search, Jev and bounded actual Wren integration are in the research harness. Mastra was not added. Research is logically isolated on the existing database server, not a separately measured physical service.

- Hosted application: [daybook-ledger-delta.vercel.app](https://daybook-ledger-delta.vercel.app), protected by Vercel login.
- Production executable: `7ecb435c421862dba5efd4e3b6f743c93fd1888e`; deployment `dpl_HQefAFAGwPS2x52c1nXPetRYovKq`.
- Product baseline: 103 backend tests, ten browser workflows and full Docker startup/persistence passed in [CI 41103851106](https://github.com/rayidali/spiich_homework/actions/runs/41103851106).
- Selected hosted cash/search/expense/proposal checks succeeded; intermittent provider failures remain. The separate original 40-case product live evaluation is incomplete. Research scores do not complete that different evaluation.
- Manual authorized scheduler checks passed; automatic cron firing was not observed. Hosted visual review, physical-device/additional-browser checks, load/failover/restore exercises and reviewer demo sharing remain separate product work.
- Vercel protection gates a shared writable demo. Do not disable it or claim production application identity/tenant authorization.

Preserve migrations 001–004 checksums, `.tools/postgres`, posted history, organization `00000000-0000-4000-8000-000000000001`, seed anchors, role `spiich_app`, and named Compose volume **spiich_postgres_data**. Never use `down -v` as routine cleanup or start a second PostgreSQL against the same data directory. Inspect current listeners before starting servers.

Local startup: `npm run dev`, or `npm run dev -- --reuse-db` for an existing database. Portable full-stack startup: `docker compose up --build`. Separate research Compose uses `compose.research.yaml` and `daybook_research_data`; do not reseed or reindex the completed study.

## Local publication and preferences

Use **local CLI authentication**, account rayidali, for GitHub and Vercel. Do not request chat connectors or secrets in chat. Root `.git` is protected. The existing permitted checkout is **/private/tmp/daybook-publish.kbVq33**, main, origin [rayidali/spiich_homework](https://github.com/rayidali/spiich_homework), a public repository. Confirm the temporary checkout exists before reuse. Local add/commit/push works despite a harmless stale credential-helper warning; do not move Git metadata into protected paths.

Use `.tools/prepare-publication.py` and `.tools/PUBLICATION_HELPER.md`: inspect a stable source snapshot, then sync/archive/verify against that exact manifest. It excludes secrets, private tooling, dependencies, build output and local data. Review the diff, commit and push locally. Executable changes require the relevant CI; later documentation-only evidence can use `[skip ci]`. The final delivery archive uses **daybook-ledger/**; its exact source binding is recorded in the private verification receipts.

GitHub is intentionally not configured for automatic Vercel deployments. Read [HOSTING.md](docs/HOSTING.md) before a separate deployment; production values were supplied as private overrides. Do not deploy research keys or routes merely because source is pushed.

The user wants autonomous completion and explanations they can rehearse. Keep [BUILD_LOG.md](docs/BUILD_LOG.md) and affected documentation current. Paid services were authorized within the saved limits; that does not authorize another purchase or unbounded new study. No guarantee of being “unrejectable,” perfect model accuracy, or million-user capacity is supported.

Project-local Emil Kowalski guidance remains at `.tools/design-skills/skills-main`, revision `a81dbca07f2217b7103e510c0f13f8d5b017afc9`. It is excluded local tooling, not a global skill installation. See [DESIGN.md](docs/DESIGN.md), [accounting walkthrough](docs/ACCOUNTING_WALKTHROUGH.md), [architecture](docs/ARCHITECTURE.md), [API](docs/API.md), and [verification](docs/VERIFICATION.md) for the implemented product.
