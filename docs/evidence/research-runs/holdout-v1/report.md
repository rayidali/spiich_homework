# Daybook comparative architecture study

Run: holdout-v1 · Dataset: daybook-study-v1 · Split: **holdout** · Generated: 2026-10-31T03:59:05.386Z

**Incomplete study:** one or more routes lack planned episodes. Do not select a winner from missing measurements.

Snapshot integrity (ledger_and_corpus): **unverified**. **Ineligible for comparative selection:** measurement completeness and verified snapshot integrity are both required.

AFTER_CHECK_UNAVAILABLE

## Results

| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| R0 Current control | 87/180 | 25/87 (28.7%) | 31.7% | 39.1 | 2.3% | 4.49s / 5.57s | $0.00549 |
| R1 Broad tools | 87/180 | 34/87 (39.1%) | 40.8% | 42.1 | 1.1% | 8.93s / 10.89s | $0.00666 |
| R2 Lexical documents | 87/180 | 55/87 (63.2%) | 63.7% | 60.3 | 1.1% | 9.22s / 11.27s | $0.00476 |
| R3 Managed File Search | 86/180 | 58/86 (67.4%) | 67.9% | 62.8 | 2.3% | 13.70s / 18.58s | $0.00720 |
| R4 Custom hybrid | 86/180 | 55/86 (64.0%) | 64.6% | 61.0 | 1.2% | 13.43s / 14.44s | $0.00495 |
| R5 Jev reranking | 86/180 | 55/86 (64.0%) | 64.6% | 60.2 | 0.0% | 13.59s / 13.99s | $0.00507 |
| R6 Wren analytics | 86/180 | 48/86 (55.8%) | 59.6% | 53.3 | 5.8% | 9.31s / 14.31s | $0.00510 |
| R7 LLM verifier | 86/180 | 54/86 (62.8%) | 65.2% | 59.7 | 3.5% | 14.40s / 18.09s | $0.00579 |
| R8 Jev verifier | 86/180 | 53/86 (61.6%) | 62.9% | 58.8 | 1.2% | 13.99s / 15.72s | $0.00516 |

Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.

## Per-family success

| Route | financial | analytics | documents | scenario | entry | adversarial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 60.0% (n=20) | 0.0% (n=20) | 0.0% (n=17) | 20.0% (n=10) | 70.0% (n=10) | 40.0% (n=10) |
| R1 | 60.0% (n=20) | 35.0% (n=20) | 0.0% (n=17) | 20.0% (n=10) | 70.0% (n=10) | 60.0% (n=10) |
| R2 | 65.0% (n=20) | 45.0% (n=20) | 82.4% (n=17) | 40.0% (n=10) | 80.0% (n=10) | 70.0% (n=10) |
| R3 | 70.0% (n=20) | 50.0% (n=20) | 87.5% (n=16) | 40.0% (n=10) | 90.0% (n=10) | 70.0% (n=10) |
| R4 | 70.0% (n=20) | 40.0% (n=20) | 87.5% (n=16) | 30.0% (n=10) | 90.0% (n=10) | 70.0% (n=10) |
| R5 | 70.0% (n=20) | 40.0% (n=20) | 87.5% (n=16) | 40.0% (n=10) | 90.0% (n=10) | 60.0% (n=10) |
| R6 | 40.0% (n=20) | 30.0% (n=20) | 87.5% (n=16) | 40.0% (n=10) | 90.0% (n=10) | 70.0% (n=10) |
| R7 | 60.0% (n=20) | 40.0% (n=20) | 81.3% (n=16) | 40.0% (n=10) | 90.0% (n=10) | 80.0% (n=10) |
| R8 | 60.0% (n=20) | 40.0% (n=20) | 87.5% (n=16) | 40.0% (n=10) | 80.0% (n=10) | 70.0% (n=10) |

## Paired effects

Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.

| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |
| --- | --- | ---: | ---: | ---: | --- |
| H1 | R1 / R0 | 87 | 30 | 9.2 pp | -6.7 to 25.0 pp |
| H2 | R2 / R1 | 87 | 30 | 22.9 pp | 12.7 to 33.7 pp |
| H3a | R3 / R2 | 86 | 30 | 3.3 pp | -3.1 to 10.0 pp |
| H3b | R3 / R4 | 86 | 30 | 3.3 pp | -2.0 to 9.2 pp |
| H4 | R4 / R2 | 86 | 30 | 0.0 pp | -5.4 to 5.4 pp |
| H5 | R5 / R4 | 86 | 30 | 0.0 pp | -3.3 to 3.3 pp |
| H6 | R6 / R4 | 86 | 30 | -5.0 pp | -13.3 to 3.3 pp |
| H7a | R7 / R4 | 86 | 30 | 0.6 pp | -4.4 to 6.5 pp |
| H7b | R8 / R4 | 86 | 30 | -1.7 pp | -8.4 to 4.4 pp |
| Descriptive | R2 / R0 | 87 | 30 | 32.1 pp | 13.0 to 50.3 pp |
| Descriptive | R3 / R0 | 86 | 30 | 36.3 pp | 18.8 to 53.3 pp |
| Descriptive | R4 / R0 | 86 | 30 | 32.9 pp | 15.6 to 50.4 pp |
| Descriptive | R5 / R0 | 86 | 30 | 32.9 pp | 13.1 to 52.1 pp |
| Descriptive | R6 / R0 | 86 | 30 | 27.9 pp | 11.9 to 43.8 pp |
| Descriptive | R7 / R0 | 86 | 30 | 33.5 pp | 17.0 to 49.9 pp |
| Descriptive | R8 / R0 | 86 | 30 | 31.3 pp | 12.9 to 48.3 pp |

## Cost and usage

| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 87 | 181867 / 30032 | 1 | $0.12964 | $0.00768 | $0.13732 |
| R1 | 166 | 294214 / 51446 | 1 | $0.21688 | $0.00945 | $0.22633 |
| R2 | 166 | 387812 / 58085 | 0 | $0.26156 | $0.00000 | $0.26156 |
| R3 | 220 | 840063 / 66221 | 0 | $0.41757 | $0.00000 | $0.41757 |
| R4 | 220 | 387919 / 55214 | 54 | $0.25441 | $0.01805 | $0.27246 |
| R5 | 275 | 604450 / 66582 | 55 | $0.26036 | $0.01837 | $0.27872 |
| R6 | 201 | 389867 / 46203 | 37 | $0.23247 | $0.01235 | $0.24482 |
| R7 | 276 | 437266 / 61893 | 52 | $0.28591 | $0.02654 | $0.31245 |
| R8 | 281 | 505102 / 62711 | 52 | $0.25616 | $0.01739 | $0.27355 |

Separate setup/indexing: 280 calls, $0.00000 reported-use estimate and $0.06983 unknown-use reservation. Shared indexing is not charged again for every route.

Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): 0 calls, $0.00000 in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.

## Failure analysis

### R0 Current control

Non-error conditional success: 29.4% (n=85). Missing planned episodes: 93.

- episode_error: 2 episodes.
- metric_key_mismatch: 16 episodes.
- missing_assumption: 5 episodes.
- missing_document_evidence: 30 episodes.
- missing_ledger_provenance: 26 episodes.
- required_fact_mismatch: 51 episodes.
- required_fact_missing_or_multiple_mismatches: 51 episodes.
- unsupported_or_unassessed_fact: 4 episodes.
- wrong_behavior: 20 episodes.

### R1 Broad tools

Non-error conditional success: 39.5% (n=86). Missing planned episodes: 93.

- deterministic_validation_failed: 14 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 8 episodes.
- missing_assumption: 10 episodes.
- missing_clarification_topic: 3 episodes.
- missing_document_evidence: 30 episodes.
- missing_ledger_provenance: 28 episodes.
- proposal_line_mismatch: 2 episodes.
- required_fact_mismatch: 44 episodes.
- required_fact_missing_or_multiple_mismatches: 36 episodes.
- unsupported_or_unassessed_fact: 8 episodes.
- wrong_behavior: 39 episodes.

### R2 Lexical documents

Non-error conditional success: 64.0% (n=86). Missing planned episodes: 93.

- deterministic_validation_failed: 20 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 8 episodes.
- missing_assumption: 11 episodes.
- missing_clarification_topic: 2 episodes.
- missing_document_evidence: 10 episodes.
- missing_ledger_provenance: 24 episodes.
- proposal_line_mismatch: 2 episodes.
- required_fact_mismatch: 26 episodes.
- required_fact_missing_or_multiple_mismatches: 18 episodes.
- unsupported_or_unassessed_fact: 9 episodes.
- wrong_behavior: 22 episodes.

### R3 Managed File Search

Non-error conditional success: 69.0% (n=84). Missing planned episodes: 94.

- deterministic_validation_failed: 16 episodes.
- episode_error: 2 episodes.
- metric_key_mismatch: 4 episodes.
- missing_assumption: 10 episodes.
- missing_clarification_topic: 2 episodes.
- missing_document_evidence: 8 episodes.
- missing_ledger_provenance: 21 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 23 episodes.
- required_fact_missing_or_multiple_mismatches: 17 episodes.
- required_scope_or_unit_mismatch: 2 episodes.
- unsupported_or_unassessed_fact: 6 episodes.
- wrong_behavior: 20 episodes.

### R4 Custom hybrid

Non-error conditional success: 64.7% (n=85). Missing planned episodes: 94.

- deterministic_validation_failed: 16 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 8 episodes.
- missing_assumption: 10 episodes.
- missing_clarification_topic: 3 episodes.
- missing_document_evidence: 10 episodes.
- missing_ledger_provenance: 24 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 26 episodes.
- required_fact_missing_or_multiple_mismatches: 17 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 10 episodes.
- wrong_behavior: 20 episodes.

### R5 Jev reranking

Non-error conditional success: 64.0% (n=86). Missing planned episodes: 94.

- deterministic_validation_failed: 17 episodes.
- metric_key_mismatch: 6 episodes.
- missing_assumption: 11 episodes.
- missing_clarification_topic: 3 episodes.
- missing_document_evidence: 9 episodes.
- missing_ledger_provenance: 24 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 27 episodes.
- required_fact_missing_or_multiple_mismatches: 19 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 8 episodes.
- wrong_behavior: 23 episodes.

### R6 Wren analytics

Non-error conditional success: 59.3% (n=81). Missing planned episodes: 94.

- deterministic_validation_failed: 20 episodes.
- episode_error: 5 episodes.
- metric_key_mismatch: 7 episodes.
- missing_assumption: 10 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 8 episodes.
- missing_ledger_provenance: 27 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 31 episodes.
- required_fact_missing_or_multiple_mismatches: 23 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 9 episodes.
- wrong_behavior: 24 episodes.

### R7 LLM verifier

Non-error conditional success: 65.1% (n=83). Missing planned episodes: 94.

- deterministic_validation_failed: 16 episodes.
- episode_error: 3 episodes.
- metric_key_mismatch: 8 episodes.
- missing_assumption: 10 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 8 episodes.
- missing_ledger_provenance: 25 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 27 episodes.
- required_fact_missing_or_multiple_mismatches: 18 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 8 episodes.
- wrong_behavior: 20 episodes.

### R8 Jev verifier

Non-error conditional success: 62.4% (n=85). Missing planned episodes: 94.

- deterministic_validation_failed: 15 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 8 episodes.
- missing_assumption: 11 episodes.
- missing_clarification_topic: 2 episodes.
- missing_document_evidence: 10 episodes.
- missing_ledger_provenance: 26 episodes.
- proposal_line_mismatch: 2 episodes.
- required_fact_mismatch: 28 episodes.
- required_fact_missing_or_multiple_mismatches: 18 episodes.
- required_numeric_value_mismatch: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 10 episodes.
- wrong_behavior: 22 episodes.

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
