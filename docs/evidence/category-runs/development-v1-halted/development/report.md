# Category learning comparison — development

INCOMPLETE: remaining slots are missing, not successful. No architecture or provider selection is justified by this snapshot.

Run: `category-learning-20261031-v1`; source: `24f54f82e5c958930bc8ff090ceb811e77582dd9bb7cd56c13057bc6a0d1dfdd`.

| Selector | Category + taught preference | All model opportunities | Whole input handling (includes code gates) | Errors / missing | Tracked USD |
|---|---:|---:|---:|---:|---:|
| reference | 0/9 (0.0%) | 0/15 | 0/18 | 0 / 17 | 0 |
| gemini | 0/9 (0.0%) | 0/15 | 0/18 | 1 / 17 | 0.0002571 |
| jev | 0/9 (0.0%) | 0/15 | 0/18 | 0 / 18 | 0 |

Jev minus Gemini: 0.0%; paired interval 0.0% to 0.0% across 3 category scenario groups. Intervals are exploratory and unadjusted. Cost-per-correct-category reduction: N/A.

Decision: **NO_SELECTION_INCOMPLETE_DEVELOPMENT_OR_UNVERIFIED**. A passed statistical screen still requires separate workflow acceptance; this report does not verify posting or complete journals.

## Learning after corrections

- reference: taught-preference adoption gain 0.0% across 1 teaching groups; handling gain 0.0% across 6 groups.
- gemini: taught-preference adoption gain 0.0% across 1 teaching groups; handling gain 0.0% across 6 groups.
- jev: taught-preference adoption gain 0.0% across 1 teaching groups; handling gain 0.0% across 6 groups.

## Context actually prepared

Review events, eligible input records after fixture projection, and examples retained by the real snapshot builder are distinct counts. Counts use correction / history order. These are synthetic fixture projections, not measured database retrieval. Prepared examples are not sent when a local gate stops a request; missing attempts do not imply transmission. Synthetic example IDs and snapshot hashes are in the JSON report.

| Case | Review events | Eligible input C / H | Prepared C / H | Execution scope |
|---|---:|---:|---:|---|
| repeat-paper-dev:c0 | 0 | 0 / 1 | 0 / 1 | Model opportunity |
| repeat-paper-dev:c1 | 1 | 1 / 1 | 1 / 1 | Model opportunity |
| repeat-paper-dev:c3 | 3 | 3 / 1 | 3 / 1 | Model opportunity |
| unseen-pens-dev:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| unseen-pens-dev:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| unseen-pens-dev:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| changed-camera-dev:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| changed-camera-dev:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| changed-camera-dev:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| meaning-invoice-dev:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| meaning-invoice-dev:c1 | 1 | 1 / 0 | 0 / 0 | Model opportunity |
| meaning-invoice-dev:c3 | 3 | 3 / 0 | 0 / 0 | Model opportunity |
| missing-party-dev:c0 | 0 | 0 / 0 | 0 / 0 | Local gate |
| missing-party-dev:c1 | 1 | 1 / 0 | 1 / 0 | Local gate |
| missing-party-dev:c3 | 3 | 3 / 0 | 3 / 0 | Local gate |
| evidence-injection-dev:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| evidence-injection-dev:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| evidence-injection-dev:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |

## Limits

- Synthetic AI-authored cases and labels; no independent human adjudication or production accuracy claim.
- The three correction states are paired hypothetical contexts, not independent users or longitudinal training.
- Curated eligible context is supplied equally; this does not measure database retrieval quality.
- Reference rules and local input gates are not paid model capabilities.
- The selector does not generate journals. Exact journal, posting and end-to-end workflow correctness remain unmeasured here.
- Provider/network latency is distinct from orchestration-inclusive wall time; missing measurements are not zero.
- No automatic routing or production adoption follows from this report. Workflow integration evidence is required separately.
