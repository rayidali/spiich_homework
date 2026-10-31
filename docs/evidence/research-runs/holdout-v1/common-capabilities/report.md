# Common-capability analysis: holdout-v1

Measurements and source/integrity gates complete. Interpret eligible routes with the stated limitations; no winner is selected.

Split: holdout. Fixed subgroup: 12 questions / 6 groups. Questions scheduled in this run: 12.

| Route | Measured / full planned | Success / measured | Micro | Observed-family macro | Families | Errors | Missing planned / unscheduled | Hard gate |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| R0 | 36/36 | 33/36 | 91.7% | 91.7% | financial, entry | 3 | 0/0 | None recorded |
| R1 | 36/36 | 26/36 | 72.2% | 72.2% | financial, entry | 0 | 0/0 | None recorded |
| R2 | 36/36 | 23/36 | 63.9% | 63.9% | financial, entry | 0 | 0/0 | None recorded |
| R3 | 36/36 | 27/36 | 75.0% | 75.0% | financial, entry | 0 | 0/0 | None recorded |
| R4 | 36/36 | 26/36 | 72.2% | 72.2% | financial, entry | 0 | 0/0 | None recorded |
| R5 | 36/36 | 26/36 | 72.2% | 72.2% | financial, entry | 0 | 0/0 | None recorded |
| R6 | 36/36 | 25/36 | 69.4% | 69.4% | financial, entry | 1 | 0/0 | None recorded |
| R7 | 36/36 | 24/36 | 66.7% | 66.7% | financial, entry | 0 | 0/0 | None recorded |
| R8 | 36/36 | 24/36 | 66.7% | 66.7% | financial, entry | 0 | 0/0 | None recorded |

Observed-family macro is not the primary six-family score. All hard gates from the whole run apply even when the offending question is outside this subgroup.

## Paired exploratory effects

| Contrast | Paired episodes / groups | Difference | Unadjusted 95% group interval | Unpaired |
| --- | ---: | ---: | --- | ---: |
| H1: R1 − R0 | 36/6 | -19.4 pp | -38.9 to 2.8 pp | 0 |
| H2: R2 − R1 | 36/6 | -8.3 pp | -19.4 to 0.0 pp | 0 |
| H3a: R3 − R2 | 36/6 | 11.1 pp | 2.8 to 19.4 pp | 0 |
| H3b: R3 − R4 | 36/6 | 2.8 pp | 0.0 to 8.3 pp | 0 |
| H4: R4 − R2 | 36/6 | 8.3 pp | 2.8 to 13.9 pp | 0 |
| H5: R5 − R4 | 36/6 | 0.0 pp | 0.0 to 0.0 pp | 0 |
| H6: R6 − R4 | 36/6 | -2.8 pp | -13.9 to 5.6 pp | 0 |
| H7a: R7 − R4 | 36/6 | -5.6 pp | -11.1 to 0.0 pp | 0 |
| H7b: R8 − R4 | 36/6 | -5.6 pp | -11.1 to 0.0 pp | 0 |
| Descriptive: R2 − R0 | 36/6 | -27.8 pp | -44.4 to -2.8 pp | 0 |
| Descriptive: R3 − R0 | 36/6 | -16.7 pp | -25.0 to 0.0 pp | 0 |
| Descriptive: R4 − R0 | 36/6 | -19.4 pp | -33.3 to 0.0 pp | 0 |
| Descriptive: R5 − R0 | 36/6 | -19.4 pp | -33.3 to 0.0 pp | 0 |
| Descriptive: R6 − R0 | 36/6 | -22.2 pp | -47.2 to 2.8 pp | 0 |
| Descriptive: R7 − R0 | 36/6 | -25.0 pp | -44.4 to -2.8 pp | 0 |
| Descriptive: R8 − R0 | 36/6 | -25.0 pp | -44.4 to -2.8 pp | 0 |

## Membership-source provenance

| File | Status | Definition SHA-256 | Comparison-run SHA-256 |
| --- | --- | --- | --- |
| research/baseline.ts | reviewed_amendment | 121b44bbac184669ce0d269b4d95d99f48e4d5c905f49cfc5d4c83d81897c648 | b9754ba93f289ac28e3f5f9e941169af90757a57202a62dd679ed275f16d63c8 |
| research/routes.ts | reviewed_amendment | 8e493da705b890190bd52c366ec0e0c8788f7f849f4eca804036527c1a2af1e5 | a15b95bae25212c8a69c4fa7604f42c7910a775334579e73978cc386bb8a7b35 |
| research/fixtures/questions.json | match | 42b7671906526fe7790f2aa443c0d6c904eceadb041ee406e0b0027b1a2fbfb6 | 42b7671906526fe7790f2aa443c0d6c904eceadb041ee406e0b0027b1a2fbfb6 |

Reviewed amendment for research/baseline.ts: 2026-10-31T01:21:06.248083+00:00; Development smoke v3 exposed asymmetric date/identity evidence metadata. Before any held-out evaluation, normalize proved row scope across the unchanged control tools and custom/Wren backends, and apply shared strict qualifier checks. All 15 selected groups and 45 excluded groups retain their original membership; prompts, questions and reference labels are unchanged. This binds the corrected source without rescoring or validating earlier runs.
Reviewed amendment for research/routes.ts: 2026-10-31T01:21:06.248083+00:00; Development smoke v3 exposed asymmetric date/identity evidence metadata. Before any held-out evaluation, normalize proved row scope across the unchanged control tools and custom/Wren backends, and apply shared strict qualifier checks. All 15 selected groups and 45 excluded groups retain their original membership; prompts, questions and reference labels are unchanged. This binds the corrected source without rescoring or validating earlier runs.

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
