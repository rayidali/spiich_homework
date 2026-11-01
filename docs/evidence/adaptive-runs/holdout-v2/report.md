# Adaptive chat: held-out results and separate review

**The frozen automatic result is a tie: 8/16 questions for each route.** Both routes answered the four common questions and handled the four clarification/off-topic questions. Each received zero automatic passes on the four discovery and four arithmetic questions. This does **not** mean every displayed number on those questions was wrong.

We separately read all 32 saved responses, their original questions, account/date/counterparty scopes and calculation traces. That internal AI review found **9/16 complete composable answers and 11/16 complete adaptive answers**. Four complete answers had been rejected by a table-layout assumption in the grader. These secondary observations do not replace the recorded scores or qualify the adaptive route for adoption under the primary decision rule. Keep the composable production default.

## What was compared

The composable route chooses checked database queries and calculations in its initial plan. The adaptive candidate can first inspect actual query results, then choose another query or calculation. Both use the same application accounting code, model and synthetic ledger. A query is a read-only question for the database; a journal is one recorded transaction, which can contain several lines.

This run completed **32 service executions, 43 real provider attempts and $0.2003728 in known-use estimates**, with no unknown reservations. Including the preserved development run, the same closed spending cohort totals **53 attempts and $0.2434251**. These are recorded usage estimates, not an invoice or an account balance. The independent execution audit passed **866/866 checks**; the synthetic account/journal fingerprint remained unchanged.

| Measure                                   | Composable |   Adaptive |
| ----------------------------------------- | ---------: | ---------: |
| Frozen primary complete answers           |       8/16 |       8/16 |
| Primary numerical questions               |       4/12 |       4/12 |
| Primary clarification/off-topic questions |        4/4 |        4/4 |
| Separate internal semantic completeness   |       9/16 |      11/16 |
| Actual provider attempts                  |         19 |         24 |
| Held-out known-use estimate               | $0.0921112 | $0.1082616 |
| Median service execution time             | 2,501.5 ms | 1,924.5 ms |

Timing includes the service wrapper. This small mix of different execution paths does not establish that the adaptive route is faster. There was one outcome per route/question, not repeated sampling. The primary paired difference is zero; its descriptive exact McNemar p-value is 1. Each route's separate Wilson interval is approximately 28%–72%, not an interval for their paired difference.

## A useful success: find a customer, then calculate

H08 asked which customer had the most June revenue, then requested that same customer's May and June cash movement and the change. Revenue and cash movement were deliberately different in the fixture.

The adaptive route first found **Ledger Labs: $3,300 June revenue**. It used the exact returned customer row to request complete cash totals: **$900 in May and $1,600 in June**. Its calculator then returned **$1,600 − $900 = +$700**. The answer and visible tables contain the requested identity, dates, cash amounts and formula. It did not substitute the $800 revenue change.

The automatic grader nevertheless reported `LEDGER_TABLE_LENGTH`: it assumed ledger tables would be last, while this response correctly placed the calculation table after them. The composable answer contained correct customer and cash tables but omitted the requested change. That is an incomplete answer, even though a reader could calculate it themselves.

## What failed and what the grader got wrong

| Case                                                                   | Composable: separate review                                              | Adaptive: separate review                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| H01–H04: category expense, cash movement, cash balance, native EUR     | All four complete                                                        | All four complete                                                          |
| H05: exact Acme supplier comparison                                    | Correct rows; missing −$203 change                                       | Extra escaping in compound row IDs; safely withheld                        |
| H06: largest software supplier comparison                              | Correct rows; missing +$50 change                                        | Exact supplier discovered, but malformed compound row IDs; safely withheld |
| H07: largest June category and change                                  | Correct Rent $970 and truthful overall $2,574.50; missing May and change | Correct Rent $970/$1,380; missing −$410 change                             |
| H08: leading revenue customer, then cash change                        | Correct tables; missing +$700 change                                     | Complete; grader table-order false-negative                                |
| H09: account/month cells plus supplies change                          | Four correct cells; missing +$134.50 change                              | Complete; grader table-count false-negative                                |
| H10: six cash closing balances plus bank change                        | Six correct balances; missing −$904.50 change                            | Same incomplete result                                                     |
| H11: hypothetical employee costs and reserve                           | Complete; grader table-count false-negative                              | Invalid operand field repeated after one schema repair; no answer          |
| H12: profits and signed change                                         | Invalid operand field repeated after one schema repair; no answer        | Complete; grader table-count false-negative                                |
| H13–H16: missing period, duplicate account, missing assumptions, pizza | All four appropriate clarification/refusal                               | All four appropriate clarification/refusal                                 |

For H09 adaptive, the evidence contains all four requested account/month cells and **$809.50 − $675 = +$134.50**. H12 adaptive shows **$1,690.50 − $1,825 = −$134.50** for posted profit. H11 composable quotes the original user assumptions, computes **$1,200/month × 3 months + $450 = $4,050**, then shows ending cash **$9,485.50** and reserve margin **−$514.50**. It labels the calculation hypothetical, not a forecast or hiring recommendation.

These three responses use `financial_scenario`. The grader skips ledger-table binding for that tool but then counts the ledger tables as calculation tables, causing `CALCULATION_TABLE_LENGTH`. The application tables and formulas themselves are correct. H09 and H12 adaptive used an ordinary initial scenario plan; their success is not evidence that an extra inspection round caused the improvement.

H07 composable's original `wrong-answer` classification is also misleading about money: the extra overall June expense total is independently true. The answer is still incomplete, so this review does not turn it into a pass.

Across the 32 reviewed responses, **no false displayed dollar amount or wrong displayed source/formula claim was found**. A separate Decimal recomputation verified all **83 returned typed ledger rows** against the frozen ledger, including additional rows, exact counterparty spellings, archived cash accounts and saved exchange rates. Narrow reports and the four successful calculations were checked separately. That observation concerns these saved synthetic responses only; it is not a guarantee about future questions, prose, or production data.

## What the result supports

The experiment exposed two different problems: the application sometimes returns only part of the requested answer or rejects malformed model references; the evaluation code sometimes rejects valid application table layouts. Both matter. Safe withholding avoids inventing an answer, but still fails an answerable task.

The primary adoption screen did not pass. The adaptive candidate remains opt-in and undeployed; the existing composable production route remains the default. A future change should preserve these failures, test table-to-fact binding across actual response layouts, improve exact row-reference usability and verify whole-question completeness before another separately versioned evaluation. No runtime change, model replay, budget reopening or score rewrite was made for this review.

The secondary reviewer was an AI coding agent that also authored the original scorer, **not an independent human reviewer**. The small, internally authored synthetic set and one trial per route do not establish universal accuracy, causal superiority, or production readiness. This was a direct service/PostgreSQL evaluation, not Express admission, hosted deployment or browser acceptance.

## Evidence

- [Frozen automatic results](automatic-results.json): all original v2 trial grades, paired aggregate, usage and fingerprints.
- [Separate semantic review](semantic-review.json): all 32 findings, independent arithmetic checks and explicit limitations.
- [Sanitized outcomes](outcomes.json): actual application answers, evidence, typed calls and synthetic inspection feedback; provider signatures and credential material omitted.
- [Provenance](provenance.json): original artifact, per-trial v1/v2 score, fixture and audit hashes.
- [Exact run](https://github.com/rayidali/spiich_homework/actions/runs/41258129206): source `84eb5de791b5490f141fb5690ad3ff3f61b3e361`, evaluator hash `1b6f4642c68019a8f20a85af6d4f2b6155c25ac9d0228ca40a51e8a350c926b7`.

The earlier [development evidence](../development-v1/report.md), frozen scoring protocol and older studies remain unchanged.
