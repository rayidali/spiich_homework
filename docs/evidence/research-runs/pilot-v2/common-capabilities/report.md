# Common-capability analysis: pilot-v2

**Diagnostic only — ineligible for comparative conclusions.** Incomplete measurements, unverified primary integrity, or membership-source changes must be resolved.

Split: development. Fixed subgroup: 18 questions / 9 groups. Questions scheduled in this run: 4.

**Post-run validity notice:** Incomplete development pilot with a diagnosed transport race and pre-holdout control-protocol limitation. Bound to this original report: yes. Allows selection: NO.
- DAILY_PROVIDER_QUOTA: The run stopped at 101 of 108 planned episodes after four Gemini HTTP 429 daily free-tier quota responses and the persisted unknown-usage circuit opened. Seven episodes were not attempted. The provider identified a 500-request per-day, per-project, per-model quota. No retry replaced an outcome.
- INFERRED_COMPLETION_READ_RACE: R6 first cash episode reported RESEARCH_HTTP_FAILURE although its completed curl footer later showed HTTP 200 and exit 0. A non-atomic completion-file read is the supported explanation; the exact partial bytes were not captured. Original outcome and unknown-use reservation remain unchanged. A complete footer marker and partial-file regression tests are being added after this run.
- CONTROL_METADATA_PROTOCOL: A pre-holdout code audit found R0 has no model-output fields or advertised vocabulary for required clarification/assumption tags. This is a structural limitation of the measurement adapter; the selected pilot does not establish how corrected clarification metadata will perform. The next development revision normalizes output metadata without adding financial tools, retrieval or a second model call.
This partial development record supports debugging and failure analysis, not architecture selection or a held-out accuracy claim. Source and full scoped ledger/document fingerprints were unchanged during the run. Missing attempts, provider failures and safe blocks stay visible; no winner is selected.

| Route | Measured / full planned | Success / measured | Micro | Observed-family macro | Families | Errors | Missing planned / unscheduled | Hard gate |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| R0 | 4/18 | 4/4 | 100.0% | 100.0% | financial, entry | 0 | 0/14 | None recorded |
| R1 | 4/18 | 4/4 | 100.0% | 100.0% | financial, entry | 0 | 0/14 | None recorded |
| R2 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |
| R3 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 1 | 0/14 | None recorded |
| R4 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |
| R5 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |
| R6 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 1 | 0/14 | None recorded |
| R7 | 4/18 | 4/4 | 100.0% | 100.0% | financial, entry | 0 | 0/14 | None recorded |
| R8 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |

Observed-family macro is not the primary six-family score. All hard gates from the whole run apply even when the offending question is outside this subgroup.

## Paired exploratory effects

| Contrast | Paired episodes / groups | Difference | Unadjusted 95% group interval | Unpaired |
| --- | ---: | ---: | --- | ---: |
| H1: R1 − R0 | 4/4 | 0.0 pp | 0.0 to 0.0 pp | 0 |
| H2: R2 − R1 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| H3a: R3 − R2 | 4/4 | 0.0 pp | -50.0 to 50.0 pp | 0 |
| H3b: R3 − R4 | 4/4 | 0.0 pp | -50.0 to 50.0 pp | 0 |
| H4: R4 − R2 | 4/4 | 0.0 pp | 0.0 to 0.0 pp | 0 |
| H5: R5 − R4 | 4/4 | 0.0 pp | 0.0 to 0.0 pp | 0 |
| H6: R6 − R4 | 4/4 | 0.0 pp | -50.0 to 50.0 pp | 0 |
| H7a: R7 − R4 | 4/4 | 25.0 pp | 0.0 to 50.0 pp | 0 |
| H7b: R8 − R4 | 4/4 | 0.0 pp | 0.0 to 0.0 pp | 0 |
| Descriptive: R2 − R0 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| Descriptive: R3 − R0 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| Descriptive: R4 − R0 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| Descriptive: R5 − R0 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| Descriptive: R6 − R0 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| Descriptive: R7 − R0 | 4/4 | 0.0 pp | 0.0 to 0.0 pp | 0 |
| Descriptive: R8 − R0 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |

## Membership-source provenance

| File | Status | Definition SHA-256 | Comparison-run SHA-256 |
| --- | --- | --- | --- |
| research/baseline.ts | match | 121b44bbac184669ce0d269b4d95d99f48e4d5c905f49cfc5d4c83d81897c648 | 121b44bbac184669ce0d269b4d95d99f48e4d5c905f49cfc5d4c83d81897c648 |
| research/routes.ts | reviewed_amendment | 8e493da705b890190bd52c366ec0e0c8788f7f849f4eca804036527c1a2af1e5 | 23a1e3848d2fa6263339f3b3a8b8d0213c39240d1dd4cbeef4e2f0a9910a579b |
| research/fixtures/questions.json | match | 42b7671906526fe7790f2aa443c0d6c904eceadb041ee406e0b0027b1a2fbfb6 | 42b7671906526fe7790f2aa443c0d6c904eceadb041ee406e0b0027b1a2fbfb6 |

Reviewed amendment for research/routes.ts: 2026-10-30T22:27:14.076153+00:00; Reviewed the corrected development route implementation before pilot-v2 and held-out execution. R0 still dispatches to the same unchanged baseline.ts financial tools or entry-proposal interface, with the same query scope, native/base currency limits, proposal capabilities and single model call. The R0 branch now attaches scoped user evidence and runs the shared validator to materialize deterministic calculation citations and expose validation metadata; this repairs provenance measurement and applies the mandatory gate without adding a retrieval or analytical capability. Other routes now expose only their permitted planner backend schema, typed Wren columns and clearer planning instructions. These changes do not alter which question requests the unchanged R0 tool interface can express. All 15 included and 45 excluded scenario groups therefore retain their version-1 membership; observed successes were not used to revise the subgroup.

## Limits

- Supplementary common-answerable subgroup; the whole-benchmark six-family macro remains primary. No winner is selected by this analyzer.
- All recorded errors and blocks remain in subgroup denominators; missing and unscheduled episodes are separate. No candidate was selected using observed correctness.
- The fixed held-out subgroup has 12 questions in six scenario groups, covering financial and entry families only. Repetitions and paraphrases are not independent observations.
- Observed-family macro averages only families with measurements; it is not a six-family macro. Always read family counts and missing coverage.
- Paired intervals use scenario-group blocks within families and are exploratory, unadjusted for multiple comparisons, and unstable with so few groups. A zero-width empirical interval does not imply certainty.
- Primary completion, verified ledger-and-corpus fingerprint, full subgroup coverage, and matching membership-source hashes are required for comparative eligibility. Any hard-gate violation anywhere in a route remains disqualifying.
- Changed source files are diagnostic unless an explicit reviewed amendment binds exact definition/comparison hashes. Legacy route-only amendments cannot waive baseline changes; a version-2 metadata amendment must bind both baseline and route hashes and preserve membership. Question-source changes cannot be waived.
- This postprocessor reuses the preserved primary scores after checking raw outcome identity and metadata. It does not silently rescore using a later reference or rubric version.
- An adjacent post-run validity notice supersedes mechanical completion/integrity eligibility. A notice with an unverified run/report binding also forces diagnostic status; it never silently repairs or replaces original scores.

Full per-family counts, whole-benchmark context, failure categories and interval warnings are in common-capabilities.json. success.svg is a standalone descriptive figure.
