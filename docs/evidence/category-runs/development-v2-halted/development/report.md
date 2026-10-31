# Category learning comparison — development

INCOMPLETE: remaining slots are missing, not successful. No architecture or provider selection is justified by this snapshot.

Run: `category-learning-20261031-v2`; source: `4ae49bce1d51137581614b41b2248b9a5a7117f3740b75b195cc0d293ba498df`.

| Selector | Category + taught preference | All model opportunities | Whole input handling (includes code gates) | Errors / missing | Tracked USD |
|---|---:|---:|---:|---:|---:|
| reference | 0/9 (0.0%) | 0/15 | 0/18 | 0 / 17 | 0 |
| gemini | 1/9 (11.1%) | 2/15 | 2/18 | 0 / 16 | 0.0008383 |
| jev | 0/9 (0.0%) | 1/15 | 1/18 | 1 / 16 | 0.000188076 |

## Shared spend allowance

The score table above contains only this version and split. The earlier adapter failure remains a separate historical outcome; its cost and attempt count still reduce the same allowance. Current-run totals include both development and holdout of this version; cumulative totals also include the reviewed predecessor. No earlier accuracy result is pooled into this version.

| Provider | Predecessor attempts / USD | Current run attempts / USD | Cumulative attempts / USD | Cumulative unknown reserved USD | Fixed cap |
|---|---:|---:|---:|---:|---|
| gemini | 1 / 0.000257100000 | 2 / 0.000838300000 | 3 / 0.001095400000 | 0.000000000000 | 72 attempts / $0.50 |
| jev | 0 / 0.000000000000 | 2 / 0.000188076000 | 2 / 0.000188076000 | 0.000000000000 | 72 attempts / $0.03 |

Jev minus Gemini: -11.1%; paired interval -33.3% to 0.0% across 3 category scenario groups. Intervals are exploratory and unadjusted. Cost-per-correct-category reduction uses this version's split only: N/A.

Decision: **NO_SELECTION_INCOMPLETE_DEVELOPMENT_OR_UNVERIFIED**. A passed statistical screen still requires separate workflow acceptance; this report does not verify posting or complete journals.

## Learning after corrections

- reference: taught-preference adoption gain 0.0% across 1 teaching groups; handling gain 0.0% across 6 groups.
- gemini: taught-preference adoption gain 0.0% across 1 teaching groups; handling gain -16.7% across 6 groups.
- jev: taught-preference adoption gain 0.0% across 1 teaching groups; handling gain -16.7% across 6 groups.

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
