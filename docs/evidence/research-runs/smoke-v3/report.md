# Daybook comparative architecture study

Run: smoke-v3 · Dataset: daybook-study-v1 · Split: **development** · Generated: 2026-10-31T01:07:11.540Z

All planned route episodes are present. This establishes measurement completeness, not correctness of every answer.

Snapshot integrity (ledger_and_corpus): **verified**. Complete measurements and the supplied integrity check permit comparative interpretation, subject to the limitations and route hard gates.

## Results

| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| R0 Current control | 6/6 | 2/6 (33.3%) | 33.3% | 49.4 | 0.0% | 3.55s / 4.91s | $0.00405 |
| R1 Broad tools | 6/6 | 2/6 (33.3%) | 33.3% | 53.3 | 0.0% | 9.30s / 10.57s | $0.00963 |
| R2 Lexical documents | 6/6 | 3/6 (50.0%) | 50.0% | 68.3 | 0.0% | 9.12s / 10.34s | $0.00569 |
| R3 Managed File Search | 6/6 | 4/6 (66.7%) | 66.7% | 70.0 | 0.0% | 13.33s / 22.45s | $0.00870 |
| R4 Custom hybrid | 6/6 | 3/6 (50.0%) | 50.0% | 68.3 | 0.0% | 13.90s / 14.21s | $0.00694 |
| R5 Jev reranking | 6/6 | 3/6 (50.0%) | 50.0% | 68.3 | 0.0% | 13.27s / 13.80s | $0.00597 |
| R6 Wren analytics | 6/6 | 4/6 (66.7%) | 66.7% | 73.3 | 0.0% | 9.53s / 14.51s | $0.00493 |
| R7 LLM verifier | 6/6 | 2/6 (33.3%) | 33.3% | 57.2 | 0.0% | 13.07s / 17.95s | $0.00891 |
| R8 Jev verifier | 6/6 | 3/6 (50.0%) | 50.0% | 68.3 | 0.0% | 13.70s / 15.55s | $0.00709 |

Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.

## Per-family success

| Route | financial | analytics | documents | scenario | entry | adversarial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 100.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R1 | 100.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R2 | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R3 | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 100.0% (n=1) |
| R4 | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R5 | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R6 | 100.0% (n=1) | 100.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R7 | 100.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| R8 | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |

## Paired effects

Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.

| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |
| --- | --- | ---: | ---: | ---: | --- |
| H1 | R1 / R0 | 6 | 6 | 0.0 pp | N/A |
| H2 | R2 / R1 | 6 | 6 | 16.7 pp | N/A |
| H3a | R3 / R2 | 6 | 6 | 16.7 pp | N/A |
| H3b | R3 / R4 | 6 | 6 | 16.7 pp | N/A |
| H4 | R4 / R2 | 6 | 6 | 0.0 pp | N/A |
| H5 | R5 / R4 | 6 | 6 | 0.0 pp | N/A |
| H6 | R6 / R4 | 6 | 6 | 16.7 pp | N/A |
| H7a | R7 / R4 | 6 | 6 | -16.7 pp | N/A |
| H7b | R8 / R4 | 6 | 6 | 0.0 pp | N/A |
| Descriptive | R2 / R0 | 6 | 6 | 16.7 pp | N/A |
| Descriptive | R3 / R0 | 6 | 6 | 33.3 pp | N/A |
| Descriptive | R4 / R0 | 6 | 6 | 16.7 pp | N/A |
| Descriptive | R5 / R0 | 6 | 6 | 16.7 pp | N/A |
| Descriptive | R6 / R0 | 6 | 6 | 33.3 pp | N/A |
| Descriptive | R7 / R0 | 6 | 6 | 0.0 pp | N/A |
| Descriptive | R8 / R0 | 6 | 6 | 16.7 pp | N/A |

## Cost and usage

| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 6 | 13061 / 1670 | 0 | $0.00809 | $0.00000 | $0.00809 |
| R1 | 12 | 18537 / 5480 | 0 | $0.01926 | $0.00000 | $0.01926 |
| R2 | 12 | 23575 / 3999 | 0 | $0.01707 | $0.00000 | $0.01707 |
| R3 | 16 | 81266 / 4171 | 0 | $0.03481 | $0.00000 | $0.03481 |
| R4 | 16 | 26544 / 4606 | 4 | $0.01948 | $0.00134 | $0.02082 |
| R5 | 20 | 42488 / 4097 | 4 | $0.01658 | $0.00134 | $0.01792 |
| R6 | 14 | 25904 / 4505 | 2 | $0.01903 | $0.00067 | $0.01971 |
| R7 | 19 | 26207 / 3719 | 2 | $0.01716 | $0.00066 | $0.01782 |
| R8 | 21 | 35330 / 5295 | 4 | $0.01994 | $0.00134 | $0.02128 |

Separate setup/indexing: 280 calls, $0.00000 reported-use estimate and $0.06983 unknown-use reservation. Shared indexing is not charged again for every route.

Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): 0 calls, $0.00000 in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.

## Failure analysis

### R0 Current control

Non-error conditional success: 33.3% (n=6). Missing planned episodes: 0.

- metric_key_mismatch: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 2 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 3 episodes.
- wrong_behavior: 1 episodes.

### R1 Broad tools

Non-error conditional success: 33.3% (n=6). Missing planned episodes: 0.

- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 2 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 2 episodes.
- required_fact_missing_or_multiple_mismatches: 2 episodes.
- unsupported_or_unassessed_fact: 1 episodes.
- wrong_behavior: 2 episodes.

### R2 Lexical documents

Non-error conditional success: 50.0% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 1 episodes.
- wrong_behavior: 1 episodes.

### R3 Managed File Search

Non-error conditional success: 66.7% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 1 episodes.
- wrong_behavior: 1 episodes.

### R4 Custom hybrid

Non-error conditional success: 50.0% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 1 episodes.
- wrong_behavior: 1 episodes.

### R5 Jev reranking

Non-error conditional success: 50.0% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 1 episodes.
- wrong_behavior: 1 episodes.

### R6 Wren analytics

Non-error conditional success: 66.7% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- wrong_behavior: 1 episodes.

### R7 LLM verifier

Non-error conditional success: 33.3% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 2 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- required_scope_or_unit_mismatch: 1 episodes.
- unsupported_or_unassessed_fact: 2 episodes.
- wrong_behavior: 1 episodes.

### R8 Jev verifier

Non-error conditional success: 50.0% (n=6). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 1 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 1 episodes.
- wrong_behavior: 1 episodes.

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
