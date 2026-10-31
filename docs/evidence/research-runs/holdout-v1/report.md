# Daybook comparative architecture study

Run: holdout-v1 · Dataset: daybook-study-v1 · Split: **holdout** · Generated: 2026-10-31T07:38:19.338Z

All planned route episodes are present. This establishes measurement completeness, not correctness of every answer.

Snapshot integrity (ledger_and_corpus): **verified**. Complete measurements and the supplied integrity check permit comparative interpretation, subject to the limitations and route hard gates.

## Results

| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| R0 Current control | 180/180 | 57/180 (31.7%) | 31.7% | 42.5 | 2.8% | 4.48s / 5.83s | $0.00488 |
| R1 Broad tools | 180/180 | 76/180 (42.2%) | 42.2% | 45.9 | 0.6% | 8.93s / 10.54s | $0.00587 |
| R2 Lexical documents | 180/180 | 110/180 (61.1%) | 61.1% | 58.8 | 0.6% | 9.30s / 11.26s | $0.00491 |
| R3 Managed File Search | 180/180 | 127/180 (70.6%) | 70.6% | 65.1 | 1.7% | 13.53s / 17.47s | $0.00598 |
| R4 Custom hybrid | 180/180 | 118/180 (65.6%) | 65.6% | 62.2 | 0.6% | 13.30s / 14.85s | $0.00472 |
| R5 Jev reranking | 180/180 | 115/180 (63.9%) | 63.9% | 59.9 | 0.0% | 13.59s / 14.35s | $0.00498 |
| R6 Wren analytics | 180/180 | 109/180 (60.6%) | 60.6% | 57.1 | 2.8% | 9.61s / 14.84s | $0.00485 |
| R7 LLM verifier | 180/180 | 113/180 (62.8%) | 62.8% | 59.3 | 1.7% | 13.99s / 18.28s | $0.00565 |
| R8 Jev verifier | 180/180 | 115/180 (63.9%) | 63.9% | 61.0 | 0.6% | 13.85s / 15.72s | $0.00493 |

Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.

## Per-family success

| Route | financial | analytics | documents | scenario | entry | adversarial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 60.0% (n=30) | 0.0% (n=30) | 0.0% (n=30) | 20.0% (n=30) | 70.0% (n=30) | 40.0% (n=30) |
| R1 | 60.0% (n=30) | 36.7% (n=30) | 0.0% (n=30) | 16.7% (n=30) | 73.3% (n=30) | 66.7% (n=30) |
| R2 | 63.3% (n=30) | 40.0% (n=30) | 76.7% (n=30) | 33.3% (n=30) | 83.3% (n=30) | 70.0% (n=30) |
| R3 | 73.3% (n=30) | 53.3% (n=30) | 90.0% (n=30) | 40.0% (n=30) | 90.0% (n=30) | 76.7% (n=30) |
| R4 | 70.0% (n=30) | 43.3% (n=30) | 80.0% (n=30) | 36.7% (n=30) | 90.0% (n=30) | 73.3% (n=30) |
| R5 | 73.3% (n=30) | 43.3% (n=30) | 80.0% (n=30) | 33.3% (n=30) | 86.7% (n=30) | 66.7% (n=30) |
| R6 | 40.0% (n=30) | 33.3% (n=30) | 80.0% (n=30) | 40.0% (n=30) | 93.3% (n=30) | 76.7% (n=30) |
| R7 | 60.0% (n=30) | 40.0% (n=30) | 86.7% (n=30) | 36.7% (n=30) | 86.7% (n=30) | 66.7% (n=30) |
| R8 | 56.7% (n=30) | 40.0% (n=30) | 86.7% (n=30) | 43.3% (n=30) | 86.7% (n=30) | 70.0% (n=30) |

## Paired effects

Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.

| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |
| --- | --- | ---: | ---: | ---: | --- |
| H1 | R1 / R0 | 180 | 30 | 10.6 pp | -4.4 to 25.6 pp |
| H2 | R2 / R1 | 180 | 30 | 18.9 pp | 10.6 to 27.8 pp |
| H3a | R3 / R2 | 180 | 30 | 9.4 pp | 3.3 to 15.6 pp |
| H3b | R3 / R4 | 180 | 30 | 5.0 pp | 0.0 to 10.6 pp |
| H4 | R4 / R2 | 180 | 30 | 4.4 pp | 0.6 to 8.3 pp |
| H5 | R5 / R4 | 180 | 30 | -1.7 pp | -6.1 to 2.2 pp |
| H6 | R6 / R4 | 180 | 30 | -5.0 pp | -12.8 to 2.2 pp |
| H7a | R7 / R4 | 180 | 30 | -2.8 pp | -6.1 to 0.6 pp |
| H7b | R8 / R4 | 180 | 30 | -1.7 pp | -5.6 to 1.7 pp |
| Descriptive | R2 / R0 | 180 | 30 | 29.4 pp | 10.6 to 47.2 pp |
| Descriptive | R3 / R0 | 180 | 30 | 38.9 pp | 21.7 to 55.6 pp |
| Descriptive | R4 / R0 | 180 | 30 | 33.9 pp | 16.1 to 51.1 pp |
| Descriptive | R5 / R0 | 180 | 30 | 32.2 pp | 13.3 to 50.6 pp |
| Descriptive | R6 / R0 | 180 | 30 | 28.9 pp | 13.3 to 43.9 pp |
| Descriptive | R7 / R0 | 180 | 30 | 31.1 pp | 13.9 to 47.8 pp |
| Descriptive | R8 / R0 | 180 | 30 | 32.2 pp | 15.0 to 48.9 pp |

## Cost and usage

| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 180 | 378108 / 62892 | 1 | $0.27066 | $0.00768 | $0.27834 |
| R1 | 339 | 572037 / 105979 | 1 | $0.43656 | $0.00945 | $0.44601 |
| R2 | 340 | 765939 / 124166 | 0 | $0.54020 | $0.00000 | $0.54020 |
| R3 | 450 | 1384367 / 137567 | 0 | $0.75923 | $0.00000 | $0.75923 |
| R4 | 450 | 773286 / 115796 | 107 | $0.52148 | $0.03576 | $0.55724 |
| R5 | 557 | 1197016 / 139714 | 108 | $0.53694 | $0.03606 | $0.57300 |
| R6 | 424 | 806800 / 103750 | 81 | $0.50142 | $0.02705 | $0.52846 |
| R7 | 566 | 871769 / 133419 | 101 | $0.59508 | $0.04291 | $0.63799 |
| R8 | 575 | 1000858 / 132936 | 106 | $0.53193 | $0.03544 | $0.56737 |

Separate setup/indexing: 280 calls, $0.00000 reported-use estimate and $0.06983 unknown-use reservation. Shared indexing is not charged again for every route.

Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): 0 calls, $0.00000 in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.

## Failure analysis

### R0 Current control

Non-error conditional success: 32.6% (n=175). Missing planned episodes: 0.

- episode_error: 5 episodes.
- metric_key_mismatch: 28 episodes.
- missing_assumption: 11 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 64 episodes.
- missing_ledger_provenance: 40 episodes.
- required_fact_mismatch: 91 episodes.
- required_fact_missing_or_multiple_mismatches: 91 episodes.
- unsupported_or_unassessed_fact: 6 episodes.
- wrong_behavior: 38 episodes.

### R1 Broad tools

Non-error conditional success: 42.5% (n=179). Missing planned episodes: 0.

- deterministic_validation_failed: 22 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 11 episodes.
- missing_assumption: 25 episodes.
- missing_clarification_topic: 8 episodes.
- missing_document_evidence: 65 episodes.
- missing_ledger_provenance: 51 episodes.
- proposal_line_mismatch: 3 episodes.
- required_fact_mismatch: 81 episodes.
- required_fact_missing_or_multiple_mismatches: 69 episodes.
- required_numeric_value_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 12 episodes.
- wrong_behavior: 77 episodes.

### R2 Lexical documents

Non-error conditional success: 61.5% (n=179). Missing planned episodes: 0.

- deterministic_validation_failed: 38 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 14 episodes.
- missing_assumption: 27 episodes.
- missing_clarification_topic: 7 episodes.
- missing_document_evidence: 24 episodes.
- missing_ledger_provenance: 49 episodes.
- proposal_line_mismatch: 4 episodes.
- required_fact_mismatch: 55 episodes.
- required_fact_missing_or_multiple_mismatches: 38 episodes.
- required_numeric_value_mismatch: 2 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 19 episodes.
- wrong_behavior: 50 episodes.

### R3 Managed File Search

Non-error conditional success: 71.8% (n=177). Missing planned episodes: 0.

- deterministic_validation_failed: 29 episodes.
- episode_error: 3 episodes.
- metric_key_mismatch: 5 episodes.
- missing_assumption: 24 episodes.
- missing_clarification_topic: 4 episodes.
- missing_document_evidence: 19 episodes.
- missing_ledger_provenance: 39 episodes.
- proposal_line_mismatch: 4 episodes.
- required_fact_mismatch: 43 episodes.
- required_fact_missing_or_multiple_mismatches: 35 episodes.
- required_scope_or_unit_mismatch: 3 episodes.
- unsupported_or_unassessed_fact: 8 episodes.
- wrong_behavior: 40 episodes.

### R4 Custom hybrid

Non-error conditional success: 65.9% (n=179). Missing planned episodes: 0.

- deterministic_validation_failed: 31 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 14 episodes.
- missing_assumption: 26 episodes.
- missing_clarification_topic: 6 episodes.
- missing_document_evidence: 24 episodes.
- missing_ledger_provenance: 45 episodes.
- proposal_line_mismatch: 3 episodes.
- required_fact_mismatch: 52 episodes.
- required_fact_missing_or_multiple_mismatches: 35 episodes.
- required_numeric_value_mismatch: 2 episodes.
- required_scope_or_unit_mismatch: 2 episodes.
- unsupported_or_unassessed_fact: 18 episodes.
- wrong_behavior: 43 episodes.

### R5 Jev reranking

Non-error conditional success: 63.9% (n=180). Missing planned episodes: 0.

- deterministic_validation_failed: 37 episodes.
- metric_key_mismatch: 11 episodes.
- missing_assumption: 27 episodes.
- missing_clarification_topic: 9 episodes.
- missing_document_evidence: 23 episodes.
- missing_ledger_provenance: 45 episodes.
- proposal_line_mismatch: 3 episodes.
- required_fact_mismatch: 52 episodes.
- required_fact_missing_or_multiple_mismatches: 39 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 14 episodes.
- wrong_behavior: 52 episodes.

### R6 Wren analytics

Non-error conditional success: 62.3% (n=175). Missing planned episodes: 0.

- deterministic_validation_failed: 39 episodes.
- episode_error: 5 episodes.
- metric_key_mismatch: 13 episodes.
- missing_assumption: 27 episodes.
- missing_clarification_topic: 2 episodes.
- missing_document_evidence: 20 episodes.
- missing_ledger_provenance: 54 episodes.
- proposal_line_mismatch: 2 episodes.
- required_fact_mismatch: 62 episodes.
- required_fact_missing_or_multiple_mismatches: 48 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 15 episodes.
- wrong_behavior: 51 episodes.

### R7 LLM verifier

Non-error conditional success: 63.8% (n=177). Missing planned episodes: 0.

- deterministic_validation_failed: 33 episodes.
- episode_error: 3 episodes.
- metric_key_mismatch: 12 episodes.
- missing_assumption: 27 episodes.
- missing_clarification_topic: 6 episodes.
- missing_document_evidence: 21 episodes.
- missing_ledger_provenance: 49 episodes.
- proposal_line_mismatch: 4 episodes.
- required_fact_mismatch: 52 episodes.
- required_fact_missing_or_multiple_mismatches: 39 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 13 episodes.
- wrong_behavior: 49 episodes.

### R8 Jev verifier

Non-error conditional success: 64.2% (n=179). Missing planned episodes: 0.

- deterministic_validation_failed: 33 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 12 episodes.
- missing_assumption: 25 episodes.
- missing_clarification_topic: 6 episodes.
- missing_document_evidence: 22 episodes.
- missing_ledger_provenance: 48 episodes.
- proposal_line_mismatch: 4 episodes.
- required_fact_mismatch: 52 episodes.
- required_fact_missing_or_multiple_mismatches: 37 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 2 episodes.
- unsupported_or_unassessed_fact: 16 episodes.
- wrong_behavior: 46 episodes.

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
