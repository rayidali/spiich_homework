# Prespecified component decisions — holdout-v1

Complete held-out measurement. No production winner is selected.

All differences are percentage points, treatment minus control. Intervals are unadjusted 95% clustered empirical intervals; they are not significance tests.

| Hypothesis | Comparison | Fixed families | Paired effect [interval], pp | Pairs / groups | >=+5pp point gain | Interpretation |
| --- | --- | --- | ---: | ---: | --- | --- |
| H1 | R1 − R0 | financial, analytics | 18.3 [-11.7, 50.0] | 60 / 10 | Yes | inconclusive INTERVAL_UNAVAILABLE_OR_SPANS_HARM_AND_USEFUL_BENEFIT |
| H2 | R2 − R1 | documents, scenario | 46.7 [35.0, 60.0] | 60 / 10 | Yes | candidate_for_further_experiment  |
| H3a | R3 − R2 | documents, scenario | 10.0 [-5.0, 23.3] | 60 / 10 | Yes | inconclusive INTERVAL_UNAVAILABLE_OR_SPANS_HARM_AND_USEFUL_BENEFIT |
| H3b | R3 − R4 | documents, scenario | 6.7 [-1.7, 16.7] | 60 / 10 | Yes | inconclusive INTERVAL_UNAVAILABLE_OR_SPANS_HARM_AND_USEFUL_BENEFIT |
| H4 | R4 − R2 | documents, scenario | 3.3 [-3.3, 10.0] | 60 / 10 | No | inconclusive INTERVAL_UNAVAILABLE_OR_SPANS_HARM_AND_USEFUL_BENEFIT |
| H5 | R5 − R4 | documents, scenario | -1.7 [-6.7, 3.3] | 60 / 10 | No | below_practical_target TARGETED_POINT_GAIN_BELOW_FIVE_PERCENTAGE_POINTS |
| H6 | R6 − R4 | financial, analytics | -20.0 [-41.7, -3.3] | 60 / 10 | No | below_practical_target TARGETED_POINT_GAIN_BELOW_FIVE_PERCENTAGE_POINTS |
| H7a | R7 − R4 | financial, analytics, documents, scenario, entry, adversarial | -2.8 [-6.1, 0.6] | 180 / 30 | Separate reviewer criterion | inconclusive REVIEWER_CRITERION_OR_END_TO_END_HARM_REMAINS_UNRESOLVED |
| H7b | R8 − R4 | financial, analytics, documents, scenario, entry, adversarial | -1.7 [-5.6, 1.7] | 180 / 30 | Separate reviewer criterion | inconclusive REVIEWER_CRITERION_OR_END_TO_END_HARM_REMAINS_UNRESOLVED |

## Reviewer criterion

Operational failures withhold output; conditional paired rates exclude request failures. A failure is never described as semantic flaw detection.
Differences are treatment minus deterministic control: negative false acceptance is favorable; positive correct withholding is unfavorable.
Criterion is lower operational false acceptance and <=+5pp correct withholding. Intervals are descriptive and unadjusted, not a significance/noninferiority test. No Brier score is inferred from composite Jev hazards.
Joint review policy requires both deterministic and model passes. Standalone reviewer differences are diagnostics. Conditional selection can change the evaluated case mix.

| Reviewer + deterministic gate | Flawed acceptance difference, pp | Correct withholding difference, pp | Conditional paired flawed acceptance, pp | Errors / measured | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| llm | -52.5 [-68.4, -35.0] | 2.5 [0.0, 7.9] | -52.5 [-68.4, -35.0] | 0 / 80 | inconclusive |
| jev | -55.0 [-73.2, -35.7] | 12.5 [0.0, 31.6] | -55.0 [-73.2, -35.7] | 0 / 80 | below_practical_target |

## Visible tradeoffs

| Comparison | Additional successes | Additional calls | Error delta, pp | p95 harness delta, ms | Tracked USD delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| R1 − R0 | 19 | 159 | -2.2 | 4705 | 0.167669 |
| R2 − R1 | 34 | 1 | 0.0 | 716 | 0.094190 |
| R3 − R2 | 17 | 110 | 1.1 | 6215 | 0.219031 |
| R3 − R4 | 9 | 0 | 1.1 | 2618 | 0.201989 |
| R4 − R2 | 8 | 110 | 0.0 | 3597 | 0.017042 |
| R5 − R4 | -3 | 107 | -0.6 | -503 | 0.015761 |
| R6 − R4 | -9 | -26 | 2.2 | -14 | -0.028778 |
| R7 − R4 | -5 | 116 | 1.1 | 3428 | 0.080747 |
| R8 − R4 | -3 | 125 | 0.0 | 864 | 0.010134 |

Tracked cost includes reported-use estimates and unknown-use reservations; it is not an invoice. Harness latency includes pacing and queue waits.

## Operational complexity

| Route | Components | Maintenance obligations |
| --- | --- | --- |
| R0 | PostgreSQL; one Gemini call; four existing financial tools | Maintain existing typed tools and accounting gates. |
| R1 | PostgreSQL; Gemini planner and answer calls; broader typed analytics | Maintain query compiler, calculation provenance and tool schemas. |
| R2 | R1 plus PostgreSQL lexical document search | Ingest/version authorized documents; maintain lexical retrieval. |
| R3 | Broad analytics plus Gemini managed File Search and final answer generation | Maintain managed store permissions, indexing and citation-to-document resolution; raw ranks unavailable. |
| R4 | R2 plus Gemini embeddings and PostgreSQL pgvector hybrid retrieval | Maintain embedding versions, vector index, workspace filters and fusion. |
| R5 | R4 plus Jev reranking | Operate another provider credential, candidate-ranking contract and limits. |
| R6 | R4 retrieval with Wren analytics replacing the custom query compiler | Operate the pinned engine, semantic model and SQL provenance restrictions. |
| R7 | R4 plus separate Gemini reviewer call using the same model weights | Maintain review prompts and evidence contract; correlated errors remain possible. |
| R8 | R4 plus Jev reviewer | Maintain calibrated development threshold, reviewer schema and second-provider limits. |

## Limitations

- Primary six-family scores are preserved. This supplement uses fixed targeted family mappings; entry and adversarial effects remain visible.
- Point estimates meeting +5pp are separate from interval uncertainty. Any negative interval bound is disclosed as possible harm; no new magnitude threshold for material harm is invented.
- All requests/errors remain in end-to-end task-success denominators. Missing attempts remain missing and block comparative conclusions.
- Recorded error rates include local/harness failures as well as provider failures; they are not a provider-only availability measurement.
- A favorable row means candidate for further experiment, subject to the visible cost, latency and operational tradeoffs. It never authorizes production deployment or an unmeasured combined architecture.
- Pareto tables use observed point estimates, not statistical superiority. Fewer services are preferred when gains are below target or inconclusive; no numerical operational-complexity score is invented.
- Unadjusted clustered intervals are descriptive, with only a few scenario groups per family. Degenerate intervals and a shared synthetic corpus limit generalization.
- Typed-fact/protocol success is not full prose faithfulness. Independent human clarity and reference adjudication remain unavailable.
