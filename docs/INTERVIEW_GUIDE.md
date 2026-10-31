# Explain and demonstrate Daybook

**Current checkpoint: 2026-10-31, America/New_York.** The accounting application is implemented and hosted. The separate nine-route study has completed **1,620 route episodes and 240 held-out reviewer outcomes**, with final integrity audits passing 41 main checks and 31 reviewer checks. Only adding lexical document access to broad tools clears the predeclared rule for a further experiment; no route is declared a production winner. The [complete research report](reports/research-study.md) and [16-page PDF](evidence/research-runs/holdout-v1/study-report.pdf) are generated locally; final publication and submission packaging remain pending.

The earlier missing-key, timeout-only and V2 daily-quota-stop notes are historical. Selected hosted chat/proposal checks subsequently succeeded, the study resumed under a funded allowance and completed, and every recorded failure remains. Research retrieval and reviewer routes have **not** been enabled in the deployed assistant.

## Your 30-second explanation

> “I built Daybook with AI assistance. It is a TypeScript accounting application with React, a REST API and PostgreSQL. Its foundation is an immutable double-entry journal: the database rejects invalid postings, even if someone bypasses the interface.
>
> “The AI can interpret a transaction and prepare a proposal, but the user reviews it and the normal accounting rules still apply. Financial chat uses four approved read-only tools whose numbers come from SQL. I also completed a controlled comparison of nine AI designs. Document access earned another experiment; a bigger stack did not consistently improve the tasks our simple tools already handled.”

Do not claim that every line was handwritten. Explain the parts you directed, inspected and verified. Knowing why a constraint exists—and showing a test that would fail without it—is stronger evidence than memorizing generated code.

## Keep the two systems distinct

|                        | Implemented accounting application                                            | Isolated research study                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Purpose                | Let someone keep books and inspect their finances                             | Compare alternative AI architectures on the same synthetic tasks                                              |
| Data                   | Application ledger and its demo workspace                                     | Separate research schema, synthetic ledger/documents, restricted views                                        |
| Interface              | Home / Transactions / Reports / Settings; manual and AI-assisted entry        | Evaluation scripts and preserved reports; not an added production UI                                          |
| AI path                | Gemini or OpenAI adapter; four financial tool families and reviewed proposals | Nine routes: broader typed analytics, lexical search, File Search, pgvector, Jev, Wren and optional reviewers |
| Current Gemini setting | `gemini-3.1-flash-lite` default in the application                            | `gemini-3.5-flash-lite` shared study generator and optional same-model reviewer                               |
| Posting authority      | User-confirmed application actions, subject to service and database checks    | No model-generated financial posting; proposals remain review-only                                            |
| Evidence of quality    | Accounting/browser/Compose tests and selected live hosted checks              | Completed, audited synthetic holdout: 1,620 route episodes and 240 reviewer outcomes                          |

The live research schema is logically isolated on the existing Neon database server; do not call that a separate physical server. Local research reproduction uses its own pgvector Compose database and volume. Neither path gives the model database owner credentials. The hosted product remains unchanged after the completed experiment.

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
| Deployed financial tools  | Four tool schemas, validated parameters, SQL/report queries, numerical responses and evidence links                                    | Gemini/OpenAI model calls interpret the request; those financial tools are **not built-in provider tools** |
| Categorization            | Retrieve confirmed corrections and relevant history by organization; validate suggested accounts                                       | Language model proposes the category; no model fine-tuning                                                 |
| Broad research analytics  | Typed query compiler, exact calculator, source/period/entity validation, restricted database execution                                 | PostgreSQL                                                                                                 |
| Custom document retrieval | Authorized ingestion, lexical/hybrid search, source/version mapping, retrieval tests                                                   | Gemini embeddings and pgvector                                                                             |
| Managed retrieval         | File upload/index workflow, authorized citation resolution and common final-answer adapter                                             | Gemini File Search via its Interactions API                                                                |
| Reranking and review      | Candidate/check definitions, orchestration, schema validation, development threshold selection, comparison metrics                     | Jev `jev-1.14.0`; separate Gemini reviewer invocation                                                      |
| Wren route                | Business-model configuration, subprocess bridge, SQL allowlist, units/scope validation and read-only execution                         | Actual pinned Wren core engine and SQL parser                                                              |
| Evaluation                | Synthetic fixtures, independent financial references, route harness, frozen controls, budget records, scoring, uncertainty and reports | Testing/plotting libraries and provider APIs; no external human judge                                      |
| Hosting                   | Shared application services, native hosted adapters, scheduler/job integration, deployment checks                                      | Vercel and Neon                                                                                            |

Do not say “Google handles correctness” because it offers structured output, Files or embeddings. Google supplies model/retrieval capabilities; the application still has to decide which data the model may see, what a financial quantity means, how to verify it, and when to withhold an answer. Do not say Jev or Wren has been added to production categorization: those components are isolated experimental routes.

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

Selected hosted generation checks have succeeded, and failures are also recorded. Check availability for the actual demo without presenting a mocked response as live evidence. If a provider fails, show the handled error and the still-working manual accounting path. Never display keys, connection strings, private HTTP bodies or authentication state.

## Questions you should be able to answer

**REST or GraphQL?** REST with JSON over Express. Accounts, entries, reports, recurring schedules and alerts are resources; posting and reversal are explicit operations. TypeScript is used on both sides, with runtime validation at the boundary. GraphQL was not required for these workflows.

**Why enforce double-entry in PostgreSQL as well as the API?** API validation gives a useful error, but another write path could bypass it. A per-row `CHECK` cannot express the final sum of all journal lines. Deferred constraint triggers inspect the transaction's completed state. Locks and concurrency tests protect the parent-entry transitions as well as ordinary single requests.

**How does the balance sheet include revenue and expenses?** The ledger balances across all five account types. Accumulated unclosed profit is included in equity in the balance-sheet calculation. Read the worked example and explain the signs rather than memorizing a seeded total.

**What happens on double-clicks, retries or an old browser tab?** A repeated create request uses the same idempotency key and request-content hash. Same key/same content returns the same result; changed content conflicts. Draft edits/posting compare the expected revision under a lock, so a stale confirmation cannot post a changed draft. A lost edit response can require a refresh.

**Why exact decimals and stored exchange rates?** Floating-point arithmetic is unsuitable for deciding whether money balances. Amounts use exact decimal handling; each base-currency line is rounded under the defined rule and totals must match. The transaction's rate is persisted. Reversals use the original amounts/rate, not today's exchange rate.

**Do anomalies require a live stream?** No. Historical posted entries already form a comparison dataset. A job can compare a new entry with prior similar entries. Daybook uses explainable duplicate, amount-history and category-pattern rules; synthetic unusual entries make their behavior demonstrable. A continuous bank feed would be another input source, not a prerequisite. No fraud-detection accuracy is claimed.

**Does categorization actually learn?** Confirmed corrections are stored by organization and retrieved with relevant history for later suggestions. That is retrieval-based adaptation, not retraining or fine-tuning. It can improve context, but a measured improvement still requires evaluation. Jev is being tested for reranking/review, not silently used for production categorization.

**What if a worker crashes after the entry posts?** The job is committed with the financial operation. A lease permits recovery and unique effect keys make reprocessing safe. That is at-least-once execution with idempotent effects, not exactly-once delivery.

**Why not microservices or a load balancer first?** A posting is one tightly coupled database transaction. Splitting it prematurely adds distributed failure modes. A load balancer distributes requests; it does not understand accounting, retrieve contracts or verify answers. The API and worker can be deployed separately when measured workloads justify it.

**Could a million people use it today?** No measured claim supports that. First define active users, requests per second, history size, tenant skew and acceptable latency; then load-test. A real service also needs identity/authorization, tested tenant isolation, backups and restore drills, observability, connection budgets, continuously serviced workers, and distributed rate/cost limits. The current in-process AI concurrency limit is not global across replicas.

**Did we build Docker Compose?** Yes. Application startup, health/container checks and posted-entry persistence have passed CI. Research has a separate pgvector Compose setup that exercises the actual Wren engine and database restrictions. Local Docker availability on the author's machine is a separate question from the checked-in runnable setup and cloud CI evidence.

**What would you do next?** Publish the completed evidence and refreshed submission, then design a separate, limited document-access experiment while preserving the narrow financial tools. Only that component cleared the declared rule; an intent router or combined architecture needs new measurement. Do not tune the completed holdout or replace its recorded failures. Product work still includes the full product-specific live evaluation, fresh visual/device checks, scheduler observation, reviewer access and real-service operational requirements.

## Explain hosting and the interface accurately

Daybook is the product name; Spiich is the assignment recipient. The simpler interface uses Home / Transactions / Reports / Settings. A beginner chooses money in, money out or transfer and reviews the account effects. Advanced journals remain available for more complex cases. The [design record](DESIGN.md) explains the decisions and verification limits. Browser workflow tests do not establish real-phone ergonomics or a fresh human visual review.

> “Docker and the hosted demo share accounting services. Vercel serves the React build and runs the Express API through a native ESM adapter. Neon stores the demo data. The runtime has a restricted database role; migration/setup uses separately held owner access. The same financial constraints apply.”

The configured daily scheduler catches up recurring drafts and processes bounded background jobs; successful mutations can also trigger a bounded analysis batch. Durable PostgreSQL jobs retain retry state. Successful authorized scheduler HTTP checks do not prove that automatic firing has been observed, or that this arrangement handles a production-sized backlog.

Vercel login protects one shared writable demo workspace. It is not application-user authentication or tenant authorization. The assignment did not require login, but reviewer sharing still needs deliberate handling. Do not disable protection or describe the demo as a public multi-user product.

A green build alone does not prove the hosted API can run. Earlier invocation and scheduler-adapter failures led to native-wrapper import tests and actual endpoint checks. Explain that lesson with the preserved evidence rather than saying the current app still has the original timeout-only state.

## Evidence worth showing

| Evidence                                                                                                                                                                                    | What you can claim                                                                                                                                                                         | What you cannot infer                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [Application CI for deployed executable 7ecb435c](https://github.com/rayidali/spiich_homework/actions/runs/41103851106)                                                                     | 103 backend tests, ten browser workflows, native hosted imports and Docker startup/persistence passed for that revision                                                                    | Complete live model accuracy or physical-device quality                        |
| [Latest frozen-study CI](https://github.com/rayidali/spiich_homework/actions/runs/41155033249) and [receipt](evidence/research-ci-v4.json)                                                  | Application verification, Compose and native Wren/pgvector jobs passed for the recorded source; live-AI job was skipped                                                                    | That CI executed the held-out provider experiment                              |
| [Frozen local checks](evidence/research-local-v4.json)                                                                                                                                      | 511 isolated TypeScript tests, 35 actual Wren Python tests, nine PDF-exporter tests, build and formatting passed; database-dependent suites were excluded locally and exercised through CI | Model answer accuracy, or independent human adjudication                       |
| [Hosted chat recovery evidence](evidence/chat-recovery-verification.json)                                                                                                                   | Selected cash/search/expense answers and a review-only proposal succeeded; numerical checks matched independent endpoints; failures remain recorded                                        | A full 40-case live evaluation or a guarantee of current availability          |
| [Hosting evidence](evidence/hosting-verification.json)                                                                                                                                      | Protected health/report/scheduler checks at the recorded snapshot                                                                                                                          | Observed automatic cron firing, capacity or current account balances           |
| [Held-out manifest](evidence/research-runs/holdout-v1/manifest.json), [freeze](evidence/research-verifiers/verifiers-v1/verifier-freeze.json), [research report](reports/research-study.md) | Completed synthetic measurements, unchanged fingerprints and declared component decisions                                                                                                  | Production accuracy, full prose faithfulness or an automatic deployment winner |

The historical architecture [PDF](reports/architecture-review.pdf) and [HTML walkthrough](reports/architecture-review.html#journeys) can help explain the original design, but record an earlier planning snapshot. Use the current [research narrative](reports/research-study.md) for implemented experiments, scope limits and complete measurements. Old invalid/incomplete pilots remain diagnostic; their graphs cannot select a winner.

The [main final audit](evidence/research-holdout-final-check.json) and [reviewer final audit](evidence/research-verifier-holdout-final-check.json) support completion and integrity, not independent human validation. The external cost exporter passed 41 local synthetic tests, TypeScript and formatting; cloud CI for that new tool remains pending. Do not combine overlapping historical test counts into a larger claim.

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
