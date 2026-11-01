# Grader compatibility sensitivity on the same saved answers

The **frozen primary result remains 9/16 composable, 10/16 adaptive and 5/16 complete**. A separate offline replay of the **same 48 original responses** with two identified grader compatibility corrections gives **11/16, 11/16 and 5/16**. This is descriptive sensitivity analysis after inspecting failures, not a new model run, fresh held-out validation or replacement primary result. The decision remains **retain composable**; no adoption or deployment changed.

The two corrections are limited to accepting the product's equivalent `USD/month` display spelling in the strict value, headline and operand templates, and projecting declared assumption input fields into the strict quantity helper after the existing original-user quotation and source-offset checks. Amounts, currencies, periods, scope, formulas, reference labels and required outputs retain their existing checks. [Exact patch](compatibility.patch), [replay source as non-executable evidence](replay-source.txt).

Before the sensitivity replay, the original frozen scorer reproduced **all 48 saved primary scores exactly**. The corrected copy passed **16 calibration checks on copies of the known H10 response**: two accepted equivalent presentations and fourteen rejected mutations covering wrong amounts, currency, periods, extra prose, wrong operands, invalid original-user anchors/assumptions, wrong formulas, missing zero-activity months, incorrect posted/scenario status, another workspace and a missing requested result. These are mutation checks on one known answer, not sixteen new questions.

| Route      | Frozen primary | Same-answer compatibility sensitivity |
| ---------- | -------------: | ------------------------------------: |
| Composable |           9/16 |                                 11/16 |
| Adaptive   |          10/16 |                                 11/16 |
| Complete   |           5/16 |                                  5/16 |

Three cells change from failure to pass: H09 composable, H09 adaptive and H10 composable. H09 complete changes from ungradable to partial-answer and **still fails**. All other cell outcomes are unchanged. The receipt includes both interpretations and every original outcome/score hash. [Full 48-cell receipt](receipt.json).

The independent review of this replay checked the exact patch against the corrected source, the source and receipt hashes, all **102 frozen source files**, and all **48 original outcome/score pairs**. No original file was changed. The replay disabled network/provider and database access; there were **zero new inferences, provider calls or database calls**. Private raw provider responses and signatures remain private. [Hash-bound provenance](provenance.json).

This is internal AI-assisted automatic grading analysis, not independent human evaluation or a broad semantic reassessment. It diagnoses two grader compatibility defects using already seen answers. It does not establish universal financial accuracy, prove new candidate superiority, or change the original protocol, scores, thresholds or adoption decision.
