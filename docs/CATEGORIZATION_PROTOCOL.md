# Focused categorization and correction-learning protocol

Version `daybook-category-learning-v3`, revised before held-out execution on 2026-10-31. **Two development adapter failures remain preserved in their original versions. V1 consumed one Gemini call; v2 consumed two Gemini and two Jev calls before halting.** V3 has no provider results yet, and no held-out provider request has been made. The completed nine-route study, its source, outcomes and closed budget remain unchanged.

## Reviewed v2 → v3 amendment

V2 halted when the adapter rejected Jev's rounded ancillary confidence metadata: reported confidence0.62 versus a formula-derived0.615 from a reported top probability0.65 across11 options. V3 removes that derived-equality requirement and accepts probability distributions within their reported decimal rounding intervals, while retaining range, exact option-key, selected-choice and structural checks. Confidence remains an uncalibrated signal and does not decide posting or change the financial reference. No prompt, case, reference label, order seed, model identity or allocation criterion changes.

Root closed v2 without changing its records. Its source hash is `4ae49bce1d51137581614b41b2248b9a5a7117f3740b75b195cc0d293ba498df`; closed ledger SHA256 is `3621759308e75c3ef66407828a334c3fbbc6cefdb646d174d722bec8e1b1c5eb`. Cumulative v1+v2 spending is **three Gemini attempts / $0.001095400000 and two Jev attempts / $0.000188076000**, with no unknown reservation in either predecessor. These remain development integration observations, not a comparison winner or replaced failed cells.

Exactly one further reviewed transition, `category-learning-20261031-v2` → `category-learning-20261031-v3`, is allowed under the same caps. Its receipt binds the new source/path, closed v2 ledger and artifacts, and `ancestorReceipt:{receiptPath,receiptSha256}` pointing to the original v1→v2 approval. The verifier rechecks that ancestor against v1's closed ledger/artifacts and unchanged keys, compares reconstructed v1 carry to v2's ledger, manifest and private configuration, then adds v2's own records **exactly once**. Verification permits only these two declared transitions, at maximum depth2; arbitrary nesting, skipped/repeated transitions, cycles, omitted ancestors, undercounting and duplicate carry are rejected. V3's opening carry contains the combined earlier totals and the ancestor summary; its own records and accuracy remain separate. No fresh allowance is created.

## Reviewed v1 → v2 amendment

The first Gemini call reported an estimated **$0.000257100000**; no Jev call or unknown reservation was recorded. Root explicitly closed the v1 ledger without changing its records. Its source hash is `24f54f82e5c958930bc8ff090ceb811e77582dd9bb7cd56c13057bc6a0d1dfdd`, and the closed ledger SHA256 is `1bafd168888662d80e59f12de91be03e1a915f34e7973260e89290542436d672`. Preserve every v1 outcome, original phase flags and closure receipt.

The v2 adapter accepts the documented additive Gemini billing fields while preserving strict decision validation. Pricing reconciliation accepts only standard-rate service tiers; unknown/nonstandard tiers retain the reservation and halt. Case text, labels, correction states, model prompts, model identities, selector scope, comparison criteria and original ordering seed remain unchanged. This was a development integration repair before any held-out request, not a change informed by held-out performance.

The **same cumulative $0.50 Gemini / $0.03 Jev and72 attempts per provider** apply across all three versions. The original finite v1→v2 receipt binds that transition's exact target ledger path/source, immutable closed predecessor/source/protocol/artifact hashes and unchanged key fingerprints, with recomputed totals. V3 recursively verifies this unchanged receipt as described above. Both v3 phases require `--carry-from=<v2→v3 receipt>` and `--carry-sha256=<exact SHA256>`. No empty carry, cap increase, automatic allowance reset or repeated carry is accepted. Receipts are outside the source manifest to avoid self-referential hashes; their hashes and carry summaries are frozen inside both phases' configuration and manifest.

Each new ledger stores predecessor totals separately from new reservation records, deducting old known costs, unknown reservations and every prior attempt before a new call. Revalidation occurs before reservations and accounting reports. V1 and v2 failures/costs remain visible; **earlier-version accuracy is never pooled into v3 accuracy**. Reports distinguish this split's costs, all v3 costs and cumulative v1+v2+v3 costs. Cost-per-correct comparisons use only the declared v3 split; earlier engineering overhead remains separately disclosed.

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

The v3 two-provider matrix has at most 144 selector slots. Given the fixed local gates, there are **57 actual model opportunities per provider: 15 development + 42 held-out**, or at most 114 new paid selector calls. Including the five retained predecessor calls, this plan can consume at most119 cumulative paid attempts:60 Gemini and59 Jev, within the unchanged72-per-provider ceilings. The rules/memory reference uses zero paid calls. A provider error consumes its attempt; it does not authorize a replacement within that version.

The authorized cumulative ceilings are **$0.50 Gemini and $0.03 Jev for selectors**, plus a separately tracked **$0.20 Gemini / 12-call** whole-entry acceptance allowance. The selector allowance was initialized for v1; both closed predecessor histories must be carried into v3. Before v3 execution, root must review the new source, approve the finite carry receipt and bind its hash, the unchanged keys, models and source to the new ledger. Pricing evidence is preserved. Never reopen or reset the completed architecture-study ledger or either closed category ledger.

The rates verified from official documentation on 2026-10-31 are Gemini 3.5 Flash-Lite at $0.30 per million input tokens and $2.50 per million output tokens including thinking, and Jev 1.14 at $0.042 per million input tokens with free output. Sources: [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and [TypeSafe models](https://docs.typesafe.ai/models). Reserve each call against its pinned requested model before dispatch, then verify the returned model before accepting reported usage. Unexpected usage/model metadata must preserve a conservative reservation and halt as the new runner's frozen policy requires.

Record actual provider attempts, reported token use, observed cost estimates, retained unknown-use reservations and request durations. Do not turn absent usage or latency into zero. Report all-attempt and successful-attempt timing separately, and separate local gate latency from provider-request latency. Cost per correct task must include failed attempts and reservations. Estimates/reservations are not invoices or verified credit balances.

The runner must preserve one immutable observation per planned case/selector, bind the exact visible-input hash and the shared prepared snapshot hash, and reject duplicate/unknown IDs. Missing observations remain explicit failures in completeness reporting. Failures must retain safe metadata without raw credentials or private requests. Interrupted/partial runs cannot select a winner.

The failure policy was fixed before v1 development and remains in force. An isolated HTTP 5xx response remains a failed cell and execution may continue to the next planned cell, retaining its unknown-use reservation when usage is absent. Two consecutive HTTP 5xx attempts for the same provider halt execution; a subsequent valid, usage-accounted provider response resets that provider's streak, while local gates and the other provider do not. Authentication, quota, model/response-contract mismatch, missing or inconsistent usage on a successful response, nonstandard or unknown billing tier, timeout, transport failure, budget or state corruption halt immediately. No failed cell is retried within a version. Ordinary resume cannot bypass a fatal halt; any operational continuation needs an explicit reviewed decision, preserving every prior outcome and reservation. A source change requires a separately reviewed version and budget treatment, never an automatic fresh allowance.

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

The integrated runner is `scripts/category-evaluation/run.ts`; the separate operator dispatcher is `dispatch.ts`. Budget, transport, carry-forward and report code have offline tests. The fixture contract test prepares all72 snapshots through the actual selector without a provider call. Closed v1 and v2 ledgers and their original development outcomes already exist, including both adapter failures and five total paid calls. V3 has no live ledger or outcomes at this pre-execution checkpoint; no held-out model request has been made.

After source review, required application checks and explicit carry approval, the operator uses `node --import tsx scripts/category-evaluation/run.ts --split=development --run=category-learning-20261031-v3 --mode=create --carry-from=APPROVAL_RECEIPT --carry-sha256=REVIEWED_RECEIPT_SHA256`, replacing both approval placeholders with the reviewed v2→v3 file and its exact hash. The runner loads current local keys without printing them and requires their fingerprints to match both predecessors. It creates an immutable source/configuration/plan manifest and a persistent ledger with verified combined opening carry under ignored `.tools/category-evaluation/category-learning-20261031-v3`. Holdout uses the same run and the same two carry flags with `--split=holdout --mode=resume`; it cannot create a fresh allowance.

The runner's queued HTTPS request must be claimed once through `dispatch.ts claim RUN_ID`, sent through an explicitly bounded operator curl tool call, and acknowledged through `dispatch.ts complete RUN_ID SLOT_ID EXIT_CODE HTTP_STATUS SECONDS`. The claim fixes the URL, private request/config paths, timeout and response-size bound. Do not follow redirects, retry a request or replay a claimed slot. Private raw requests, keys and responses stay outside publication. Phase reports distinguish provider network duration from queue/orchestration-inclusive duration; only sanitized results are eligible for publication.
