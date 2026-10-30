# Common-capability analysis: pilot-v1

**Diagnostic only — ineligible for comparative conclusions.** Incomplete measurements, unverified primary integrity, or membership-source changes must be resolved.

Split: development. Fixed subgroup: 18 questions / 9 groups. Questions scheduled in this run: 4.

**Post-run validity notice:** Development pilot with known adapter and operational defects. Bound to this original report: yes. Allows selection: NO.
- CONTROL_EVIDENCE_ADAPTER: R0 omitted the shared validation/user-evidence adapter, causing valid proposals and derived calculations to be penalized for missing provenance. Original generations and scores are retained; this is not evidence that the production baseline cannot make those proposals.
- PLANNER_BACKEND_GRAMMAR: Both query backend fields were exposed in one grammar. Wren repeatedly selected custom plans that the backend gate correctly rejected. A later development version exposes only the permitted backend schema and actual typed Wren columns.
- DISPATCH_STARTUP_GAPS: Three early route requests expired during manual-to-continuous dispatcher transition. These are harness errors, not established provider outages. The continuously logged319requests all returnedHTTP200.
Complete unchanged data proves measurement coverage/integrity only. These known defects make this pilot unsuitable for selecting an architecture. No held-out questions were used to make the fixes.

| Route | Measured / full planned | Success / measured | Micro | Observed-family macro | Families | Errors | Missing planned / unscheduled | Hard gate |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| R0 | 4/18 | 0/4 | 0.0% | 0.0% | financial, entry | 1 | 0/14 | None recorded |
| R1 | 4/18 | 2/4 | 50.0% | 50.0% | financial, entry | 1 | 0/14 | None recorded |
| R2 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |
| R3 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |
| R4 | 4/18 | 4/4 | 100.0% | 100.0% | financial, entry | 0 | 0/14 | None recorded |
| R5 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |
| R6 | 4/18 | 2/4 | 50.0% | 50.0% | financial, entry | 2 | 0/14 | None recorded |
| R7 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 1 | 0/14 | None recorded |
| R8 | 4/18 | 3/4 | 75.0% | 75.0% | financial, entry | 0 | 0/14 | None recorded |

Observed-family macro is not the primary six-family score. All hard gates from the whole run apply even when the offending question is outside this subgroup.

## Paired exploratory effects

| Contrast | Paired episodes / groups | Difference | Unadjusted 95% group interval | Unpaired |
| --- | ---: | ---: | --- | ---: |
| H1: R1 − R0 | 4/4 | 50.0 pp | 0.0 to 100.0 pp | 0 |
| H2: R2 − R1 | 4/4 | 25.0 pp | 0.0 to 50.0 pp | 0 |
| H3a: R3 − R2 | 4/4 | 0.0 pp | -50.0 to 50.0 pp | 0 |
| H3b: R3 − R4 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| H4: R4 − R2 | 4/4 | 25.0 pp | 0.0 to 50.0 pp | 0 |
| H5: R5 − R4 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| H6: R6 − R4 | 4/4 | -50.0 pp | -50.0 to -50.0 pp | 0 |
| H7a: R7 − R4 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| H7b: R8 − R4 | 4/4 | -25.0 pp | -50.0 to 0.0 pp | 0 |
| Descriptive: R2 − R0 | 4/4 | 75.0 pp | 50.0 to 100.0 pp | 0 |
| Descriptive: R3 − R0 | 4/4 | 75.0 pp | 50.0 to 100.0 pp | 0 |
| Descriptive: R4 − R0 | 4/4 | 100.0 pp | 100.0 to 100.0 pp | 0 |
| Descriptive: R5 − R0 | 4/4 | 75.0 pp | 50.0 to 100.0 pp | 0 |
| Descriptive: R6 − R0 | 4/4 | 50.0 pp | 50.0 to 50.0 pp | 0 |
| Descriptive: R7 − R0 | 4/4 | 75.0 pp | 50.0 to 100.0 pp | 0 |
| Descriptive: R8 − R0 | 4/4 | 75.0 pp | 50.0 to 100.0 pp | 0 |

## Membership-source provenance

| File | Status | Definition SHA-256 | Comparison-run SHA-256 |
| --- | --- | --- | --- |
| research/baseline.ts | match | 121b44bbac184669ce0d269b4d95d99f48e4d5c905f49cfc5d4c83d81897c648 | 121b44bbac184669ce0d269b4d95d99f48e4d5c905f49cfc5d4c83d81897c648 |
| research/routes.ts | match | 8e493da705b890190bd52c366ec0e0c8788f7f849f4eca804036527c1a2af1e5 | 8e493da705b890190bd52c366ec0e0c8788f7f849f4eca804036527c1a2af1e5 |
| research/fixtures/questions.json | match | 42b7671906526fe7790f2aa443c0d6c904eceadb041ee406e0b0027b1a2fbfb6 | 42b7671906526fe7790f2aa443c0d6c904eceadb041ee406e0b0027b1a2fbfb6 |


## Limits

- Supplementary common-answerable subgroup; the whole-benchmark six-family macro remains primary. No winner is selected by this analyzer.
- All recorded errors and blocks remain in subgroup denominators; missing and unscheduled episodes are separate. No candidate was selected using observed correctness.
- The fixed held-out subgroup has 12 questions in six scenario groups, covering financial and entry families only. Repetitions and paraphrases are not independent observations.
- Observed-family macro averages only families with measurements; it is not a six-family macro. Always read family counts and missing coverage.
- Paired intervals use scenario-group blocks within families and are exploratory, unadjusted for multiple comparisons, and unstable with so few groups. A zero-width empirical interval does not imply certainty.
- Primary completion, verified ledger-and-corpus fingerprint, full subgroup coverage, and matching membership-source hashes are required for comparative eligibility. Any hard-gate violation anywhere in a route remains disqualifying.
- A changed route file is diagnostic unless an explicit reviewed amendment binds the definition hash to the compared-run hash. Baseline/question source mismatches cannot be waived through that amendment.
- This postprocessor reuses the preserved primary scores after checking raw outcome identity and metadata. It does not silently rescore using a later reference or rubric version.
- An adjacent post-run validity notice supersedes mechanical completion/integrity eligibility. A notice with an unverified run/report binding also forces diagnostic status; it never silently repairs or replaces original scores.

Full per-family counts, whole-benchmark context, failure categories and interval warnings are in common-capabilities.json. success.svg is a standalone descriptive figure.
