# Prespecified component decisions — smoke-v3

DIAGNOSTIC / INELIGIBLE: DEVELOPMENT_ONLY, INCOMPLETE_ROUTE_MATRIX, FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED, SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED, OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE

All differences are percentage points, treatment minus control. Intervals are unadjusted 95% clustered empirical intervals; they are not significance tests.

| Hypothesis | Comparison | Fixed families | Paired effect [interval], pp | Pairs / groups | >=+5pp point gain | Interpretation |
| --- | --- | --- | ---: | ---: | --- | --- |
| H1 | R1 − R0 | financial, analytics | 0.0 [N/A, N/A] | 2 / 2 | No | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H2 | R2 − R1 | documents, scenario | 50.0 [N/A, N/A] | 2 / 2 | Yes | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H3a | R3 − R2 | documents, scenario | 0.0 [N/A, N/A] | 2 / 2 | No | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H3b | R3 − R4 | documents, scenario | 0.0 [N/A, N/A] | 2 / 2 | No | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H4 | R4 − R2 | documents, scenario | 0.0 [N/A, N/A] | 2 / 2 | No | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H5 | R5 − R4 | documents, scenario | 0.0 [N/A, N/A] | 2 / 2 | No | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H6 | R6 − R4 | financial, analytics | 50.0 [N/A, N/A] | 2 / 2 | Yes | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H7a | R7 − R4 | financial, analytics, documents, scenario, entry, adversarial | -16.7 [N/A, N/A] | 6 / 6 | Separate reviewer criterion | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |
| H7b | R8 − R4 | financial, analytics, documents, scenario, entry, adversarial | 0.0 [N/A, N/A] | 6 / 6 | Separate reviewer criterion | ineligible DEVELOPMENT_ONLY; INCOMPLETE_ROUTE_MATRIX; FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED; SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED; OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE |

## Reviewer criterion

Reviewer raw outcomes and evaluator label projection were not supplied. No reviewer criterion is inferred.

| Reviewer + deterministic gate | Flawed acceptance difference, pp | Correct withholding difference, pp | Conditional paired flawed acceptance, pp | Errors / measured | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |

## Visible tradeoffs

| Comparison | Additional successes | Additional calls | Error delta, pp | p95 harness delta, ms | Tracked USD delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| R1 − R0 | 0 | 6 | 0.0 | 5660 | 0.011168 |
| R2 − R1 | 1 | 0 | 0.0 | -228 | -0.002191 |
| R3 − R2 | 1 | 4 | 0.0 | 12105 | 0.017737 |
| R3 − R4 | 1 | 0 | 0.0 | 8236 | 0.013990 |
| R4 − R2 | 0 | 4 | 0.0 | 3869 | 0.003748 |
| R5 − R4 | 0 | 4 | 0.0 | -408 | -0.002902 |
| R6 − R4 | 1 | -2 | 0.0 | 297 | -0.001109 |
| R7 − R4 | -1 | 3 | 0.0 | 3736 | -0.002995 |
| R8 − R4 | 0 | 5 | 0.0 | 1336 | 0.000460 |

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
