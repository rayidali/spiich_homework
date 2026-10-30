# Daybook validator stress study

80 planned cases: 40 correct, 40 deliberately flawed. All outcomes recorded.

Jev threshold: **0.8**; selected on development only; 5pp false-rejection constraint satisfied.

| Reviewer | Measured / planned | Errors | Conditional false accept | Conditional false reject | Conditional balanced accuracy | Fail-closed false accept / reject | With code false accept / reject |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| deterministic | 80/80 | 0 | 70.0% | 0.0% | 65.0% | 70.0% / 0.0% | 70.0% / 0.0% |
| llm | 80/80 | 4 | 21.1% | 5.3% | 86.8% | 20.0% / 10.0% | 20.0% / 10.0% |
| jev | 80/80 | 0 | 35.0% | 5.0% | 80.0% | 35.0% / 5.0% | 27.5% / 5.0% |

Conditional metrics exclude failed provider requests. Fail-closed metrics block on request errors; a failed request is not evidence that a semantic reviewer detected a flaw.

## Fault breakdown

| Reviewer | Injected fault | Measured | Accepted flawed | Provider errors |
| --- | --- | ---: | ---: | ---: |
| deterministic | wrong_amount | 4 | 0 | 0 |
| deterministic | wrong_period | 4 | 4 | 0 |
| deterministic | wrong_entity | 4 | 4 | 0 |
| deterministic | wrong_currency | 4 | 0 | 0 |
| deterministic | unsupported_citation | 4 | 0 | 0 |
| deterministic | obsolete_clause | 4 | 4 | 0 |
| deterministic | invoice_as_payment | 4 | 4 | 0 |
| deterministic | missing_assumption | 4 | 4 | 0 |
| deterministic | unjustified_certainty | 4 | 4 | 0 |
| deterministic | instruction_in_evidence | 4 | 4 | 0 |
| llm | wrong_amount | 4 | 0 | 0 |
| llm | wrong_period | 4 | 0 | 0 |
| llm | wrong_entity | 4 | 2 | 0 |
| llm | wrong_currency | 4 | 0 | 0 |
| llm | unsupported_citation | 4 | 0 | 0 |
| llm | obsolete_clause | 4 | 0 | 0 |
| llm | invoice_as_payment | 4 | 3 | 0 |
| llm | missing_assumption | 4 | 0 | 1 |
| llm | unjustified_certainty | 4 | 0 | 0 |
| llm | instruction_in_evidence | 4 | 3 | 1 |
| jev | wrong_amount | 4 | 0 | 0 |
| jev | wrong_period | 4 | 0 | 0 |
| jev | wrong_entity | 4 | 0 | 0 |
| jev | wrong_currency | 4 | 0 | 0 |
| jev | unsupported_citation | 4 | 3 | 0 |
| jev | obsolete_clause | 4 | 0 | 0 |
| jev | invoice_as_payment | 4 | 4 | 0 |
| jev | missing_assumption | 4 | 3 | 0 |
| jev | unjustified_certainty | 4 | 0 | 0 |
| jev | instruction_in_evidence | 4 | 4 | 0 |

## Limits

- Synthetic stress cases have 50% flawed prevalence; these results do not estimate production precision.
- Correct/flawed pairs share source scenarios. Reused templates and fault patterns reduce independence; no publication-grade statistical power is claimed.
- The deterministic baseline checks schema, citation existence and exact source amount/currency pairs. It intentionally cannot detect semantic period/entity/narrative contradictions.
- Each semantic reviewer is run on every candidate, including code-detectable faults. Combined pipeline metrics show their additional contribution after code checks.
- Provider errors are separate from semantic decisions. The operational column blocks on errors; the conditional column includes only completed reviewer responses.
- Jev thresholds are selected only on development cases and frozen before holdout. Maximum hazard is an uncalibrated risk score; overall Brier calibration is unavailable.
- LLM critic and main generator use the same Gemini3.5FlashLite weights in separate contexts; their errors are not statistically independent.
- Reference fault labels are synthetic authored cases, not independently adjudicated human judgments. Narrative flaws are measured by these labels, not a judge-model truth claim.
