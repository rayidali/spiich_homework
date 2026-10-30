# Daybook comparative architecture study

Run: pilot-v2 · Dataset: daybook-study-v1 · Split: **development** · Generated: 2026-10-30T22:29:38.194Z

**Incomplete study:** one or more routes lack planned episodes. Do not select a winner from missing measurements.

Snapshot integrity (ledger_and_corpus): **unverified**. **Ineligible for comparative selection:** measurement completeness and verified snapshot integrity are both required.

Final complete ledger/document/embedding fingerprint is pending.

## Results

| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| R0 Current control | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 1.75s / 1.75s | $0.00024 |
| R1 Broad tools | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 9.41s / 9.41s | $0.00321 |
| R2 Lexical documents | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 9.10s / 9.10s | $0.00249 |
| R3 Managed File Search | 1/12 | 0/1 (0.0%) | N/A | 0.0 | 100.0% | 27.15s / 27.15s | N/A |
| R4 Custom hybrid | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 11.03s / 11.03s | $0.00289 |
| R5 Jev reranking | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 16.63s / 16.63s | $0.00352 |
| R6 Wren analytics | 1/12 | 0/1 (0.0%) | N/A | 0.0 | 100.0% | 6.25s / 6.25s | N/A |
| R7 LLM verifier | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 13.61s / 13.61s | $0.00230 |
| R8 Jev verifier | 1/12 | 1/1 (100.0%) | N/A | 90.0 | 0.0% | 11.03s / 11.03s | $0.00309 |

Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.

## Per-family success

| Route | financial | analytics | documents | scenario | entry | adversarial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R1 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R2 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R3 | 0.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R4 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R5 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R6 | 0.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R7 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |
| R8 | 100.0% (n=1) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) | N/A (n=0) |

## Paired effects

Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.

| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |
| --- | --- | ---: | ---: | ---: | --- |
| H1 | R1 / R0 | 1 | 1 | 0.0 pp | N/A |
| H2 | R2 / R1 | 1 | 1 | 0.0 pp | N/A |
| H3a | R3 / R2 | 1 | 1 | -100.0 pp | N/A |
| H3b | R3 / R4 | 1 | 1 | -100.0 pp | N/A |
| H4 | R4 / R2 | 1 | 1 | 0.0 pp | N/A |
| H5 | R5 / R4 | 1 | 1 | 0.0 pp | N/A |
| H6 | R6 / R4 | 1 | 1 | -100.0 pp | N/A |
| H7a | R7 / R4 | 1 | 1 | 0.0 pp | N/A |
| H7b | R8 / R4 | 1 | 1 | 0.0 pp | N/A |
| Descriptive | R2 / R0 | 1 | 1 | 0.0 pp | N/A |
| Descriptive | R3 / R0 | 1 | 1 | -100.0 pp | N/A |
| Descriptive | R4 / R0 | 1 | 1 | 0.0 pp | N/A |
| Descriptive | R5 / R0 | 1 | 1 | 0.0 pp | N/A |
| Descriptive | R6 / R0 | 1 | 1 | -100.0 pp | N/A |
| Descriptive | R7 / R0 | 1 | 1 | 0.0 pp | N/A |
| Descriptive | R8 / R0 | 1 | 1 | 0.0 pp | N/A |

## Cost and usage

| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | 1 | 594 / 26 | 0 | $0.00024 | $0.00000 | $0.00024 |
| R1 | 2 | 3247 / 894 | 0 | $0.00321 | $0.00000 | $0.00321 |
| R2 | 2 | 5097 / 384 | 0 | $0.00249 | $0.00000 | $0.00249 |
| R3 | 2 | 955 / 152 | 1 | $0.00067 | $0.03458 | $0.03525 |
| R4 | 3 | 5306 / 385 | 1 | $0.00255 | $0.00033 | $0.00289 |
| R5 | 4 | 9185 / 816 | 1 | $0.00319 | $0.00033 | $0.00352 |
| R6 | 2 | 1334 / 142 | 1 | $0.00076 | $0.01679 | $0.01754 |
| R7 | 3 | 4083 / 431 | 0 | $0.00230 | $0.00000 | $0.00230 |
| R8 | 3 | 4841 / 947 | 0 | $0.00309 | $0.00000 | $0.00309 |

Separate setup/indexing: 162 calls, $0.00000 reported-use estimate and $0.04236 unknown-use reservation. Shared indexing is not charged again for every route.

Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): 0 calls, $0.00000 in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.

## Failure analysis

### R0 Current control

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


### R1 Broad tools

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


### R2 Lexical documents

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


### R3 Managed File Search

Non-error conditional success: N/A (n=0). Missing planned episodes: 11.

- episode_error: 1 episodes.

### R4 Custom hybrid

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


### R5 Jev reranking

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


### R6 Wren analytics

Non-error conditional success: N/A (n=0). Missing planned episodes: 11.

- episode_error: 1 episodes.

### R7 LLM verifier

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


### R8 Jev verifier

Non-error conditional success: 100.0% (n=1). Missing planned episodes: 11.


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
