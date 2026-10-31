# Two worked examples from the completed main holdout

These are illustrative traces selected after the complete main run, not a new prevalence estimate or independent human adjudication. They do not change scores, prompts or validation. Only completed main artifacts and the frozen reference/validator source were inspected; no partial reviewer outcomes were used. Sources are the [raw episodes](../evidence/research-runs/holdout-v1/episodes.jsonl), [scores](../evidence/research-runs/holdout-v1/results.json), [retrieval supplement](../evidence/research-runs/holdout-v1/supplemental/retrieval-and-failures.json), and [reference implementation](../../research/reference.ts). Read these examples alongside the [complete study report](research-study.md).

## 1. The narrow cash tool answers; a broader route computes the same number but withholds it

**Matched IDs:** `holdout-v1:R0:financial-06-2:0` and `holdout-v1:R3:financial-06-2:0`. Same question and repeat, within the predefined common-capability subgroup.

**Question:** “Show the total booked USD value of both bank accounts at the end of October, ignoring November receipts.”

The frozen reference requires `cash_balance = 174450.00 USD`, `asOf = 2026-10-31`, with ledger evidence. No document or assumption tag is required for this task.

| Step                   | R0: current-tool control                                                         | R3: managed File Search route                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Selected operation     | `cash_position`, as of `2026-10-31`                                              | `account_balance` query, grouped by account, restricted to accounts `1000` and `1010` through `2026-10-31`; also requested documents |
| Actual ledger values   | Total `174450.00`; Operating bank `173570.00`; Euro bank carrying value `880.00` | Operating bank `173570.00`; Euro bank carrying value `880.00`                                                                        |
| Proposed total         | Direct ledger total `174450.00 USD`                                              | Server-checked sum `173570.00 + 880.00 = 174450.00 USD`                                                                              |
| Claimed total identity | No per-account entity attached to the total                                      | `entity = "Operating bank and Euro bank"`                                                                                            |
| Validation             | `valid: true`, no reasons                                                        | `valid: false`, `"UNSUPPORTED_CALCULATION_SCOPE"`                                                                                    |
| Released result        | `ANSWER`, correct dated total                                                    | `BLOCK`: “This answer needs review before it can be released.”                                                                       |
| Recorded score         | Structured success; 90/90 automated                                              | Structured failure; 0/90 automated                                                                                                   |

**What the records directly show.** R3 had the correct two balances, calculated the correct total and proposed a short summary with that correct amount. Its `validation.calculations["calc:total_bank_oct"]` is exactly `174450.00 USD`. The failure was not a missing document or wrong sum. Its candidate cites `query:bank_balances_oct` through `calc:total_bank_oct`; the final released blocked answer has no facts. The scorer therefore records missing facts and ledger provenance for the **released answer**, not evidence that the earlier query failed.

**Mechanism supported by the frozen code.** `research/scope.ts` requires a calculated claim's entity to match each contributing ledger ancestor's proved identity. Here, the two ancestors carry separate account identities (`1000`/`Operating bank` and `1010`/`Euro bank`). The model's combined string matches neither account identity. The validator does not represent this cross-account aggregate identity, so it withholds the answer. R0 obtains an already aggregated, entity-free total from its narrow tool and avoids that contract failure.

**Interpretation and limit.** This is a concrete conservative-withholding limitation: correct arithmetic alone does not satisfy the current scope contract. It supports explaining why a larger tool/retrieval pipeline can regress on an existing simple capability. It does not justify relaxing scope checks indiscriminately, and it does not establish that document retrieval caused the failure. No counterfactual rerun or repair was tested. The candidate's complete prose was not independently adjudicated.

## 2. Retrieval and arithmetic succeed, but the scenario's structured contract still fails

**Episode:** `holdout-v1:R5:scenario-07-1:0` (custom hybrid retrieval with Jev reranking).

**Question:** “Estimate no-new-revenue runway in months using October 31 cash, the reserve policy and October posted total expenses as a constant monthly cash outflow proxy. Ignore timing differences and other obligations; state that this is a simplified assumption, not a cash forecast.”

The frozen reference expects an `ANSWER` with `runway = 6.78 months`, ledger evidence and document `reserve-policy`. Required tags are `ZERO_FUTURE_RECEIPTS`, `EXPENSES_AS_CASH_PROXY` and `NO_FORECAST_GUARANTEE`.

The actual evidence supports this calculation:

| Input or calculation   | Recorded value and provenance                                                           |
| ---------------------- | --------------------------------------------------------------------------------------- |
| October 31 cash        | `174450.00 USD`, `query:cash_oct`; unbounded prior history through `2026-10-31`         |
| Minimum reserve        | `50000.00 USD`, retrieved `reserve-policy`                                              |
| October expenses       | `18365.00 USD`, `query:expenses_oct`, `2026-10-01` through `2026-10-31`                 |
| Cash above the reserve | `174450.00 − 50000.00 = 124450.00 USD`, server-checked `calc:available_cash`            |
| Simplified runway      | `124450.00 ÷ 18365.00 = 6.78 months` to two decimals, server-checked `calc:runway_calc` |

`reserve-policy` is first in the recorded retrieved-ID list. The supplement marks retrieval completed with no missing required source. This is not a failure to find the reserve document.

**The candidate contains the correct headline answer.** Its summary states cash of $174,450, a $50,000 reserve, available cash of $124,450, monthly expense proxy of $18,365 and approximately 6.78 months. Both calculation results are recorded as valid values. It also states that this is simplified planning, not a cash forecast.

**Two deterministic reasons still prevent release:** `"LEDGER_METRIC_REQUIRES_LEDGER"` and `"UNSUPPORTED_CALCULATION_SCOPE"`.

1. An additional structured fact is labeled `remaining_buffer = 50000.00 USD` but cites only `reserve-policy`. That amount is the policy's **minimum reserve**, not the computed $124,450 remaining cash buffer. The frozen validator treats `remaining_buffer` as a ledger-derived metric and requires ledger ancestry. The correct headline runway does not repair this extra fact's misleading metric label or missing ledger provenance.
2. The calculated `runway` fact claims both `from = 2026-10-31` and `asOf = 2026-10-31`, with `to = null`. Its cash ancestor proves an as-of balance but no `from` date; its expense ancestor proves the October 1–31 interval but no stock-style `asOf`. That combination does not match a proved source period under the frozen scope rules, and the interval-union path requires a complete `from`/`to` interval without `asOf`. The recorded scope rejection is consistent with this qualifier mismatch. This does not mean the division itself was wrong.

The candidate also lacks the required `ZERO_FUTURE_RECEIPTS` tag, despite its summary's “no-new-revenue” wording. It includes `EXPENSES_AS_CASH_PROXY` and `NO_FORECAST_GUARANTEE`. Tag compliance is a structured protocol check, not proof that the natural-language explanation omitted that concept. This missing tag is a separate reference-contract issue, not one of the two recorded deterministic release reasons.

**Released outcome:** `BLOCK`, with the same review-needed summary and empty facts/evidence/tags; structured failure, 0/90 automated. The final scorer consequently lists `missing_document_evidence` for `reserve-policy` and all three required tags as missing. Those labels describe the stripped **released answer**. They must not be paraphrased as “retrieval missed the policy” or “the candidate omitted every assumption.” The raw candidate and retrieval trace show otherwise.

**Interpretation and limit.** A document retriever, reranker and exact calculator can all supply useful pieces while the complete answer still violates output semantics or conservative scope checks. This example combines a misleading extra metric with a scope-contract limitation and one missing tag; it should not be described as an otherwise fully correct answer rejected for no reason. It does not establish how often Jev helps or hurts, and no independent reviewer judged its prose.

## Reproduction without provider calls

Read the exact episode IDs above from the completed `episodes.jsonl`, comparing `answer` (released output), `candidateAnswer` where retained, `validation.answer`, `validation.reasons`, `validation.calculations`, `queries` and `retrievedIds`. Match each ID to `results.json.scores`. Obtain the frozen expected facts with `getReference('financial-06-2')` and `getReference('scenario-07-1')`; these labels are used only after evaluation here. The full main episode-file SHA-256 is `23a81919b83fec491d728d5abe6660389c7446d5808db805246c799f08d8b51e`, and result-file SHA-256 is `eeb43bbad42e974dcb3c6fbc030f314304be49130b475313d8e785613da1ee29`.

Publishing this explanation does not change the frozen implementation, reference, protocol, cost record or scored outcome.
