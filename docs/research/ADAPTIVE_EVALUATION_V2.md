# Adaptive comparison: grading amendment before holdout

**Version 2 changes grading and admission, not either product route.** It uses the same spending cohort, original cases, books, model, prices, budgets and candidate-selection rule as [protocol v1](ADAPTIVE_EVALUATION.md). The original source, eight development outcomes and v1 scores remain preserved in [development evidence](../evidence/adaptive-runs/development-v1/report.md).

Development exposed two grading problems. A direct database sum over two disjoint expense-account sets can correctly answer their combined total without a separate calculator step. Also, an extra row can be truthful even when the fixed expected-answer catalogue did not list it. V1 incorrectly called these representations wrong financial answers. The changes below were designed after seeing development outputs, before any holdout execution. They are calibration, not a claim of independently confirmed improvement.

## Amended checks

The new scorer retains v1 and records its original result beside each v2 result. It permits a ledger union sum to satisfy an addition only when the required operands are expense sums over disjoint posting-account sets with identical date, status, currency, counterparty and remaining filters. Identical numbers alone are insufficient. Overlapping accounts, different periods, missing filters, unsupported units or a missing combined answer do not pass.

Additional structured ledger rows are checked against the independent synthetic-fixture arithmetic. A proved true extra row is distinguished from an incorrect amount or an unverifiable claim. It does not satisfy a required answer with different scope, and truthful extra information does not excuse a missing requested calculation. Display bindings and all existing proof, identity, ancestry and boundary checks still apply. Free prose remains separately reviewed; this is not a universal semantic judge.

The eight captured development outcomes are recalibrated offline. No model is asked the questions again, and no old score is overwritten. The public calibration receipt binds the original artifact hashes, v2 scorer, resulting score file and unchanged application/fixture source. Original automatic results remain 2/4 for each route; the separately reviewed development result is 3/4 for composable and 2/4 for adaptive. Development does not enter the held-out denominator.

## Execution and cost continuity

The spending cohort remains `adaptive-loop-20261031-v1`. Development run `41256839576`, source `e0f21342e90c08ebe6f6152f587038ff4d283c28`, is permanently closed at ten provider attempts and **$0.0430523**, with zero unknown reservations. Paid development is disabled in the amended workflow. The original **$0.40 / 80-attempt** holdout allocation is unchanged; unused development capacity is not transferred. The combined ceiling remains $0.50. Every new summary carries the prior cost and attempts separately from the held-out phase.

Admission pins that exact successful development run and artifact, verifies the closed ledger, matches every retained input hash, checks the original runtime, migrations, dependencies, fixtures and transport against current files, and verifies the new offline calibration. It rejects another holdout dispatch under the same cohort, including a dispatch from the original workflow version. A reused run, changed provider key or absent source binding is refused. The amended evaluator source and protocol are frozen before holdout calls; the source hash includes the calibration evidence.

The 16 held-out questions still run once through each route, in alternating route order. Outcomes are saved before scoring. Provider usage, transport failures, incomplete results and original v1 scores are retained. The primary comparison uses frozen v2 structured task success; v1 scores are reported as a separately labeled grading sensitivity. Internal semantic review explains any remaining grader limitations without rewriting that primary outcome.

The original selection screen is unchanged: adaptive needs at least two net additional successes, no lost control success in the common family, and no additional wrong financial answer or hard-boundary violation before a separate hosted acceptance can be considered. Small synthetic results cannot establish zero error, arbitrary-question coverage, production capacity or hiring success.
