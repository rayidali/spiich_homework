# Comparative study: statistical and scoring review

Reviewed **2026-10-30, before the scored development pilot and held-out run**. This is a source/protocol review with deterministic regression tests. It is not an independent human audit of the synthetic labels, a review of answer prose, or a result from the live nine-route experiment.

## What the comparison measures

The primary outcome is **structured task success**: the answer must use the declared behavior, public metric vocabulary, correct decimal values and scope, required evidence, applicable assumptions/clarification tags, and exact proposed entry lines. Provider/tool errors remain failed episodes. A correct amount with the wrong public metric key is a protocol failure, not automatically a numerical accounting error. The scorer preserves `required_fact_mismatch` and adds specific diagnostics for metric-key, numeric-value, text-value, scope/unit, or missing/multiple mismatches.

Automated rubric scores stop at 90: factual 40, completion 20, grounding 20, uncertainty 10. Human clarity remains unavailable, as does the combined 100-point score. A model that emits a correct tag and contradictory prose can still pass a structured check; `narrativeReviewed` remains false. Neither the score nor a correctly formatted citation proves that every sentence is supported.

The nine routes share the synthetic ledger, authorized document corpus, scoped reader, question split, public answer protocol, inference model/settings, and deterministic validation. The study model is Gemini 3.5 Flash-Lite. R0 reproduces the existing application's tool architecture with normalized study inference and fixture context; it is not a byte-identical measurement of the deployed 3.1 model. Absolute scores also reflect each route's supported capabilities.

## Controls and comparability

The report now exposes the nine predeclared contrasts directly, rather than substituting only comparisons with R0 or R4:

| Hypothesis | Treatment minus control | Interpretation                                          |
| ---------- | ----------------------- | ------------------------------------------------------- |
| H1         | R1 − R0                 | Broader analytical tools                                |
| H2         | R2 − R1                 | Lexical document evidence                               |
| H3a        | R3 − R2                 | Managed source selection versus lexical retrieval       |
| H3b        | R3 − R4                 | Managed source selection versus custom hybrid retrieval |
| H4         | R4 − R2                 | Hybrid embeddings beyond lexical retrieval              |
| H5         | R5 − R4                 | Jev reranking                                           |
| H6         | R6 − R4                 | Wren semantic query integration                         |
| H7a        | R7 − R4                 | Separate LLM reviewer invocation                        |
| H7b        | R8 − R4                 | Jev reviewer                                            |

Additional R0 contrasts are labeled descriptive. Every interval is unadjusted for multiple comparisons. These are exploratory engineering effect estimates; the report makes no multiplicity-adjusted significance claim.

Managed File Search uses an additional Interactions API call to identify source citations. The harness maps those citations to authorized canonical documents for downstream evidence. Citation order is not the hidden retriever's raw rank, and the API does not expose the same passages/top-k interface as the custom retrievers. Raw-passage recall, MRR, and nDCG therefore cannot be inferred from these citations. Its additional model operation and latency belong in the treatment cost.

R6 uses the real pinned Wren engine, shared model planner, and approved data views. This integration proves monetary units for direct projections/aggregates; financial lineage through CTEs, joins, subqueries, or unions is conservatively unsupported. A resulting block measures this integration's limitation, not a general inability of Wren to execute the query.

R7 uses a separate invocation of the **same model** as the generator. Separate prompts and calls do not make its errors statistically independent. R8 also receives supplied evidence rather than oracle labels. Neither reviewer may override deterministic validation or database permissions. Non-PASS reviews withhold the answer; this implementation is not a conversational repair loop. The separate injected-error experiment is necessary for measuring false approvals and false withholding, because route-level success alone cannot explain them.

## Samples, denominators, and uncertainty

The full fixture has 120 questions in 60 scenario groups, with two paraphrases per group. Group assignment keeps paraphrases together: 60 development questions and 60 held-out questions, balanced over six families. The development pilot selects two distinct first-paraphrase scenarios per family: 12 questions × nine routes = 108 episodes. The main design uses 60 held-out questions × three repeats × nine routes = 1,620 episodes. These are planned counts, not a claim that those runs have completed.

Family macro success weights the six families equally. Micro success, conditional non-error success, error rate, family denominators, and missing planned episodes are reported separately. An empty family is unavailable, not zero or perfect accuracy. Intentional blocks remain in the non-error denominator. Exact episode IDs and question/repeat cells must be unique; repeat numbers must be integers in the planned range.

Paired effects join the same question and repeat between routes. Unmatched episodes are counted and excluded only from that paired calculation; missing coverage prevents a full-study conclusion. Bootstrap sampling resamples scenario groups **within families**, keeping both paraphrases and repeated model runs in their group. This avoids treating six responses to one scenario as six independent tasks.

There are only two scenario groups per family in the pilot and five per family in the held-out set. Empirical percentile bootstrap intervals can have poor coverage at these sizes. If every observed difference is identical, an interval may collapse to one value; this does not prove zero uncertainty about future tasks. The JSON interval includes explicit small-sample, degenerate-interval, and partial-family warnings. When any represented family has fewer than two groups, interval bounds are unavailable.

The shared ledger/corpus can create dependencies even between nominally different scenarios. Clustered intervals do not remove this limitation. All results concern this synthetic benchmark and these provider conditions, not general financial accuracy, real customer data, or million-user capacity.

## Provenance and integrity fixes

The review identified and added regression coverage for these issues before the scored pilot:

- A derived numeric claim must match the source's **unit**, including calculations. A EUR calculation cannot substantiate a USD fact merely because the numbers match.
- A purely financial calculated answer still needs actual scoped ledger provenance. A calculation node alone does not establish a database read.
- A required documentary fact must connect to a required source, directly or through declared calculation parents. Listing the correct document globally while citing an unrelated document for the fact no longer earns documentary support. Mixed answers may legitimately cite ledger evidence for their cash facts and documents for contractual facts.
- Metric-key mismatch is distinguished from a wrong numerical value without changing the frozen public vocabulary or granting an after-the-fact alias.
- The report distinguishes **episode completeness**, **snapshot integrity**, and **route hard gates**. Its default integrity status is unverified. A claimed verified snapshot requires matching valid SHA-256 fingerprints; changed or absent fingerprints make comparative selection ineligible. The runner supplies the ledger-and-corpus check, including documents and embeddings, and separately checks source-manifest drift. Any route with a hard-gate violation is excluded from eligible routes even when the overall snapshot is intact.
- Interrupted provider requests with no selected recorded episode remain visible as unassigned run usage. They are not silently treated as zero-cost requests. Setup/indexing, returned-usage estimates, and conservative unknown-usage reservations remain separate.

The source-manifest captures the evaluated working source and runtime. A published ancestor commit is described as an ancestor rather than falsely presented as the exact tested working tree. Root-level source/dependency hashes, model/threshold/index freeze, resumed-run checks, and before/after fingerprints provide the run boundary; they are not a substitute for human adjudication.

## Graph and report adequacy

The standalone HTML contains four inline SVG figures: family-macro success with group intervals, per-family success heatmap, p50/p95 episode latency, and success versus estimated/reserved cost per episode. The paired-effects table supplies the exact planned controls and uncertainty. Together they support comparison of quality, coverage, latency, and cost without external scripts or fonts.

Report banners and route status distinguish incomplete or integrity-invalid measurements. Figures remain descriptive when a route fails a hard gate; a visually attractive point is not a deployment recommendation. Latency includes harness pacing/queue delays and failed episodes and is not a concurrent-load benchmark. Cost uses configured paid-equivalent rates and unknown-usage reservations, not observed invoices or an assumption that free-tier usage costs nothing.

The current automatic report does not supply a human prose-error analysis or establish detailed semantic entailment. A final written discussion must explain important failure examples, separate schema errors from wrong money, disclose withheld/unsupported cases, and avoid choosing a winner from missing runs. It should not report retrieval rank metrics that the managed service did not expose.

## Verification evidence

After the fixes, `npx vitest run tests/research-scoring.test.ts tests/research-statistics.test.ts` passed **36 tests across two files** at 17:57:30 America/New_York on 2026-10-30. The 13 new tests cover controls, snapshot eligibility, invalid repeat indices, unassigned spend, degenerate confidence intervals, protocol-versus-numeric diagnostics, typed calculation evidence, actual ledger provenance, connected document citations, and mixed answers. `npx tsc --noEmit` passed immediately afterward.

These checks use local fixtures and mock episode records. They made no model requests, changed no database data, and do not constitute live model accuracy measurements. The root runner must preserve these reviewed source files in its final source hash and execute the planned live work before publishing comparative results.
