# Product chat query comparison

Version `daybook-chat-query-evaluation-v1`, prepared **2026-10-31**. **The controller, source-bound request factory, synthetic fixtures and offline tests are implemented. No provider call, measured route score or provider selection has occurred for this comparison. Disposable PostgreSQL replay verification is pending CI.** The user authorized broader financial answers, comparisons and abuse/off-topic boundaries. This is a new product evaluation, separate from the completed architecture/category studies and the 24-case ordinary-question repair matrix.

## Question and routes

Can a composable, typed ledger-query tool answer ordinary questions that the current authored report tools cannot express, while preserving accounting scope, exact arithmetic and access boundaries?

| Route                      | Configuration                                                                                                                                                                                                                                                                                           | What is held constant                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A — authored tools control | Current financial tools: expense summary, expense by account, income summary, period comparison, legacy revenue comparison, transaction text search and cash position; clarification remains available. No broad-query tool is exposed.                                                                 | Same provider/model, clock, underlying chart/workspace, user conversation, data snapshot, response budget and one planning attempt.           |
| B — composable typed query | The authored tools plus typed ledger analysis, native-currency measures, closing-balance series, structured clarification and bounded sourced arithmetic/scenario capabilities. The model selects a validated plan; application code compiles parameterized queries and constructs the answer/evidence. | Same constraints. Tool/schema/instruction and required chart-metadata differences are disclosed; this compares complete route configurations. |

Both use Gemini 3.5 Flash-Lite, pinned to its exact requested identity at execution freeze, with returned identity recorded. Both use the actual production request factory, LOW thinking and a 4,000-token output ceiling. The provider grammar omits only array maxima; original strict server schemas still enforce those limits. The authored route receives the production expense-only chart; the composable route receives all authorized account types and cash flags. Neither receives fixture balances or oracle labels. This is a **route-package comparison**, not evidence isolating the causal effect of a single tool. Temperature, thinking configuration and output cap must match. One model planning call per conversation is permitted. Arithmetic, scope validation and scoring are code-owned; there is no extra paid prose generator or model self-grading step.

A third reviewer route is **not included** initially. It would add cost and a second source of errors before demonstrating a concrete residual problem that deterministic validation cannot catch. Wren's actual engine was tested in the earlier, frozen study; it is not silently added to this product run. A future SQL/Wren or reviewer comparison would need its own version, justified cases, budget and preserved prior outcomes. The old study's finding is not evidence that a new product router has been tested.

## Broader capability and honest boundaries

The intended typed language composes a metric with period, exact account/counterparty filters, grouping, ordering, limits and explicit aggregate semantics. It must distinguish expense/revenue from full journal totals, entries from lines, cumulative balances from period movements, native from recorded base currency, and posted books from drafts. A model cannot supply SQL, a table name, an organization override or a posting action.

The initial query core had at most four queries, base-USD financial measures, explicit entry averages, account/counterparty/month/quarter/entry grouping and validated filters. Before any model call, implementation expanded to explicit native-currency measures, monthly/quarterly closing balances, sourced hypothetical arithmetic and recorded-data arithmetic with no user assumptions. Calendar-month denominators, when supported by the frozen implementation, must derive from an actual complete-month query range. Those capabilities remain subject to real execution and scope checks; their presence in a schema does not prove accuracy. Native-currency output, a longer series of month-end stocks and a bounded hypothetical calculation remain frozen coverage cases. An honest limitation is safer than a fabricated answer, but it does **not** complete an answerable task. Do not remove those cases, shrink their requested periods or relabel them as genuinely missing data to raise the candidate score. A general calculation or series capability may be developed on development examples before the held-out inference freeze.

## Fixtures and separation

Initial artifacts are private under `.tools/chat-query-evaluation/fixture-v1/`:

- `ledger.json`: product-schema organizations, accounts, journal headers and lines; no connection strings or provider credentials.
- `hand-calculated-oracle.json`: independently authored exact-decimal arithmetic and explanatory working. These are AI-authored references, not independent human accountant adjudication.
- `development/cases.json`: eight conversations and typed expected outcomes, available for implementation and prompt development.
- `holdout/cases.json`: twenty untouched conversations and typed expected outcomes. Implementation/planner authors must not inspect these before final inference freeze.
- `manifest.json`: file hashes, fixed clock, counts and data-admission boundary.
- `arithmetic-verification.json`: a separate Python Decimal verifier's evidence. It imports no product/research query compiler and proves neither SQL execution nor model quality.

The fixture has **23 journal records / 48 lines**: 21 posted entries and one draft for a synthetic primary workspace, plus a balanced foreign-workspace decoy. It includes an opening balance, invoices and collection, a payable and partial payment, several counterparties, a refund, a multi-expense-line journal, a reversal in a later month, and EUR native/base amounts at different recorded rates. The foreign decoy must never affect the primary answer. Empty periods and a nonexistent exact counterparty support genuine zero checks. The clock is **2026-07-15 in America/New_York**, independent of execution date.

The initial arithmetic verifier passed **366 structural/arithmetic checks and 43 typed facts**, without a database or provider call. This is fixture validation only. Every journal must also pass the actual product's schema/posting/reversal constraints in disposable PostgreSQL before these data can be used as execution evidence.

There are **8 development + 20 held-out conversations per route**, one attempt each: **56 planned model calls**. The held-out cases contain common reports, combined filters, grouped rankings, exact distinct counts, per-entry averages/thresholds, status handling, temporal reversals, balance stocks, currency, explicit scenarios, missing assumptions, in-domain food-vendor language and hostile cross-workspace/secret requests. Development includes an ordinary pizza-recipe off-topic request. Do not claim broad held-out off-topic accuracy from that one development example.

The same target data can support several questions, so these observations are correlated. Do not pretend that paraphrases or shared ledger facts are independent users. The implementation author may see the fixture data and development references, but must not inspect the held-out case file, the full fixture-builder source or the hand-calculated reference file before freeze; the latter two also contain held-out answer material. Hashing those files does not require opening them.

The separately frozen 24-case scope-repair matrix and any 21-case live subset are known regression material. Their observations are not independent held-out results in this comparison and are not pooled into its scores or budget.

## Exact expected outcomes

Each case contains a user conversation and a separate typed oracle. Only the conversation, authorized chart/schema identities and fixed clock reach the model. Case IDs, split labels, target values, capability labels, formula answers and failure rubrics must not enter a prompt.

For answerable cases the oracle specifies exact decimal/count values and their metric, units, date range/as-of, status, account/counterparty scope and row identity/grain. Ranked/series/list cases specify complete expected membership and order, not merely one correct value found somewhere in a response. Credits and reversals belong to their actual posting dates. A whole-journal count uses distinct entries; a per-entry expense average includes matching credit/refund entries and does not divide by line count. Native currency cannot be relabeled from a USD result.

For a fully specified hypothetical, the oracle records the required ledger starting fact, user-supplied assumptions and a deterministic calculation with exact units. The answer must state its hypothetical limits. An incomplete hiring question instead requires a useful missing-assumption question; cash alone cannot establish affordability.

Clarification/refusal/off-topic cases specify the behavior and relevant concepts, with no exact prose requirement. They must not trigger unauthorized queries or reveal secrets. Food words in a real bookkeeping question must not be rejected merely because a recipe request was off-topic. No account, amount, date or vendor may be invented to turn a vague question into an easy one.

## Two verification layers

1. **Planner meaning:** check that the chosen tool/typed plan preserves all requested metric, entity, date, grain, status, ranking and currency constraints. Equivalent supported plans are accepted. A correct number reached through a scope-dropping query still fails this layer.
2. **Execution and answer:** execute the exact recorded plan through the corresponding product handler against the frozen disposable PostgreSQL fixture. Compare returned typed facts/evidence with the independent oracle, including complete rows, units, scope and formula outputs. An HTTP 200, valid JSON, balanced fixture or plausible sentence alone does not pass.

Scoring is deterministic for structured facts and query semantics; no provider grades its own output. For free-form clarification/refusal wording, automatic checks can establish tool/no-query behavior and obvious required concepts, but uncertain meaning must be marked `needs_review`, not automatically awarded a pass. A separately logged, rubric-based human or internal AI review may adjudicate it; identify the reviewer type and do not call an internal AI review independent human evidence. Adjudication cannot change the reference answer, retry a model call or hide a scope failure.

Report at least:

- **Task completion** over every planned held-out conversation, with failures and missing results retained.
- **Exact financial answer success** over all answerable data/scenario cases. Safe unsupported responses are coverage misses here, not fabricated answers.
- **Common-capability subset**, fixed by case metadata before execution, alongside expanded-capability performance. More equipped tools must not be credited as universally better solely because the control never advertised those operations.
- **Scope violations**, wrong figures/units/grain, unsupported-but-honest responses, necessary and unnecessary clarifications, unsafe access/write/secret behavior, and provider/transport/schema errors separately.
- **Cost** as reported-use estimates plus retained unknown-use reservations, for setup, development and holdout separately and cumulatively. It is not an invoice or account balance.
- **Latency** for network/model time and deterministic execution separately. If plans execute later in CI, queue/CI delay is not interactive application latency.

With only twenty held-out conversations, report exact paired counts and disagreements, including examples. Any interval is exploratory and should respect repeated/shared scenario structure; do not present a production accuracy guarantee or a statistically decisive universal winner. The acceptance aim is useful new coverage with no observed common-task or boundary regression, not a post-hoc family router fitted to a few cases.

## Safe PostgreSQL execution

Seed only a disposable database created from the product migrations in CI, or a separately approved isolated evaluation database. **Never seed or alter the hosted demo's journal.** The seed must respect organization scoping, generated base columns, immutability and exact reversal checks. Generated `base_debit`/`base_credit` fixture values are expected verification results, not fields to insert directly into generated database columns.

CI needs no provider key. It can first verify known development plans and the fixture, then later execute source-bound recorded model plans. Use the server-owned primary organization, the restricted runtime role and read-only analytical transactions, repeatable-read snapshots, bounded queries/rows and statement timeouts. The runtime role itself also has application write privileges; this is not a claim that it is a database-wide read-only role. The model never receives those privileges or SQL execution access. Preserve the foreign decoy. Compare full account/header/line fingerprints before and after execution. A raw model SQL string, environment lookup, external URL or write statement must never become executable.

The root decides whether model planning and CI execution are staged separately. If so, bind every plan to the same source, data, query grammar, input hash and clock. Do not silently reinterpret a recorded plan through a changed compiler. Preserve actual execution failures rather than replacing them with the hand-calculated answer. Missing executor support is a failed/incomplete case, not successful fixture arithmetic.

## Call and cost limits

The root approved **two routes**, **56 primary calls**, and **at most four fixed setup probes**: a hard ceiling of **60 provider requests and $0.50 total additional tracked cost**, shared across setup, development, holdout and unknown-use reservations. These are new limits; all prior study/category budgets remain closed. No paid reviewer, automatic retry, unrecorded warm-up, model rotation or fresh allowance is authorized by this plan.

The root must install and verify a persistent source-bound budget before execution. Each request reserves a conservative cost before dispatch, using the pinned model/rate and maximum output/thinking budget. Settle using verified returned identity and usage, including thinking tokens; absent or untrusted usage retains the reservation. The hard cap takes precedence over finishing all cases. Stop and report an incomplete run if the remaining allowance cannot cover the next slot.

Use the same bounded configuration for both routes. Exactly **one** setup body is now declared: P01, composable route, “What is our cash and bank book balance as of June 30, 2026?” using the frozen fixture chart and clock. Its purpose is to verify acceptance of the complete production function grammar before development. The other three possible setup slots remain unused and cannot become ad-hoc probes or extra trials. P01 is setup evidence, not a scored held-out question. Development results may guide offline source fixes, but each planned development slot is still single-use. Any source change is recorded, and development observations from earlier revisions are not described as final-revision measurements. Freeze the final inference source before any held-out call. No source/prompt/reference change is permitted in response to held-out results within this version.

## Explicit queued transport contract

This environment permits explicit approved `curl` dispatch while Node subprocess networking can fail. The root owns a **new run directory and new budget**; reuse reviewed transport patterns, not old queues or closed ledgers.

The runner hands an injected transport a single allowlisted HTTPS endpoint, POST body, private headers, abort signal, absolute deadline, response-byte cap and immutable `run/route/case/attempt` ID. Before queueing, reserve the budget and create a private request directory/files with exclusive creation. `pending.json` contains only dispatch metadata and points to the private body/auth files. The dispatcher atomically claims once, checks the deadline and exact target, and uses an ordinary approved `curl -fsSL` invocation with private static configuration/paths. Do not use shell process substitution for live HTTPS or print headers/keys/payloads.

Completion is written atomically only after curl finishes, with `dispatched`, exit code, HTTP status and measured network duration. The runner reads the bounded response, verifies provider/model/usage and settles the same reservation before grading the payload. Local rejection, timeout, HTTP failure or malformed output cannot silently become zero cost or an unclaimed retry. Preserve claim/completion/body hashes and timing privately; public evidence contains only sanitized metadata. Separate network time from orchestration wait, and disclose that pre-tool validation does not prove exact actual network-start timing.

`scripts/category-evaluation/transport.ts` and `dispatch.ts` provide a reviewed local pattern. A new adapter must bind this run's source/model/limits rather than import the category budget object or implicitly reopen its run. The parent will implement and review the transport/budget separately; this document does not implement it or authorize dispatch by itself.

## Ordered execution and freeze

1. Review fixture arithmetic, schema compatibility, scope definitions and the development cases without opening held-out labels in implementation agents.
2. Verify product query execution and isolation in disposable PostgreSQL CI; develop with the eight public-to-implementers development cases and existing regression tests.
3. Install the separate budget and freeze setup bodies/configuration. If needed, run only the predefined setup probes.
4. Run each development case once per route, preserving all outcomes. Offline fixes may follow; record changed revisions and do not overwrite earlier outcomes.
5. Freeze the exact final source, route prompts/tool schemas, question/data/oracle hashes, model configuration, prices, scoring rules and fixed paired execution order. Use a seeded order, with route order balanced across cases, to reduce temporal confounding.
6. Run the untouched twenty cases once per route. Stop on a fatal authorization, quota, timeout/transport, response-contract, usage-integrity or budget/state failure; never retry that cell. A single HTTP5xx may remain a failed cell and execution continue; two consecutive provider5xx responses halt. No failure opens extra call slots.
7. Execute and score the recorded plans against the unchanged fixture, reconcile all costs and fingerprints, then write the comparison. Publish exact limitations, retained failures and common-capability results before claiming broader product improvement.

No architecture selection or deployment follows automatically from a higher score. The product must also pass its real API/UI/review workflow checks and have truthful limits for data it does not contain.

## Implemented operator interface (no network calls from Node)

The new source lives in `scripts/chat-evaluation/`; it does not import the old study or category ledgers. Run `node --import tsx scripts/chat-evaluation/cli.ts --help` for the exact interface. Initialization reads the locally saved Gemini key without printing it and creates a new private run directory. It hashes the protocol, fixture data, both case files, independent hand-calculated oracle and key; it does not put labels in prompts.

1. `init RUN_ID FIXTURE_DIR` creates the fresh ledger once; it refuses an existing directory.
2. `prepare RUN_ID setup composable P01` reserves its possible cost and creates the key-free request. `claim RUN_ID ATTEMPT_ID` checks exact regenerated request bytes, source, fixture and target, then returns the private static curl-config path. It refuses implicit curl defaults, redirects and repeat claims.
3. The operator executes the returned **ordinary `curl -fsSL --no-fail --config …` command exactly once**, saves its complete `CHAT_HTTP_DONE_V1` footer privately, then invokes `complete RUN_ID ATTEMPT_ID FOOTER_FILE CURL_EXIT`. `--no-fail` preserves bounded error bodies in the private response file; HTTP status still determines failure even when curl exits zero. Raw error bodies are never emitted in logs or public results. Node itself never dispatches requests. A repeated claim/completion fails.
4. Consume each of the eight development conversations once per route. Order alternates authored/composable within each conversation to reduce systematic timing differences. The same case slot cannot be retried after a failure. Preserve any source revisions between development observations.
5. `freeze RUN_ID` requires all sixteen development slots consumed, no pending work and no budget halt. It pins the final source once. Then consume the twenty held-out conversations once per route, again alternating route order. No tuning follows held-out outcomes.
6. `export RUN_ID development|holdout` creates a private source-bound replay bundle. Held-out export requires all forty held-out slots consumed. Development exports identify earlier-revision records rather than pooling them into the latest source. Copy a reviewed synthetic bundle into CI only after the appropriate freeze.
7. `replay BUNDLE_FILE OUTPUT_FILE` accepts only GitHub Actions' disposable local Postgres service, loads fresh isolated organizations through real posting constraints, executes recorded product plans and checks full before/after fingerprints. It makes no model calls. `close RUN_ID` closes the budget without resetting any reservation.

The ledger enforces one outstanding request, distinct one-use slots, phase limits and the shared maximum $0.50/60 attempts. The reservation uses request UTF-8 byte size plus framing allowance and the actual output-token cap at pinned prices. This is conservative accounting, **not a billing guarantee**. Reported thinking tokens are charged. Unknown use halts at the ledger level and remains reserved across restarts; there is no automatic reset/recovery. Auth/quota failures and scientific-state drift also halt. Corrupt ledgers and stale lock files are retained rather than overwritten or automatically unlocked.

The static-config approach has an explicit operational limit: pre-tool validation cannot prevent scheduler delay before actual curl begins, and a trusted operator could manually rerun a saved config. The controller prevents a second claim, not arbitrary execution outside it. The operator must honor the dispatch-once rule and retain the complete footer; no unverified actual-start timing claim is made.

Initial local verification: 38 offline tests passed for budgets, request/usage parsing, request regeneration, transport admission and scope scoring. One actual PostgreSQL development replay test is included and skipped outside disposable GitHub Actions. This is harness evidence only; it is not measured model quality. The public test fixture contains development cases and ledger data, never untouched held-out questions or labels. Formula checks compare symbolic operand structure, proven query scope and user-source assumptions, accepting equivalent distributive arithmetic without interpreting generated IDs. Free-text clarification and scenario-formula meaning that cannot be established mechanically remain `needs_review` until a separately logged rubric review; they are not automatic successes.
