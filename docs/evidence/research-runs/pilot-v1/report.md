# Daybook comparative architecture study

Run: pilot-v1 · Dataset: daybook-study-v1 · Split: **development** · Generated: 2026-10-30T22:17:57.124Z

All planned route episodes are present. This establishes measurement completeness, not correctness of every answer.

Snapshot integrity (ledger_and_corpus): **verified**. Complete measurements and the supplied integrity check permit comparative interpretation, subject to the limitations and route hard gates.

## Results

| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| R0 Current control | 12/12 | 0/12 (0.0%) | 0.0% | 35.9 | 25.0% | 3.99s / 25.09s | N/A |
| R1 Broad tools | 12/12 | 4/12 (33.3%) | 33.3% | 39.4 | 8.3% | 9.39s / 25.11s | $0.00950 |
| R2 Lexical documents | 12/12 | 6/12 (50.0%) | 50.0% | 53.3 | 0.0% | 9.29s / 18.17s | $0.00589 |
| R3 Managed File Search | 12/12 | 6/12 (50.0%) | 50.0% | 60.0 | 0.0% | 9.40s / 16.75s | $0.00637 |
| R4 Custom hybrid | 12/12 | 8/12 (66.7%) | 66.7% | 68.3 | 0.0% | 9.58s / 14.18s | $0.00440 |
| R5 Jev reranking | 12/12 | 6/12 (50.0%) | 50.0% | 55.6 | 0.0% | 9.38s / 14.07s | $0.00626 |
| R6 Wren analytics | 12/12 | 5/12 (41.7%) | 41.7% | 46.1 | 41.7% | 8.80s / 14.07s | $0.00438 |
| R7 LLM verifier | 12/12 | 7/12 (58.3%) | 58.3% | 55.8 | 8.3% | 13.80s / 30.47s | $0.00588 |
| R8 Jev verifier | 12/12 | 6/12 (50.0%) | 50.0% | 59.2 | 0.0% | 10.62s / 25.57s | $0.00613 |

Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.

## Per-family success

| Route | financial | analytics | documents | scenario | entry | adversarial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 0.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) |
| R1 | 50.0% (n=2) | 50.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) |
| R2 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) |
| R3 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) |
| R4 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 100.0% (n=2) |
| R5 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) |
| R6 | 0.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 50.0% (n=2) |
| R7 | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 50.0% (n=2) |
| R8 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) |

## Paired effects

Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.

| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |
| --- | --- | ---: | ---: | ---: | --- |
| H1 | R1 / R0 | 12 | 12 | 33.3 pp | 8.3 to 58.3 pp |
| H2 | R2 / R1 | 12 | 12 | 16.7 pp | -8.3 to 41.7 pp |
| H3a | R3 / R2 | 12 | 12 | 0.0 pp | -16.7 to 16.7 pp |
| H3b | R3 / R4 | 12 | 12 | -16.7 pp | -33.3 to 0.0 pp |
| H4 | R4 / R2 | 12 | 12 | 16.7 pp | 0.0 to 33.3 pp |
| H5 | R5 / R4 | 12 | 12 | -16.7 pp | -33.3 to 0.0 pp |
| H6 | R6 / R4 | 12 | 12 | -25.0 pp | -33.3 to -16.7 pp |
| H7a | R7 / R4 | 12 | 12 | -8.3 pp | -25.0 to 8.3 pp |
| H7b | R8 / R4 | 12 | 12 | -16.7 pp | -33.3 to 0.0 pp |
| Descriptive | R2 / R0 | 12 | 12 | 50.0 pp | 25.0 to 75.0 pp |
| Descriptive | R3 / R0 | 12 | 12 | 50.0 pp | 25.0 to 75.0 pp |
| Descriptive | R4 / R0 | 12 | 12 | 66.7 pp | 50.0 to 83.3 pp |
| Descriptive | R5 / R0 | 12 | 12 | 50.0 pp | 25.0 to 75.0 pp |
| Descriptive | R6 / R0 | 12 | 12 | 41.7 pp | 25.0 to 58.3 pp |
| Descriptive | R7 / R0 | 12 | 12 | 58.3 pp | 33.3 to 83.3 pp |
| Descriptive | R8 / R0 | 12 | 12 | 50.0 pp | 25.0 to 75.0 pp |

## Cost and usage

| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 12 | 9738 / 1781 | 1 | $0.00737 | $0.00647 | $0.01385 |
| R1 | 23 | 35811 / 7001 | 1 | $0.02825 | $0.00977 | $0.03801 |
| R2 | 24 | 48550 / 8320 | 0 | $0.03536 | $0.00000 | $0.03536 |
| R3 | 28 | 51020 / 9173 | 0 | $0.03824 | $0.00000 | $0.03824 |
| R4 | 28 | 45934 / 8030 | 4 | $0.03386 | $0.00134 | $0.03519 |
| R5 | 32 | 63300 / 9444 | 4 | $0.03622 | $0.00135 | $0.03757 |
| R6 | 22 | 31768 / 4540 | 3 | $0.02088 | $0.00101 | $0.02189 |
| R7 | 37 | 55213 / 9291 | 4 | $0.03979 | $0.00134 | $0.04114 |
| R8 | 38 | 61516 / 9716 | 4 | $0.03546 | $0.00134 | $0.03680 |

Separate setup/indexing: 162 calls, $0.00000 reported-use estimate and $0.04236 unknown-use reservation. Shared indexing is not charged again for every route.

Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): 0 calls, $0.00000 in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.

## Failure analysis

### R0 Current control

Non-error conditional success: 0.0% (n=9). Missing planned episodes: 0.

- episode_error: 3 episodes.
- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 2 episodes.
- missing_document_evidence: 3 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 4 episodes.
- required_fact_missing_or_multiple_mismatches: 4 episodes.
- unresolved_citation: 3 episodes.
- unsupported_or_unassessed_fact: 1 episodes.

### R1 Broad tools

Non-error conditional success: 36.4% (n=11). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 2 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 4 episodes.
- missing_ledger_provenance: 1 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 5 episodes.
- required_fact_missing_or_multiple_mismatches: 3 episodes.
- unsupported_or_unassessed_fact: 2 episodes.
- wrong_behavior: 4 episodes.

### R2 Lexical documents

Non-error conditional success: 50.0% (n=12). Missing planned episodes: 0.

- deterministic_validation_failed: 2 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- proposal_line_mismatch: 2 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 2 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 3 episodes.

### R3 Managed File Search

Non-error conditional success: 50.0% (n=12). Missing planned episodes: 0.

- deterministic_validation_failed: 2 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 2 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 2 episodes.

### R4 Custom hybrid

Non-error conditional success: 66.7% (n=12). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 1 episodes.

### R5 Jev reranking

Non-error conditional success: 50.0% (n=12). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- metric_key_mismatch: 3 episodes.
- missing_clarification_topic: 1 episodes.
- missing_ledger_provenance: 2 episodes.
- proposal_line_mismatch: 2 episodes.
- required_fact_mismatch: 3 episodes.
- unsupported_or_unassessed_fact: 4 episodes.
- wrong_behavior: 2 episodes.

### R6 Wren analytics

Non-error conditional success: 71.4% (n=7). Missing planned episodes: 0.

- episode_error: 5 episodes.
- metric_key_mismatch: 1 episodes.
- missing_clarification_topic: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 1 episodes.

### R7 LLM verifier

Non-error conditional success: 63.6% (n=11). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 2 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 2 episodes.
- wrong_behavior: 2 episodes.

### R8 Jev verifier

Non-error conditional success: 50.0% (n=12). Missing planned episodes: 0.

- deterministic_validation_failed: 2 episodes.
- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 2 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 2 episodes.

## Methods and limits

- All inputs are synthetic. References are independently implemented decimal fixture calculations, not audited business records. No independent human adjudication is claimed.
- The primary score measures structured task success against frozen facts, scope, evidence IDs, proposal lines and explicit assumption/clarification tags. Natural-language summary faithfulness and usefulness still need human review.
- Grounding scores measure source provenance: required source IDs, actual result-value bindings and deterministic calculations. They do not establish full semantic entailment of every citation. Supplemental claims without an independent reference or exact trusted-result binding are penalized as unassessed.
- Automated scores are out of 90. The 10-point human clarity dimension and the combined 100-point score are unavailable; they are not imputed by another model.
- Provider/tool errors count as failed end-to-end episodes. Conditional quality excludes status:error episodes and includes intentional blocks; it is not a replacement denominator.
- Confidence intervals resample scenario groups within families. Paraphrases and repeat runs are correlated and stay together. Small synthetic samples do not establish real-world accuracy or safety.
- All displayed 95% bootstrap intervals are unadjusted for the nine predeclared component contrasts and additional descriptive contrasts. They are exploratory effect estimates, not simultaneous confidence guarantees or claims of statistical significance. Two-group pilot and five-group-per-family held-out intervals may have poor coverage; zero-width empirical intervals do not establish certainty.
- Reported monetary amounts are paid-equivalent estimates from returned usage and configured rates, not invoices. Unreported usage remains a separately identified conservative reservation; indexing/setup is separate.
- Managed File Search uses the Interactions API to identify source citations. Its citation order is not a raw retrieval rank or exposed passage list. Authorized source IDs are mapped to the shared canonical documents before answer generation. This is managed source selection, not a like-for-like chunk retriever; raw-passage recall, MRR and nDCG are unavailable unless independently exposed.
- Jev/LLM reviewers see supplied evidence, not ground truth, and can share generator errors. Their approval cannot override deterministic validation or database permissions.
- The Wren route evaluates the pinned OSS semantic engine with the shared planner and approved views. It does not measure the complete commercial Wren product.
- An incomplete route has no full-study conclusion. Missing episodes are reported separately, never silently removed or treated as free successful requests.
- Episode completeness and snapshot integrity are separate gates. Changed or unverified before/after data makes this report ineligible for comparative selection even if every episode is present. Individual routes with hard-gate violations remain disqualified.
- Queue-transport wall latency includes local dispatch delays and is not production request latency. Provider durations are measured separately.
- All study generators normalized to Gemini3.5FlashLite; R0 is an architecture reproduction. Same-model critic errors may correlate.

Full per-episode scores and failed rubric checks are in `results.json`. Visual figures are in the standalone `report.html`; it contains no third-party scripts or fonts.
