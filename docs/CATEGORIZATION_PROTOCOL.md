# Focused categorization and correction-learning protocol

Version `daybook-category-learning-v1`, prepared 2026-10-31. **Implemented selectors, fixtures, scoring and bounded runner; no provider execution or measured model result yet.** This is a new product evaluation. The completed nine-route study, its source, outcomes and closed budget remain unchanged.

## The question

Given the same transaction facts, accounts and trustworthy prior examples, does Gemini or Jev choose better categories? Do reviewed corrections help similar future purchases without teaching the wrong rule for every purchase from that vendor?

For example, Office supplies and Printing expense can both reasonably describe printer paper. Before the business teaches its preference, choosing Supplies is not an error. After repeated reviewed paper purchases teach Printing, we measure whether the selector follows that preference. A later laptop from the same seller still requires equipment accounting; it must not inherit the paper category.

## What is being compared

Two paid selectors—Gemini and Jev—and a deterministic rules/memory reference receive one identical server-prepared snapshot. The candidate APIs are `prepareCategorySnapshot(facts, trustedContext)` and `selectCategory(snapshot, options)`. Inputs include validated amount, direction, date, currency, recorded rate, funding account, current purpose/structure where known, active chart and eligible examples. Only `{facts, context}` from a fixture goes into snapshot preparation. Fixture names, splits, reference labels and excluded-record audit metadata never enter a model request.

The selector chooses an expense account for money out or a revenue account for money in. It can instead ask for clarification or hand off an unsupported event. It does not choose amounts, funding accounts, dates, rates or posting authority. Invoice settlement, refunds, asset purchases, loans, transfers and complex splits require full journal review. Correctly recognizing this boundary is useful, but a handoff is not a completed journal.

The existing whole-entry Gemini assistant remains the separate complex-entry control. At most 12 separately reserved acceptance calls may check its actual conversation/entry workflow. Those calls are not a fair selector accuracy comparison: they perform extraction and whole-journal work that the narrow selectors do not. They must have their own frozen prompts, expected behavior, usage and results.

No document retrieval, vector indexing, new database service or extra reviewer is part of this comparison. The category selector module must remain separate from the frozen research harness.

## Fixtures and partitions

There are 24 synthetic scenario sequences across six families. Each family has one development sequence and three held-out sequences: six development and 18 held-out groups. Each sequence has the same target transaction at zero, one and three earlier reviewed correction events, producing 72 inputs. All states of a sequence stay in one split. Each input is evaluated once per selector, without automatic retries or selecting a favorable repeat.

| Family                                            | Development inputs / selector opportunities / category targets | Held-out inputs / selector opportunities / category targets |
| ------------------------------------------------- | -------------------------------------------------------------: | ----------------------------------------------------------: |
| Repeated vendor and taught preference             |                                                      3 / 3 / 3 |                                                   9 / 9 / 9 |
| Unseen merchant                                   |                                                      3 / 3 / 3 |                                                   9 / 9 / 9 |
| Same vendor, different purchase purpose           |                                                      3 / 3 / 0 |                                                   9 / 9 / 6 |
| Invoice, loan, refund and transfer meaning        |                                                      3 / 3 / 0 |                                                   9 / 3 / 0 |
| Missing purpose, funding, currency or rate        |                                                      3 / 0 / 0 |                                                   9 / 3 / 0 |
| Conflicting, stale, foreign or malicious examples |                                                      3 / 3 / 3 |                                                   9 / 9 / 9 |
| **Total per selector**                            |                                                **18 / 15 / 9** |                                            **54 / 42 / 33** |

The held-out model decision set therefore has 42 opportunities: 33 actual account selections, six semantic handoffs and three purpose clarifications. Twelve additional held-out inputs stop at deterministic gates and must not inflate model accuracy. The 33 category targets represent **11 distinct sequences**, not 33 independent examples. The 42 opportunities represent 14 sequences. The complete workflow set has 18 held-out sequences.

The known friend/party wording is development-only. The already observed missing-payment-account rent failure is a separate, zero-call development regression outside the comparison matrix. Neither can be presented as newly held-out evidence. The friend case checks the first missing funding question; business/personal meaning remains unresolved for a later conversational turn.

The fictional chart includes ordinary Supplies and Software accounts plus legitimate custom Printing and Cloud software accounts. It also includes an archived account and an income case. The fixture source contains no production transactions, API keys or old study outputs. Reference labels are AI-assisted synthetic annotations, not independently adjudicated accountant judgments.

## How correction history is controlled

Both paid selectors and the offline reference receive the same reference-confirmed earlier events, never their own unreviewed predictions. Current-case answers and future corrections are excluded. These are counterfactual snapshots of the same target transaction at increasing available history, not a claim that three identical real transactions happened simultaneously.

Zero/one/three denotes prior review events, not necessarily the number of currently eligible examples. After supersession, reversal or account archival, three events may leave one usable correction. Report the event count, eligible repository records and the actual examples retained in the prepared selector state. Do not silently call all three “three-shot learning.”

Fixtures explicitly model same-context supersession, archived-account examples, a reversed entry and foreign-workspace noise. An allowlisted fixture projection removes ineligible records before snapshot preparation, matching the repaired repository boundary. This tests shared-input discipline and the model's use of valid context; **it does not independently test production database isolation or prove that a model detects foreign records**. Real PostgreSQL correction-memory tests and the browser save→later-post→forget workflow provide that separate implementation evidence.

Descriptions and merchant names may contain quoted malicious instructions. They remain data. Prior purchases never establish a missing current funding account or current business/personal purpose. Same vendor does not imply same purchase meaning. Only relevant active reviewed examples can teach a preference; unrelated history is not a global business rule.

## Scores and denominators

There is no weighted grand score that hides these distinctions:

1. **Semantic category correctness:** did the selected active account reasonably fit the current event? Multiple defensible categories are accepted where stated in the reference.
2. **Taught preference agreement:** after relevant evidence exists, did the selector follow the active business preference? Before teaching this is not applicable, not a failure.
3. **Selector decision success:** correct category including an applicable preference, correct necessary clarification, or correct semantic handoff, across the 42 held-out model opportunities. Failures and missing attempts remain in the denominator. Report account-selection targets separately from clarification/handoff targets.
4. **Workflow handling:** correct routing across all 54 held-out inputs, including local gates. Show gated cases separately and do not attribute their correctness to either provider.
5. **Complete journal correctness:** only when an actual deterministic builder's output is supplied, check category, taught preference, counteraccount/direction, exact amount/rate/date and complete line multiset. Without builder output it is **not measured**. Balance guaranteed by shared code is not model strength. The scorer never invents a journal from a category result and calls it tested.
6. **Coverage and failures:** suggestions per all inputs, unnecessary clarifications/handoffs, required questions missed, unsupported events incorrectly suggested, provider/harness errors and incomplete attempts.

The scorer distinguishes a correct category with a broken journal builder from an incorrect model choice. It also rejects an entry created during clarification or any claimed posting. A correct handoff has no completed journal score.

For learning, pair state 0 with state 3 within each sequence. Report change in handling success and semantic correctness. Separately report adoption of the final taught preference before versus after teaching. A reasonable generic category before teaching is still semantically correct; adoption gain is not a retroactive error label. Report stage 1 too, and show same-vendor changed-purpose regressions separately. There are only five held-out preference-teaching sequences; do not generalize their learning rate to all vendors.

## Cost, latency and execution integrity

The planned two-provider matrix has at most 144 selector slots. Given the fixed local gates, there are **57 actual model opportunities per provider: 15 development + 42 held-out**, or at most 114 paid selector calls. The rules/memory reference uses zero paid calls. A provider error consumes its attempt; it does not authorize a replacement.

Proposed new persistent additional ceilings are **$0.50 Gemini and $0.03 Jev for selectors**, plus a separately tracked **$0.20 Gemini / 12-call** whole-entry acceptance allowance. These are ceilings, not permission for this fixture/scorer package to make calls. Before any execution, root must install and test a new immutable budget record, bind the current key/model/source, and archive current pricing evidence. Never reopen or reset the old research ledger.

The rates verified from official documentation on 2026-10-31 are Gemini 3.5 Flash-Lite at $0.30 per million input tokens and $2.50 per million output tokens including thinking, and Jev 1.14 at $0.042 per million input tokens with free output. Sources: [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and [TypeSafe models](https://docs.typesafe.ai/models). Reserve each call against its pinned requested model before dispatch, then verify the returned model before accepting reported usage. Unexpected usage/model metadata must preserve a conservative reservation and halt as the new runner's frozen policy requires.

Record actual provider attempts, reported token use, observed cost estimates, retained unknown-use reservations and request durations. Do not turn absent usage or latency into zero. Report all-attempt and successful-attempt timing separately, and separate local gate latency from provider-request latency. Cost per correct task must include failed attempts and reservations. Estimates/reservations are not invoices or verified credit balances.

The runner must preserve one immutable observation per planned case/selector, bind the exact visible-input hash and the shared prepared snapshot hash, and reject duplicate/unknown IDs. Missing observations remain explicit failures in completeness reporting. Failures must retain safe metadata without raw credentials or private requests. Interrupted/partial runs cannot select a winner.

The failure policy is fixed before any paid development calls. An isolated HTTP 5xx response remains a failed cell and execution may continue to the next planned cell, retaining its unknown-use reservation when usage is absent. Two consecutive HTTP 5xx attempts for the same provider halt execution; a subsequent valid, usage-accounted provider response resets that provider's streak, while local gates and the other provider do not. Authentication, quota, model/response-contract mismatch, missing or inconsistent usage on a successful response, timeout, transport failure, budget or state corruption halt immediately. No failed cell is retried. Ordinary resume cannot bypass a fatal halt; any operational continuation needs an explicit reviewed decision, preserving every prior outcome and reservation. A source change requires a separately reviewed version and budget treatment, never an automatic fresh allowance.

One run ID and ledger cover both phases. Create starts development; holdout requires resume after development completes with the same source, keys, configuration and planned inputs. The budget remains open between phases and closes after a complete valid holdout. Per-slot files and their hash chain remain immutable; phase summaries are replaceable snapshots. A crash after a slot starts produces a retained interrupted error rather than a replay. Clearing the dispatcher's ephemeral phase-finished marker on resume does not erase any outcomes or costs.

## Freeze and decision rule

Before paid held-out execution, review and freeze this protocol, source, all fixture/reference/scoring bytes, provider prompts, model IDs, field contracts, budget/call ceilings, run order and outputs. Develop only on the six development groups and known regressions. Store a manifest outside its own hashed content. No thresholds, cases, references or successful-attempt filters may change in response to held-out results. Any later fix starts a new explicitly versioned comparison; old failures stay intact.

Raw model confidence is an uncalibrated signal, not an accuracy guarantee. This version uses the selector's complete decision contract; it does not import the unrelated old reviewer threshold of 0.8. If a confidence cutoff is added during development, its value and calibration rule require a protocol amendment before holdout.

Report paired differences with the fixed scenario sequence as the resampling unit: all three states move together. Use 2,000 bootstrap resamples, seed 20261031, and the 2.5th/97.5th percentiles. Report the actual subgroup group count. Intervals are exploratory and unadjusted; multiple family/learning analyses are secondary. Model outputs at three states are correlated, and a small synthetic sample does not support production error-rate guarantees.

Allocation rule accepted on 2026-10-31, before the execution freeze: Jev is a candidate to replace Gemini within this selector's scope only if its held-out category-and-preference success improves by at least 10 percentage points with a paired interval above zero, or its paired lower bound stays above −5 points while tracked cost per correct category task falls by at least 30%. It must introduce no observed unsafe-selection/entry/posting regression, no loss of appropriate clarification, and pass real integration tests. Otherwise retain Gemini for this selector comparison and report the evidence as insufficient to adopt Jev. A new short-form entry feature may use the Gemini baseline without claiming that this experiment proves an improvement to the entire natural-language entry system. Do not add automatic model routing or build a post-hoc family router from these few examples and claim that router was measured.

The likely responsibilities remain explicit: a language model extracts or clarifies the user's meaning; the measured selector proposes a category where its scope applies; deterministic accounting code owns exact facts and journal validity; the user confirms posting. Jev is adopted only where the evidence supports it. This evaluation makes no claim of perfect accuracy, independent human adjudication, live bank-import performance or million-user capacity.

## Offline implementation

- Public inputs and sequence builder: `scripts/category-evaluation/fixtures.ts`.
- Shared evaluation types: `scripts/category-evaluation/types.ts`.
- Separate gold references: `scripts/category-evaluation/references.ts`.
- Scorer, matrix completeness, paired learning, costs and intervals: `scripts/category-evaluation/scoring.ts`.
- Offline checks: `npx vitest run tests/category-evaluation.test.ts` and `npm run typecheck`.

The integrated runner is `scripts/category-evaluation/run.ts`; the separate operator dispatcher is `dispatch.ts`. Budget, transport and report code have offline tests. The fixture contract test prepares all 72 snapshots through the actual selector without making a provider call. No live ledger or measured result exists at this preparation checkpoint.

After source review and the required application checks, the operator creates one new run with `node --import tsx scripts/category-evaluation/run.ts --split=development --run=RUN_ID --mode=create`. The runner loads the current local keys without printing them and creates an immutable source/configuration/plan manifest plus a persistent budget under ignored `.tools/category-evaluation/RUN_ID`. Holdout uses the same run with `--split=holdout --mode=resume`; it cannot create a fresh allowance.

The runner's queued HTTPS request must be claimed once through `dispatch.ts claim RUN_ID`, sent through an explicitly bounded operator curl tool call, and acknowledged through `dispatch.ts complete RUN_ID SLOT_ID EXIT_CODE HTTP_STATUS SECONDS`. The claim fixes the URL, private request/config paths, timeout and response-size bound. Do not follow redirects, retry a request or replay a claimed slot. Private raw requests, keys and responses stay outside publication. Phase reports distinguish provider network duration from queue/orchestration-inclusive duration; only sanitized results are eligible for publication.
