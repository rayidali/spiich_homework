# Daybook comparative architecture study

Run: pilot-v2 · Dataset: daybook-study-v1 · Split: **development** · Generated: 2026-10-30T22:47:12.168Z

**Incomplete study:** one or more routes lack planned episodes. Do not select a winner from missing measurements.

Snapshot integrity (ledger_and_corpus): **verified**. **Ineligible for comparative selection:** measurement completeness and verified snapshot integrity are both required.

## Results

| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| R0 Current control | 11/12 | 4/11 (36.4%) | 33.3% | 40.3 | 27.3% | 3.36s / 18.55s | $0.00325 |
| R1 Broad tools | 11/12 | 5/11 (45.5%) | 41.7% | 51.2 | 0.0% | 9.22s / 21.09s | $0.00522 |
| R2 Lexical documents | 12/12 | 6/12 (50.0%) | 50.0% | 58.6 | 8.3% | 9.40s / 11.44s | $0.00662 |
| R3 Managed File Search | 12/12 | 5/12 (41.7%) | 41.7% | 54.2 | 16.7% | 14.08s / 27.15s | $0.01573 |
| R4 Custom hybrid | 11/12 | 6/11 (54.5%) | 50.0% | 63.9 | 0.0% | 11.03s / 14.60s | $0.00596 |
| R5 Jev reranking | 11/12 | 5/11 (45.5%) | 41.7% | 57.3 | 0.0% | 13.78s / 31.84s | $0.00720 |
| R6 Wren analytics | 11/12 | 6/11 (54.5%) | 50.0% | 54.5 | 18.2% | 9.18s / 13.87s | $0.00862 |
| R7 LLM verifier | 11/12 | 6/11 (54.5%) | 50.0% | 67.3 | 0.0% | 14.54s / 25.38s | $0.00647 |
| R8 Jev verifier | 11/12 | 5/11 (45.5%) | 41.7% | 50.0 | 9.1% | 14.71s / 16.86s | $0.00983 |

Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.

## Per-family success

| Route | financial | analytics | documents | scenario | entry | adversarial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 100.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 100.0% (n=2) | 0.0% (n=1) |
| R1 | 100.0% (n=2) | 50.0% (n=2) | 0.0% (n=2) | 0.0% (n=2) | 100.0% (n=2) | 0.0% (n=1) |
| R2 | 100.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 0.0% (n=2) |
| R3 | 50.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 0.0% (n=2) |
| R4 | 100.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 0.0% (n=1) |
| R5 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 0.0% (n=1) |
| R6 | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 0.0% (n=1) |
| R7 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 0.0% (n=1) |
| R8 | 100.0% (n=2) | 0.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 0.0% (n=1) |

## Paired effects

Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.

| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |
| --- | --- | ---: | ---: | ---: | --- |
| H1 | R1 / R0 | 11 | 11 | 8.3 pp | N/A |
| H2 | R2 / R1 | 11 | 11 | 8.3 pp | N/A |
| H3a | R3 / R2 | 12 | 12 | -8.3 pp | -25.0 to 8.3 pp |
| H3b | R3 / R4 | 11 | 11 | -8.3 pp | N/A |
| H4 | R4 / R2 | 11 | 11 | 0.0 pp | N/A |
| H5 | R5 / R4 | 11 | 11 | -8.3 pp | N/A |
| H6 | R6 / R4 | 11 | 11 | 0.0 pp | N/A |
| H7a | R7 / R4 | 11 | 11 | 0.0 pp | N/A |
| H7b | R8 / R4 | 11 | 11 | -8.3 pp | N/A |
| Descriptive | R2 / R0 | 11 | 11 | 16.7 pp | N/A |
| Descriptive | R3 / R0 | 11 | 11 | 8.3 pp | N/A |
| Descriptive | R4 / R0 | 11 | 11 | 16.7 pp | N/A |
| Descriptive | R5 / R0 | 11 | 11 | 8.3 pp | N/A |
| Descriptive | R6 / R0 | 11 | 11 | 16.7 pp | N/A |
| Descriptive | R7 / R0 | 11 | 11 | 16.7 pp | N/A |
| Descriptive | R8 / R0 | 11 | 11 | 8.3 pp | N/A |

## Cost and usage

| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 11 | 9150 / 1511 | 1 | $0.00652 | $0.00646 | $0.01298 |
| R1 | 22 | 33680 / 6405 | 0 | $0.02612 | $0.00000 | $0.02612 |
| R2 | 23 | 43642 / 6849 | 1 | $0.03022 | $0.00948 | $0.03969 |
| R3 | 28 | 75023 / 8632 | 1 | $0.04409 | $0.03458 | $0.07867 |
| R4 | 28 | 47476 / 7815 | 6 | $0.03378 | $0.00201 | $0.03579 |
| R5 | 36 | 74590 / 8992 | 7 | $0.03367 | $0.00234 | $0.03601 |
| R6 | 25 | 40549 / 4724 | 6 | $0.02397 | $0.02774 | $0.05172 |
| R7 | 38 | 53022 / 8490 | 5 | $0.03713 | $0.00168 | $0.03881 |
| R8 | 37 | 62004 / 7899 | 7 | $0.03077 | $0.01838 | $0.04915 |

Separate setup/indexing: 162 calls, $0.00000 reported-use estimate and $0.04236 unknown-use reservation. Shared indexing is not charged again for every route.

Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): 0 calls, $0.00000 in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.

## Failure analysis

### R0 Current control

Non-error conditional success: 50.0% (n=8). Missing planned episodes: 1.

- episode_error: 3 episodes.
- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_document_evidence: 3 episodes.
- missing_ledger_provenance: 1 episodes.
- required_fact_mismatch: 4 episodes.
- required_fact_missing_or_multiple_mismatches: 4 episodes.

### R1 Broad tools

Non-error conditional success: 45.5% (n=11). Missing planned episodes: 1.

- metric_key_mismatch: 2 episodes.
- missing_assumption: 2 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 4 episodes.
- missing_ledger_provenance: 2 episodes.
- required_fact_mismatch: 5 episodes.
- required_fact_missing_or_multiple_mismatches: 3 episodes.
- unsupported_or_unassessed_fact: 2 episodes.
- wrong_behavior: 3 episodes.

### R2 Lexical documents

Non-error conditional success: 54.5% (n=11). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 1 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 2 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 2 episodes.
- wrong_behavior: 2 episodes.

### R3 Managed File Search

Non-error conditional success: 50.0% (n=10). Missing planned episodes: 0.

- deterministic_validation_failed: 1 episodes.
- episode_error: 2 episodes.
- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- required_fact_mismatch: 2 episodes.
- required_fact_missing_or_multiple_mismatches: 2 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 1 episodes.

### R4 Custom hybrid

Non-error conditional success: 54.5% (n=11). Missing planned episodes: 1.

- deterministic_validation_failed: 2 episodes.
- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 2 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 2 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 2 episodes.
- wrong_behavior: 2 episodes.

### R5 Jev reranking

Non-error conditional success: 45.5% (n=11). Missing planned episodes: 1.

- deterministic_validation_failed: 2 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 2 episodes.

### R6 Wren analytics

Non-error conditional success: 66.7% (n=9). Missing planned episodes: 1.

- episode_error: 2 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_ledger_provenance: 2 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 2 episodes.
- unsupported_or_unassessed_fact: 2 episodes.

### R7 LLM verifier

Non-error conditional success: 54.5% (n=11). Missing planned episodes: 1.

- metric_key_mismatch: 1 episodes.
- missing_assumption: 1 episodes.
- missing_clarification_topic: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- required_fact_mismatch: 2 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
- unsupported_or_unassessed_fact: 3 episodes.
- wrong_behavior: 1 episodes.

### R8 Jev verifier

Non-error conditional success: 50.0% (n=10). Missing planned episodes: 1.

- deterministic_validation_failed: 1 episodes.
- episode_error: 1 episodes.
- metric_key_mismatch: 2 episodes.
- missing_assumption: 1 episodes.
- missing_document_evidence: 1 episodes.
- missing_ledger_provenance: 3 episodes.
- proposal_line_mismatch: 1 episodes.
- required_fact_mismatch: 3 episodes.
- required_fact_missing_or_multiple_mismatches: 1 episodes.
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
