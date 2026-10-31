# Explain and demonstrate Daybook

## Compound grouping — deployed and CI verified

Questions can now group recorded amounts jointly by two or three ordered dimensions: account, person/business and month or quarter. Account/time views include every scoped posting account; person/business combinations fill missing periods only for tuples actually observed after the requested filters. Closing balances retain opening history. Exact arithmetic keeps each row’s account identity and period. The server caps the complete grid at 30,000 cells and 120 periods, then applies a global 50-row display limit with explicit truncation. This expands supported queries; it does not prove general question or formula intent. [Plain-language grouped-spending walkthrough](COMPOUND_GROUPING.md).

Exact-source CI passed **1,629 tests across 85 files and all 29 browser workflows**. The 98 named compound-grouping tests—45 compiler/output, four chat, 35 calculator and 14 real-PostgreSQL tests—are included in that test total. The one new compound-result browser workflow is included in the browser total. Provider responses and the browser chat response are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

## Net cash movement — deployed and CI verified

`net_cash_movement` measures signed posted cash change over an inclusive date range: cash debits minus cash credits. The server selects all cash-designated asset posting accounts, including archived history. Results use saved USD base values or one explicit native currency, with activity filters and grouping kept visible. Calculator movement ancestry retains periods and identities separately from as-of cash balances. This is net change, not gross payments, payment allocation, revenue, profit or a formal cash-flow statement. [Plain-language cash-change walkthrough](CASH_MOVEMENT.md).

The earlier `012f297` cash-movement release passed **1,530 tests across 81 files and all 28 browser workflows**. The 75 named cash-movement cases—26 compiler/output, seven chat, 30 calculator and 12 real-PostgreSQL tests—are included in that total. Provider responses in engineering tests are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

## Current product status — 2026-10-31

Source **`93a8617932daff772c5b5d9c836be15692a64979` is promoted** at [Daybook](https://daybook-ledger-delta.vercel.app), deployment `dpl_2Rh1j9ryaPzor5vsREcDvYJHgFSQ`. [Full CI 41251437109](https://github.com/rayidali/spiich_homework/actions/runs/41251437109) passed verification, native research and Compose; live-AI was skipped. The actual stable alias and project production target match this READY/PROMOTED deployment, with all-deployment protection retained. [Release evidence](evidence/compound-grouping-release.json).

The active `composable` chat route combines existing report tools with validated ledger queries and exact scenario arithmetic. The model chooses a structured plan; application code compiles permitted queries and calculates the answer. It cannot execute arbitrary SQL or post entries. Cash sources are server-selected, assumptions require original-user evidence, and eligible explicit all-history requests retain their full date scope. Shared PostgreSQL request admission and safe request/provider/plan diagnostics are enabled. File Search, vector retrieval, Wren and reviewer agents remain separate research paths.

The expense scope guard checks supported standalone first-user questions, with no earlier user turns. Assistant-only preambles are allowed. It resolves exact account names/codes and complete posting descendants in the same execution snapshot as the amounts, withholding conflicting plans before reading money. The returned proof lists only checked fields: omitted dates remain unverified. Any earlier user turn makes this guard unassessed; all conversation context still reaches ordinary execution without a scope proof. It does not prove follow-up meaning, rewrite a plan or add a model call. The earlier `6082a36` expense-scope release passed **1,455 tests across 77 files and all 28 browser workflows**. Its 12 real-PostgreSQL expense-scope cases passed; the model callbacks were stubbed. These totals include the named suites and must not be added together. Local pre-publication checks passed 189 focused tests, including 71 pure guard and 36 mocked integration cases, plus eight offline compiler checks, TypeScript and production build. CI browser workflows exercise the built app, not the protected hosted page or physical devices. No provider inference, new accuracy score or reopened evaluation budget was involved in this release. Protected health, metadata and SPA GETs are read-only deployment checks, not hosted visual inspection or live model comprehension. No fresh full-ledger comparison was performed, so unchanged current books are not claimed. Earlier model results remain tied to their original source.

The preceding `7ac0a88` release passed **three known date-scope regressions** for $0.0100061 in three provider attempts, with all 74 journals and 22 accounts unchanged and all three requests matched to 12 runtime events. All-history guard provenance was observed, but the model already chose the canonical date (`changed: false`): no actual lower-bound replacement or schema-repair call occurred live. This is bounded regression evidence, not a new general accuracy score. The earlier frozen comparison's 18/20 result belongs to its own source. [Three-case acceptance](evidence/chat-history-acceptance.json). These calls were not repeated for the `f4f3a7` conversation release or the later expense-scope, cash-movement and compound-grouping releases.

The focused live category comparison is complete: Gemini **33/33**, Jev **31/33** on held-out category plus taught preference. Both gave semantically acceptable categories in all 33 cases. Jev missed the business's Printing preference twice and, despite lower cost, failed the predefined reliability condition. Gemini remains the selected narrow category provider. [Results](evidence/category-runs/completed-v3/holdout/report.md), [71-check audit](evidence/category-runs/completed-v3/independent-audit.json), [decision](evidence/category-runs/completed-v3/release-decision.json).

Rehearse this: “Office supplies and Printing can both be sensible accounts for printer paper. Our business prefers Printing. When I correct a suggestion and post it, Daybook saves that reviewed example with the financial entry. Later suggestions can see it. In our small controlled test Gemini followed all the required preferences; Jev missed two paper examples. We kept Gemini because cheap answers were not enough to meet our reliability rule. This changes the examples the model sees, not its brain, and 33/33 synthetic cases does not mean it is always right.”

## Earlier provider-only repair — 2026-10-31, selected hosted checks passed

The hosted AI entry endpoint returned HTTP 502. Direct testing with the same production key reproduced upstream HTTP 503 on `gemini-3.1-flash-lite`. Two direct `gemini-3.5-flash-lite` checks succeeded: a small request in about 1.0 second and the full proposal grammar in about 1.47 seconds. The user later recalled the original input as approximately “gave $800 to a friend to party”; its original timestamp and raw response are unavailable.

**The source default and hosted configuration now use `gemini-3.5-flash-lite`.** Final repair source `de67b49dfce110f560840d0b9106d628f30f5d52` passed [CI 41213514203](https://github.com/rayidali/spiich_homework/actions/runs/41213514203) (verification, native research and Compose; live-AI skipped), and deployment `dpl_GopCJGQi67eHqSXLtRiVywVRRLbZ` reached READY. Final hosted HTTP checks produced the expected USD 340 Office supplies debit / Company credit card credit proposal, asked which account paid ambiguous rent, and asked the payment account plus business/personal meaning for the friend/party wording. The full 73-journal list and dashboard response remained unchanged; no posting request was made.

The first release passed its complete-entry check and returned cash of **$125,620**, matching the independent dashboard. Its ambiguous rent check **failed**: the model guessed a bank account. We preserved that result, then added explicit guidance that history, corrections and defaults cannot establish an omitted payment account. The later rent success is a regression check after that source change, not an independent accuracy benchmark. Each final case has one observed response. [Repair evidence](evidence/entry-provider-recovery.json).

The deployed repair distinguishes temporary upstream failure (`AI_SERVICE_UNAVAILABLE`, HTTP 503), connection failure (`AI_CONNECTION_ERROR`, HTTP 502), and the application's own timeout (`AI_TIMEOUT`, HTTP 504). At that provider-only checkpoint, calls used one attempt. Current financial chat can make one bounded, accounted schema-correction attempt; human review and accounting gates remain authoritative. Use the [verification record](VERIFICATION.md) and [checkpoint](../CHECKPOINT.md) for the final repair outcome.

For an interview: “I reproduced the provider failure, tested the replacement model with the real proposal grammar, deployed it after CI, and checked its financial answer against a separate endpoint. A second test exposed an important mistake: knowing that rent was paid does not tell us whether it came from the bank, cash or a card. I kept that failure, strengthened the clarification guidance, and verified that the revised hosted endpoint asked the missing question. That proves the observed regression was handled, not that every future interpretation will be right.”

The [original assignment review](ASSIGNMENT_REVIEW.md) exposed these product gaps. Error-reference propagation and trustworthy correction persistence were repaired in the later core release. The later focused comparison measures supplied-context preference following; it does not change what these earlier HTTP checks proved. The hosted repair used HTTP checks; CI browser workflows mocked AI responses, so it does not establish a freshly verified live browser experience.

The completed study remains bound to its recorded source `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08` and executable commit `0fe267b03b7baa0a2ff43c58165301b74261afa9`. This later product repair has not been rerun through that comparison and enables no experimental retrieval or reviewer route.

**Historical research-delivery checkpoint: 2026-10-31, America/New_York.** The accounting application is implemented and hosted. The separate nine-route study has completed **1,620 route episodes and 240 held-out reviewer outcomes**, with final integrity audits passing 41 main checks and 31 reviewer checks. Only adding lexical document access to broad tools clears the predeclared rule for a further experiment; no route is declared a production winner. The [complete research report](reports/research-study.md) and [16-page PDF](evidence/research-runs/holdout-v1/study-report.pdf) are published with final source `a5493c3317b5df2e70318cd6b1ada94220e211a9`. [CI 41182776959](https://github.com/rayidali/spiich_homework/actions/runs/41182776959) passed verification, native research and Compose; live-AI was skipped. The [CI receipt](evidence/research-final-ci.json) binds the result to that source.

The earlier missing-key, timeout-only and V2 daily-quota-stop notes are historical. Selected hosted chat/proposal checks subsequently succeeded, the study resumed under a funded allowance and completed, and every recorded failure remains. Research retrieval and reviewer routes have **not** been enabled in the deployed assistant.

## Your 30-second explanation

> “I built Daybook with AI assistance. It is a TypeScript accounting application with React, a REST API and PostgreSQL. Its foundation is an immutable double-entry journal: the database rejects invalid postings, even if someone bypasses the interface.
>
> “The AI can interpret a transaction and prepare a proposal, but the user reviews it and the normal accounting rules still apply. Financial chat chooses from approved reports and checked query building blocks; SQL and exact code calculate the numbers. I also completed a controlled comparison of nine AI designs. Document access earned another experiment; a bigger stack did not consistently improve the tasks our simple tools already handled.”

Do not claim that every line was handwritten. Explain the parts you directed, inspected and verified. Knowing why a constraint exists—and showing a test that would fail without it—is stronger evidence than memorizing generated code.

## Keep the two systems distinct

|                        | Implemented accounting application                                                                        | Isolated research study                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Purpose                | Let someone keep books and inspect their finances                                                         | Compare alternative AI architectures on the same synthetic tasks                                              |
| Data                   | Application ledger and its demo workspace                                                                 | Separate research schema, synthetic ledger/documents, restricted views                                        |
| Interface              | Home / Transactions / Reports / Settings; manual and AI-assisted entry                                    | Evaluation scripts and preserved reports; not an added production UI                                          |
| AI path                | Gemini/OpenAI boundary; approved reports, checked ledger plans, exact calculations and reviewed proposals | Nine routes: broader typed analytics, lexical search, File Search, pgvector, Jev, Wren and optional reviewers |
| Current Gemini setting | Source default and hosted configuration `gemini-3.5-flash-lite`; selected clarification checks passed     | `gemini-3.5-flash-lite` frozen study generator and optional same-model reviewer                               |
| Posting authority      | User-confirmed application actions, subject to service and database checks                                | No model-generated financial posting; proposals remain review-only                                            |
| Evidence of quality    | Accounting/browser/Compose tests and selected live hosted checks                                          | Completed, audited synthetic holdout: 1,620 route episodes and 240 reviewer outcomes                          |

The live research schema is logically isolated on the existing Neon database server; do not call that a separate physical server. Local research reproduction uses its own pgvector Compose database and volume. Neither path gives the model database owner credentials. The completed experiment did not change the hosted product; the later model/error-handling repair is tracked separately above.

## Explain it like an organized notebook

There are five kinds of accounts: **assets** (what the business owns), **liabilities** (what it owes), **equity** (the owner's stake), **revenue** (money earned), and **expenses** (costs). One business event explains at least two account changes. “Debit” and “credit” are accounting column names; they do not universally mean money in and money out.

- **React is the desk:** where people view, enter and review information.
- **The REST API is the clerk:** it validates requests, runs the appropriate operation and returns understandable errors.
- **PostgreSQL is the permanent notebook:** posted financial history obeys rules below the UI.
- **A database transaction is a sealed envelope:** all related changes commit together, or none do.
- **An idempotency key is a receipt number:** repeating the same request does not create a second purchase.
- **A draft revision is a version number:** an old browser tab cannot approve a changed draft accidentally.
- **The outbox is a durable to-do list:** posting records both the entry and the need for background analysis.
- **The model is an assistant at the desk:** it can propose an interpretation; it does not own the notebook's rules.

Read the [worked accounting example](ACCOUNTING_WALKTHROUGH.md) before rehearsing the technical answers.

## Walkthrough 1: a $340 card purchase

Say: **“Bought office supplies for $340 with the company credit card.”**

1. The model sees the active chart of accounts and relevant history/corrections. It proposes debit Supplies $340 and credit Company credit card $340. It has not posted anything.
2. Code validates the account IDs, currency, decimal amounts, exchange-rate requirements and equal debits/credits. Missing or ambiguous information produces clarification rather than a guessed posting.
3. The UI shows the account effects. The user reviews the proposal and confirms through the normal application flow.
4. The API checks the reviewed draft revision and posts atomically. PostgreSQL performs its own checks and prevents later edits to posted history.
5. The expense increases profit-and-loss expenses, and the card liability increases. Bank cash stays unchanged until the card is paid.
6. If the entry was wrong, create a linked reversal. Keep both records; do not erase the original.

A useful question to ask yourself: **“Why didn't cash fall?”** Because the company borrowed from the card issuer to make the purchase. This is why guessing accounting from the word “paid” is dangerous.

For a customer invoice, explain the different path: issuing the invoice records revenue and a receivable; receiving its payment increases bank cash and reduces the receivable. Recording revenue again would double-count the sale.

## Why SQL, retrieval and a reviewer do different jobs

| Job                      | Analogy                                                  | Why the other tools do not replace it                                                                                           |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SQL and exact arithmetic | Read the official notebook and use a calculator          | A nearest-neighbor search can miss rows. It cannot safely total every posted debit and credit.                                  |
| Retrieval                | Find the right page in a filing cabinet                  | A SQL balance does not tell you the salary in a hiring worksheet or the terms of a contract.                                    |
| Semantic review          | Ask another reader to inspect the candidate and evidence | Another model can miss a mistake or repeat the generator's misunderstanding. Its approval cannot override a failed calculation. |

**RAG** means retrieving relevant source material for an answer. Word search can be RAG; vector search is one retrieval method, not the definition of RAG. An embedding turns text into numbers useful for matching meaning. pgvector stores/searches those embeddings in PostgreSQL. Neither is an accounting calculator.

The deployed chat selects a custom-built, approved financial tool. It does **not** generate arbitrary executable SQL. In the experiment, R1–R5 and R7–R8 use typed plans compiled by our code; R6 uses model-proposed SQL through the actual Wren engine and restrictive SQL/provenance checks. Be precise about which path you are discussing.

### Walkthrough 2: “Can I afford another employee?”

Start by clarifying salary, employer costs, time horizon, reserve requirements and what other cash movements should be considered. A bare “yes” from the cash balance would be an unsupported financial conclusion.

For the **synthetic development example** in the [research report](reports/research-study.md#1-problem-and-a-worked-example):

| Evidence                                                            | Source                                       |
| ------------------------------------------------------------------- | -------------------------------------------- |
| September-end cash: $164,615                                        | Posted ledger queried with the explicit date |
| Salary: $6,000/month; employer burden: 18%; recruiting: $3,000 once | Current hiring worksheet                     |
| Minimum reserve: $50,000                                            | Reserve policy                               |
| Three months; ignore other future movements                         | Explicit user scenario                       |

The exact calculator computes `$6,000 × 1.18 = $7,080/month`, then `$7,080 × 3 + $3,000 = $24,240`. Cash above the reserve becomes `$164,615 − $24,240 − $50,000 = $90,375`.

The answer should say: **“Under those assumptions, $90,375 remains above the reserve.”** It must say that normal operating costs, future receipts and other obligations were excluded. This is an incremental scenario, not a complete cash-flow forecast or a recommendation to hire. These are research-fixture amounts, not the current hosted application's balances, and the walkthrough is not a claim that every route answered it successfully.

An optional reviewer can check for missing assumptions or unsupported claims. The mandatory code checks still enforce the arithmetic and evidence boundaries. A reviewer cannot supply a missing document, infer an unknown salary with certainty, or authorize a posting.

## What we wrote, and what external tools supply

| Component                 | Custom Daybook work                                                                                                                    | External building block                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Accounting engine         | Schema/migrations, posting/reversal services, database guards, exact-money rules, reports                                              | PostgreSQL; `decimal.js`                                                                                   |
| Application               | React workflows, REST endpoints, validations, recurring drafts, anomaly review, idempotency and job handling                           | React, TypeScript, Express, Zod; Docker Compose for local execution                                        |
| Deployed financial tools  | Report and query schemas, validated filters, parameterized SQL, exact calculations, temporal/source checks and evidence links          | Gemini/OpenAI model calls interpret the request; those financial tools are **not built-in provider tools** |
| Categorization            | Retrieve confirmed corrections and relevant history by organization; validate suggested accounts                                       | Language model proposes the category; no model fine-tuning                                                 |
| Broad research analytics  | Typed query compiler, exact calculator, source/period/entity validation, restricted database execution                                 | PostgreSQL                                                                                                 |
| Custom document retrieval | Authorized ingestion, lexical/hybrid search, source/version mapping, retrieval tests                                                   | Gemini embeddings and pgvector                                                                             |
| Managed retrieval         | File upload/index workflow, authorized citation resolution and common final-answer adapter                                             | Gemini File Search via its Interactions API                                                                |
| Reranking and review      | Candidate/check definitions, orchestration, schema validation, development threshold selection, comparison metrics                     | Jev `jev-1.14.0`; separate Gemini reviewer invocation                                                      |
| Wren route                | Business-model configuration, subprocess bridge, SQL allowlist, units/scope validation and read-only execution                         | Actual pinned Wren core engine and SQL parser                                                              |
| Evaluation                | Synthetic fixtures, independent financial references, route harness, frozen controls, budget records, scoring, uncertainty and reports | Testing/plotting libraries and provider APIs; no external human judge                                      |
| Hosting                   | Shared application services, native hosted adapters, scheduler/job integration, deployment checks                                      | Vercel and Neon                                                                                            |

Do not say “Google handles correctness” because it offers structured output, Files or embeddings. Google supplies model/retrieval capabilities; the application still has to decide which data the model may see, what a financial quantity means, how to verify it, and when to withhold an answer. Jev reranking/review and Wren remain research components. Jev Choice category selection is a separately implemented and measured alternative. The predefined comparison retains Gemini, and that hosted category path passed selected API acceptance checks.

## Explain the safety boundaries without overclaiming

**Database correctness and answer correctness are different.** The database can reject an unbalanced journal, while a chatbot can still misunderstand which period a question asks about. A perfectly balanced entry can also have the wrong expense category. Use layered checks and user review without describing them as a guarantee against every mistake.

**Structured output is a format contract.** Valid JSON can contain the wrong account, wrong date or wrong amount. Zod/schema validation is followed by business checks and evidence verification.

**A citation must support the actual claim.** A document containing a $6,000 monthly salary does not by itself support a $24,240 three-month total. The derived fact must cite its verified calculation. A July amount cannot prove October's expense merely because the values happen to be equal.

**Grouping changes meaning.** A vendor's slice of rent is not the whole rent total. A day's cash movement is not the cumulative cash balance. The research scope checks preserve date ranges and identity grain. Unsupported or ambiguous source lineage is withheld; multiplying by one cannot create broader evidence.

**False withholding matters.** A correct-looking answer may fail because it omitted an exact tag, cited the document instead of its calculation, or used equal-valued operands whose source scopes could not be identified uniquely. That is lost task completion, not automatically “improved safety.” Report these cases separately from wrong financial numbers.

**Another agent is fallible.** R7 uses the same Gemini weights in a second call, so its errors can be correlated. Jev checks are not a calibrated probability that the whole answer is wrong. Both can reject a good answer or miss a bad one; both depend on the evidence they receive. Review failures withhold output, but a timeout is not successful semantic flaw detection.

## Explain the experiment in 90 seconds

> “I did not install every component and assume the bigger stack was better. I created nine controlled alternatives: the existing narrow control; broader analytics; lexical documents; managed File Search; custom hybrid retrieval; Jev reranking; Wren analytics; and two reviewer variants.
>
> “Each route gets the same question instances, synthetic data, study generator and mandatory checks. Components have declared comparisons, so I can ask what changed when I added retrieval or a reviewer. R4 is the control for reranking, Wren and the two reviewers.
>
> “Development runs found defects in the experiment itself. For example, the original control adapter omitted evidence, and date scopes were not represented consistently across query backends. I preserved those failures and corrected the shared contract before freezing. I do not call those pilot scores a final ranking.
>
> “The completed holdout used 60 questions in 30 scenario groups, three repeats and nine routes. Rewordings and repeats of the same scenario are correlated, so uncertainty is clustered by scenario group. A separate 80-candidate held-out stress test compared three reviewer methods.
>
> “Managed File Search scored highest across the broad benchmark, at 70.6%. But on the predefined questions our existing tools could already answer, the control scored 91.7% and File Search 75%. Only adding document access to broad tools cleared our declared decision rule. That supports another focused experiment, not replacing the existing assistant or calling a model production-safe.”

Do not confuse **1,620 measured route episodes** with 1,620 API calls or 1,620 independent scenarios. The main run used 3,881 provider usage records across 30 held-out scenario groups; it retained 20 execution errors. Similarly, the reviewer's 240 measured outcomes include 80 deterministic checks that make no provider call; its model reviewers used 160 requests.

The automated rubric totals 90; the unmeasured 10-point human clarity dimension is not invented. Synthetic document/semantic labels and narrative quality have not received independent human adjudication. The implementation and internal reviews were AI-assisted. Contract tests and model review are not substitutes for external human evaluation.

The [pre-holdout rules](research/PRE_HOLDOUT_REVIEW.md) require complete valid measurements and hard-gate checks before conclusions. Query/retrieval candidates need the fixed targeted-family +5-percentage-point benefit with conservative uncertainty screens; reviewer candidates must reduce flawed acceptance without more than +5 points of additional correct-answer withholding. These are declared practical criteria, not a post-hoc “best score” or a formal significance claim. No unmeasured combination of favorable components is automatically recommended.

### What the measured result means

Think of giving an assistant a textbook. It can now answer questions that were impossible with only a calculator, but it may make simple calculator tasks more complicated. That happened here: the broader benchmark rewards new document capabilities, while the small, predefined common-capability subgroup reveals regressions on familiar tasks. The subgroup has only six scenario groups and remains secondary; it does not replace the primary score.

Only H2—lexical documents over broad tools—clears the targeted rule: **+46.7 percentage points [35.0, 60.0]** on document/scenario questions. R3 has the largest overall score, **127/180**, but its targeted advantages over lexical and hybrid retrieval have intervals that include harm. These are exploratory, unadjusted group intervals, not significance claims. Read the [decision table](evidence/research-runs/holdout-v1/decisions/report.md) alongside the [common-capability results](evidence/research-runs/holdout-v1/common-capabilities/report.md).

The reviewer experiment also shows a tradeoff. Out of 40 deliberately flawed and 40 correct synthetic answers, **Gemini plus the deterministic gate accepted 7 flawed answers and withheld 1 correct answer**; **Jev plus the gate accepted 6 flawed answers and withheld 5 correct answers**. Gemini's observed withholding increase was 2.5 points, but its uncertainty interval reached 7.9, above the 5-point limit, so the result is inconclusive. Jev's 12.5-point increase exceeds the target. This stress test's deterministic baseline checks schema, citation existence and source amount/currency pairs; its escape rate is not a failure rate for the complete accounting engine or the main route validator. Neither reviewer is ground truth, and the synthetic 50% flaw prevalence is not production traffic.

The next justified experiment is limited document access with the existing narrow tools preserved and another evaluation before rollout. An intent router, a different model, or a combination of favorable routes would be a **new, unmeasured configuration**. We have not deployed one. Final research tracking totals approximately **$6.050602768**, including retained unknown-cost reservations; this is not a provider invoice or a verified account balance. [Full cost reconciliation](evidence/research-final-costs/cost-reconciliation.md).

## A six-minute application demo

Prepare a demo workspace and rehearse the sequence. The frozen research run is not an interactive demo and should not be restarted casually for a presentation.

| Time      | Show                                      | Explain                                                                                                                                             |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:40 | Home                                      | Metrics come from posted journal lines. Drafts are excluded; cash and profit differ.                                                                |
| 0:40–1:40 | A $340 card-supplies entry                | Show the account-effects review and balance check. Post through the normal flow, then open the immutable record.                                    |
| 1:40–2:30 | P&L, balance sheet, account ledger        | The expense and card debt rise while bank cash stays unchanged. Trace a displayed amount to its entries.                                            |
| 2:30–3:10 | Reverse the example                       | Preserve the original plus its linked opposite. Explain how the reversal date affects as-of reports.                                                |
| 3:10–3:50 | Review alerts                             | Show a possible duplicate or unusually large rent. Review the evidence; no alert silently deletes financial history.                                |
| 3:50–4:30 | Recurring schedules                       | Due occurrences become drafts. Explain calendar anchors, review and safe repeated generation.                                                       |
| 4:30–5:20 | AI entry or financial chat                | Inspect a proposal before confirming, or ask for cash/expenses and follow its period and evidence.                                                  |
| 5:20–6:00 | A meaningful test and the research report | Show the database invariant or stale-revision test, then distinguish engineering checks from the completed synthetic measurements and their limits. |

The October 31 hosted model update passed the complete supplies/card proposal and cash checks, while an ambiguous rent prompt exposed an account guess. After a prompt change and a new deployment, selected rent and friend/party checks asked for clarification. Check availability for the actual demo without presenting these selected checks as general reliability or a mocked response as a successful hosted workflow. If a provider fails, show the handled error and the still-working manual accounting path. Never display keys, connection strings, private HTTP bodies or authentication state.

## Questions you should be able to answer

**REST or GraphQL?** REST with JSON over Express. Accounts, entries, reports, recurring schedules and alerts are resources; posting and reversal are explicit operations. TypeScript is used on both sides, with runtime validation at the boundary. GraphQL was not required for these workflows.

**Why enforce double-entry in PostgreSQL as well as the API?** API validation gives a useful error, but another write path could bypass it. A per-row `CHECK` cannot express the final sum of all journal lines. Deferred constraint triggers inspect the transaction's completed state. Locks and concurrency tests protect the parent-entry transitions as well as ordinary single requests.

**How does the balance sheet include revenue and expenses?** The ledger balances across all five account types. Accumulated unclosed profit is included in equity in the balance-sheet calculation. Read the worked example and explain the signs rather than memorizing a seeded total.

**What happens on double-clicks, retries or an old browser tab?** A repeated create request uses the same idempotency key and request-content hash. Same key/same content returns the same result; changed content conflicts. Draft edits/posting compare the expected revision under a lock, so a stale confirmation cannot post a changed draft. A lost edit response can require a refresh.

**Why exact decimals and stored exchange rates?** Floating-point arithmetic is unsuitable for deciding whether money balances. Amounts use exact decimal handling; each base-currency line is rounded under the defined rule and totals must match. The transaction's rate is persisted. Reversals use the original amounts/rate, not today's exchange rate.

**Do anomalies require a live stream?** No. Historical posted entries already form a comparison dataset. A job can compare a new entry with prior similar entries. Daybook uses explainable duplicate, amount-history and category-pattern rules; synthetic unusual entries make their behavior demonstrable. A continuous bank feed would be another input source, not a prerequisite. No fraud-detection accuracy is claimed.

**Does categorization actually learn?** Posting a reviewed account correction records a scoped example atomically; a draft alone does not teach it. Later context can retrieve it, while reversal or forgetting excludes it. In the focused held-out test, Gemini followed all 10 required preferences and Jev eight. Both chose acceptable semantic categories. That measures following supplied examples, not weight training or the quality of production retrieval. The persistence boundary passed real-DB/browser CI. The old nine-route study tested Jev reranking/review only.

**What if a worker crashes after the entry posts?** The job is committed with the financial operation. A lease permits recovery and unique effect keys make reprocessing safe. That is at-least-once execution with idempotent effects, not exactly-once delivery.

**Why not microservices or a load balancer first?** A posting is one tightly coupled database transaction. Splitting it prematurely adds distributed failure modes. A load balancer distributes requests; it does not understand accounting, retrieve contracts or verify answers. The API and worker can be deployed separately when measured workloads justify it.

**Could a million people use it today?** No measured claim supports that. First define active users, requests per second, history size, tenant skew and acceptable latency; then load-test. A real service also needs identity/authorization, tested tenant isolation, backups and restore drills, observability, connection budgets, continuously serviced workers, and distributed rate/cost limits. The current in-process AI concurrency limit is not global across replicas.

**Did we build Docker Compose?** Yes. Application startup, health/container checks and posted-entry persistence have passed CI. Research has a separate pgvector Compose setup that exercises the actual Wren engine and database restrictions. Local Docker availability on the author's machine is a separate question from the checked-in runnable setup and cloud CI evidence.

**What would you do next?** Finish the final handoff for the CI-tested, measured Gemini category path, preserving its 11 selected hosted API checks. The original 40-case live whole-entry evaluation is still separate and incomplete. Automatic Compose scheduling is observed; hosted cron firing and real-device usability are not. The broader study supports a later limited document-access experiment, not another prerequisite for the assignment. Document upload is absent and not required by the brief.

## Explain hosting and the interface accurately

Daybook is the product name; Spiich is the assignment recipient. The simpler interface uses Home / Transactions / Reports / Settings. A beginner chooses money in, money out or transfer and reviews the account effects. Advanced journals remain available for more complex cases. The [design record](DESIGN.md) explains the decisions and verification limits. Browser workflow tests do not establish real-phone ergonomics or a fresh human visual review.

> “Docker and the hosted demo share accounting services. Vercel serves the React build and runs the Express API through a native ESM adapter. Neon stores the demo data. The runtime has a restricted database role; migration/setup uses separately held owner access. The same financial constraints apply.”

The Compose process scheduler has been observed creating a draft automatically in CI; worker processing and reversal resolution also passed. On Vercel, a configured daily scheduler catches up drafts and jobs, while successful mutations can trigger a bounded batch. Durable PostgreSQL jobs retain retry state. Authorized scheduler HTTP checks still do not prove observed automatic hosted cron firing or production-sized backlog capacity.

Vercel login protects one shared writable demo workspace. It is not application-user authentication or tenant authorization. The assignment did not require login, but reviewer sharing still needs deliberate handling. Do not disable protection or describe the demo as a public multi-user product.

A green build alone does not prove the hosted API can run. Earlier invocation and scheduler-adapter failures led to native-wrapper import tests and actual endpoint checks. Explain that lesson with the preserved evidence rather than saying the current app still has the original timeout-only state.

## Evidence worth showing

| Evidence                                                                                                                                                                                    | What you can claim                                                                                                                                                                         | What you cannot infer                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [Current product CI](https://github.com/rayidali/spiich_homework/actions/runs/41226562746) and [earlier core release receipt](evidence/core-repair-release.json)                            | Real-DB/category/currency checks, all 18 browser workflows and automatic Compose scheduler/worker acceptance; earlier hosted error correlation                                             | General model accuracy, fresh hosted visual/device quality or observed Vercel cron                |
| [Focused category results](evidence/category-runs/completed-v3/holdout/report.md) and [audit](evidence/category-runs/completed-v3/independent-audit.json)                                   | Complete paired synthetic selector measurement, preserved failures/costs and the declared allocation screen                                                                                | Full-journal correctness, database retrieval quality, weight training or production 100% accuracy |
| [Historical application CI for executable 7ecb435c](https://github.com/rayidali/spiich_homework/actions/runs/41103851106)                                                                   | 103 backend tests, ten browser workflows, native hosted imports and Docker startup/persistence passed for that revision                                                                    | Complete live model accuracy or physical-device quality                                           |
| [Latest frozen-study CI](https://github.com/rayidali/spiich_homework/actions/runs/41155033249) and [receipt](evidence/research-ci-v4.json)                                                  | Application verification, Compose and native Wren/pgvector jobs passed for the recorded source; live-AI job was skipped                                                                    | That CI executed the held-out provider experiment                                                 |
| [Frozen local checks](evidence/research-local-v4.json)                                                                                                                                      | 511 isolated TypeScript tests, 35 actual Wren Python tests, nine PDF-exporter tests, build and formatting passed; database-dependent suites were excluded locally and exercised through CI | Model answer accuracy, or independent human adjudication                                          |
| [Hosted chat recovery evidence](evidence/chat-recovery-verification.json)                                                                                                                   | Selected cash/search/expense answers and a review-only proposal succeeded; numerical checks matched independent endpoints; failures remain recorded                                        | A full 40-case live evaluation or a guarantee of current availability                             |
| [Hosting evidence](evidence/hosting-verification.json)                                                                                                                                      | Protected health/report/scheduler checks at the recorded snapshot                                                                                                                          | Observed automatic cron firing, capacity or current account balances                              |
| [Held-out manifest](evidence/research-runs/holdout-v1/manifest.json), [freeze](evidence/research-verifiers/verifiers-v1/verifier-freeze.json), [research report](reports/research-study.md) | Completed synthetic measurements, unchanged fingerprints and declared component decisions                                                                                                  | Production accuracy, full prose faithfulness or an automatic deployment winner                    |

The historical architecture [PDF](reports/architecture-review.pdf) and [HTML walkthrough](reports/architecture-review.html#journeys) can help explain the original design, but record an earlier planning snapshot. Use the current [research narrative](reports/research-study.md) for implemented experiments, scope limits and complete measurements. Old invalid/incomplete pilots remain diagnostic; their graphs cannot select a winner.

The [main final audit](evidence/research-holdout-final-check.json) and [reviewer final audit](evidence/research-verifier-holdout-final-check.json) support completion and integrity, not independent human validation. The external cost exporter passed 41 local synthetic tests, TypeScript and formatting and is included in the passing final source CI. Archive-verification receipts are private under `.tools/publication-*-verification.json`; match the delivered ZIP to its receipt instead of treating CI as an archive check. Do not combine overlapping historical test counts into a larger claim.

## Code paths to rehearse

| Path                                                                                                                                                | Be able to explain                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Composer](../web/src/Composer.tsx) → [API](../server/app.ts) → [ledger](../server/ledger.ts) → [ledger migration](../db/migrations/001_ledger.sql) | Review, validation, posting, database invariants and immutability                                           |
| [Reports](../server/reports.ts)                                                                                                                     | Posted-only balances, signs, opening history and profit in equity                                           |
| [Application AI](../server/ai.ts)                                                                                                                   | Custom financial tools, structured proposals, correction retrieval and provider failures                    |
| [Recurring](../server/recurring.ts) / [anomalies](../server/anomalies.ts)                                                                           | Occurrence keys, scheduling anchors, durable jobs and explainable review alerts                             |
| [Accounting tests](../tests/accounting.test.ts)                                                                                                     | Direct-SQL invalid writes, concurrency/revision races and exact-money behavior                              |
| [Research routes](../research/routes.ts) / [answer checks](../research/answer.ts) / [scope checks](../research/scope.ts)                            | Controlled substitutions; calculation citations; dates, identities and grouping grain                       |
| [Research scoring](../research/scoring.ts) / [decision analysis](../scripts/analyze-study-decisions.ts)                                             | Independent references, correlated scenarios, primary versus secondary metrics and conservative conclusions |

## Rehearsal and submission checklist

- Walk through a real request and point to where each guarantee lives: UI, API, transaction, database or measured evaluation.
- Use current report values in a demo; legitimate postings can change seeded balances. Keep application examples separate from research fixtures.
- Explain one failure honestly: an invalid balanced-but-miscategorized proposal, provider timeout, wrong citation, or unnecessary withholding. State what the system detects and what still needs judgment.
- Follow [verification](VERIFICATION.md) and [the checkpoint](../CHECKPOINT.md) for current checks. Preserve the completed runs, frozen source, protocol, data, index and threshold; a future experiment needs its own version.
- Use local/server-side configuration for secrets. Keep `.env`, credentials, private provider responses, database files and local tooling out of the submission and screen recording.
- Rehearse both findings: broader document coverage helped, while the narrow control remained stronger on the common-capability subgroup. Explain why only H2 earned further testing and neither reviewer cleared its rule.

The assignment demonstrates engineering judgment: strong accounting invariants, understandable workflows, explicit AI authority boundaries and evidence proportionate to the claim. Do not claim to know Spiich's private hiring rationale or guarantee that any implementation makes rejection impossible.

<a id="transaction-categorization-and-the-proposed-jev-comparison"></a>

## Transaction categorization and the measured Jev comparison

**Correction mechanism:** whole-entry AI sees active accounts, up to six eligible saved corrections and six similar posted non-reversal entries from its workspace. A server-issued proposal ID binds the suggestion to the saved draft and reviewed revision. Changing an account and posting writes correction memory atomically with the ledger entry. Amount/memo-only edits and draft saves do not become account teaching examples. The legacy feedback endpoint returns 410 and cannot accept arbitrary teaching records.

Retrieval rechecks posting, reversal, active accounts, supersession and forget status. Forgetting excludes examples without changing financial history. Real PostgreSQL/browser tests establish this persistence and trust boundary. The selector comparison separately supplies identical eligible context to both providers; it does not measure how well the database finds relevant examples.

**The category service:** the short form fixes amount, date, direction, currency/rate and payment account before Gemini or Jev chooses one expense/revenue account. Both receive the same immutable server-owned snapshot and candidate order; a deterministic exact-memory/label reference is the simpler control. Jev's option membership, probability ranges, rounding-compatible mass, selected maximum and token usage are checked. Rounded confidence is an uncalibrated signal, not a recomputed equality, an accuracy rate or permission to post. The old reviewer's 0.8 threshold is unrelated.

A SELECT result becomes a validated two-line proposal for review. Missing facts or unclear personal/business purpose request clarification. Loans, invoice settlements, refunds, assets, transfers and complex splits use the full-entry workflow. The UI preserves category-only corrections, rejects stale suggestions, and clears a discarded saved-draft binding atomically. There is no provider dropdown or correctness-percentage badge.

**Walkthrough:** the model first calls printer paper “Office supplies.” That is a sensible generic category. The business reviews the entry and changes it to “Printing.” After posting, the next paper suggestion receives that example. In the held-out paper sequence, Gemini followed Printing after both one and three corrections; Jev still chose Supplies. A laptop from the same seller must instead hand off for asset accounting, regardless of past paper purchases.

**What the experiment found:** 24 synthetic sequences, six development and 18 held-out, each at 0/1/3 prior review events, produced 216 observations across Gemini, Jev and the reference. V3 had 114 paid calls and no execution errors. Held-out category plus preference was 33/33 for Gemini, 31/33 for Jev and 16/33 for the reference. Both paid models were semantically correct on all 33 categories and handled all nine required clarifications. Some clarification cases were deterministic input gates; those are not model achievements.

Jev minus Gemini was −6.06 percentage points with exploratory paired interval [−18.18, 0] across 11 category groups. Jev's tracked cost per correct category was 76.56% lower, but its lower interval crossed the declared −5-point reliability boundary. The reviewed decision retains Gemini within the narrow selector. Cumulative spending, including five calls from the two preserved earlier development versions, was 119 calls / $0.036753586. The ledger is closed. [Report](evidence/category-runs/completed-v3/holdout/report.md), [audit](evidence/category-runs/completed-v3/independent-audit.json), [decision](evidence/category-runs/completed-v3/release-decision.json).

Across five held-out groups with taught targets, Gemini moved to the target after context in three and already chose it in two; Jev moved in two, missed paper, and already chose it in two. These are paired hypothetical contexts, not longitudinal users or model-weight updates. The dataset and labels are synthetic and AI-assisted, with no independent human adjudication. Do not call 33/33 production accuracy, or treat a category suggestion/handoff as a complete journal.

At the earlier category checkpoint, real database and all 18 browser workflows passed that release’s CI, separately from these model scores. The exact-source protected hosted release passed 11 selected API checks. A [separate 144-check audit](evidence/category-hosted-acceptance-audit.json) confirmed unchanged journal/dashboard snapshots, and the release receipt matches all 11 response references to real runtime logs. The hosted checks cost an estimated $0.0085057 separately from the category comparison. These were HTTP checks with AI-assisted qualitative review, not a fresh hosted browser test or independent human adjudication. The original 40-case [whole-entry evaluation](PRODUCT_AI_EVALUATION.md) remains incomplete; its repaired fixtures use real reviewed postings and separate before/after workspaces, so any gain there combines memory and posted-history effects.

Implementation: [selector](../server/category-selector.ts), [scoped service](../server/category-service.ts), [posted correction memory](../server/categorization-memory.ts), [review UI](../web/src/Composer.tsx), [database tests](../tests/category-service.test.ts), [browser workflows](../tests/browser/category.spec.ts). No bank feed, CSV import or document-upload workflow is implemented; those are optional extensions rather than missing requirements of this assignment.
