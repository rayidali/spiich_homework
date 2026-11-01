# Adaptive chat: first development results

**The automatic score was 2/4 for both routes. A separate internal AI review found that the composable route correctly answered one question the scorer rejected.** That review gives 3/4 complete answers for composable and 2/4 for adaptive. These are four development questions, not held-out accuracy or evidence of a general winner. The original scores are preserved.

Composable chooses a plan before reading the database. Adaptive can inspect results and then choose another query or calculation. Both use the same trusted query compiler and exact arithmetic rules.

| Question                                                          | Composable result                                                          | Adaptive result                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| May software spending                                             | Correct: $210                                                              | Correct: $210                                            |
| Largest May cash decrease, then that counterparty's June change   | True amounts, but missing the signed change                                | Correct identity discovered; calculation safely withheld |
| Supplies, marketing and their combined May total                  | Correct: $675, $80 and $755; scorer rejected the equivalent combined query | Correct separate amounts; missing $755 combined total    |
| How a mixed journal's expenses were divided between bank and card | Correctly explains that the books do not contain that allocation           | Same correct refusal                                     |

No wrong dollar amount or hard-boundary violation was observed in these eight retained responses. This does not mean every response answered its question completely.

## What the failures taught us

**The scorer was too strict about one valid method.** For supplies plus marketing, composable asked the database for each category and for both categories together. The accounts are disjoint, and every date, currency and posting-status filter is identical: $675 + $80 = $755. The scorer expected a separate calculation object, so it incorrectly classified the valid combined query as an extra financial claim. This is a confirmed representation false-negative; the raw `wrong-answer` label remains unchanged in [automatic results](automatic-results.json). The separate [semantic review](semantic-review.json) records the equivalence proof.

**Adaptive found the right counterparty but used incomplete query evidence in its calculation.** Cedar Properties had May net cash movement of −$900 and June movement of −$970, so the requested June-minus-May change is −$70. Adaptive correctly bound the June query to the exact Cedar row it had inspected. Its May query showed only five of thirteen counterparty groups and was explicitly marked truncated. The calculator's declared rule requires complete query evidence, so it withheld the calculation. The model could have requested complete Cedar-only totals for both months in its second read; it did not. No amount was substituted in the final response.

**Composable's two ranking tables were incomplete answers, not wrong money.** It showed May's five largest decreases and June's five largest decreases, including Cedar in both, without calculating −$70. All ten displayed amounts match the independent fixture arithmetic. Four true June rows were outside the scorer's expected catalogue and triggered its `wrong-answer` label. That label must not be described as an observed incorrect dollar amount.

**Adaptive also missed a requested total.** Its supplies and marketing rows were correct, but the combined total was absent. The scorer correctly classified that response as partial. A safe refusal or a correct fragment does not earn full credit for an answerable question.

## Execution and evidence

- Exact source: `e0f21342e90c08ebe6f6152f587038ff4d283c28`; evaluation fingerprint: `5339d774fb3c60dedd7ce985a234e82b2c0b7739b7005418620666cc2d9ccda3`.
- [Workflow 41256839576](https://github.com/rayidali/spiich_homework/actions/runs/41256839576) completed all eight executions using the actual `financialChat` service and an isolated PostgreSQL fixture. Before provider execution, 133 evaluator/fixture tests across six files passed. This is not a new full-application CI count.
- Ten actual provider attempts cost an estimated **$0.0430523**, all with reported usage; no unknown reservation remains. The development phase is closed. Prices are standard-rate estimates, not an invoice or account balance.
- A separate offline integrity audit passed **212/212 checks**, including source, ordering, usage, scores and before/after fixture bindings. All 41 synthetic journals, 86 lines and 46 accounts across two organizations retained the same full fingerprint.
- The [sanitized outcomes](outcomes.json) preserve questions, application answers, structured plans, inspection facts and usage. [Provenance](provenance.json) binds them to retained originals. Credentials, key bindings, provider signatures and private headers are excluded.
- The [predecessor manifest](predecessor.json) records the exact 60-file source map and closed development accounting for any separately reviewed grading/admission amendment. It does not authorize replaying development or changing the runtime.

The semantic review is an internal AI artifact review, not independent human accounting certification. Its reviewer also authored the scorer; the independent reference arithmetic was authored separately. No new provider or database calls were made during this review. Neither review counts nor these development observations should be pooled into later held-out results. Production was not changed by this experiment.
