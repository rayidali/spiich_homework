# Category learning comparison — holdout

All planned observations recorded. Integrity checks permit the predefined comparison.

Run: `category-learning-20261031-v3`; source: `00ba8a930cba107024cffe45d626500eb2308b33945a047432984e5d85fc1ce0`.

| Selector | Category + taught preference | All model opportunities | Whole input handling (includes code gates) | Errors / missing | Tracked USD |
|---|---:|---:|---:|---:|---:|
| reference | 16/33 (48.5%) | 19/42 | 31/54 | 0 / 0 | 0 |
| gemini | 33/33 (100.0%) | 42/42 | 54/54 | 0 / 0 | 0.0216731 |
| jev | 31/33 (93.9%) | 40/42 | 52/54 | 0 / 0 | 0.004771494 |

## Shared spend allowance

The score table above contains only this version and split. Earlier adapter failures remain separate historical outcomes; their costs and attempt counts still reduce the same allowance. Earlier-run totals include every verified ancestor exactly once. Current-run totals include both development and holdout of this version; cumulative totals include both. No earlier accuracy result is pooled into this version.

| Provider | Earlier runs combined attempts / USD | Current run attempts / USD | Cumulative attempts / USD | Cumulative unknown reserved USD | Fixed cap |
|---|---:|---:|---:|---:|---|
| gemini | 3 / 0.001095400000 | 57 / 0.029039700000 | 60 / 0.030135100000 | 0.000000000000 | 72 attempts / $0.50 |
| jev | 2 / 0.000188076000 | 57 / 0.006430410000 | 59 / 0.006618486000 | 0.000000000000 | 72 attempts / $0.03 |

Jev minus Gemini: -6.1%; paired interval -18.2% to 0.0% across 11 category scenario groups. Intervals are exploratory and unadjusted. Cost-per-correct-category reduction uses this version's split only: 76.6%.

Decision: **RETAIN_GEMINI_WITHIN_SELECTOR_SCOPE**. A passed statistical screen still requires separate workflow acceptance; this report does not verify posting or complete journals.

## Learning after corrections

- reference: taught-preference adoption gain 100.0% across 5 teaching groups; handling gain 11.1% across 18 groups.
- gemini: taught-preference adoption gain 60.0% across 5 teaching groups; handling gain 0.0% across 18 groups.
- jev: taught-preference adoption gain 40.0% across 5 teaching groups; handling gain -5.6% across 18 groups.

## Context actually prepared

Review events, eligible input records after fixture projection, and examples retained by the real snapshot builder are distinct counts. Counts use correction / history order. These are synthetic fixture projections, not measured database retrieval. Prepared examples are not sent when a local gate stops a request; missing attempts do not imply transmission. Synthetic example IDs and snapshot hashes are in the JSON report.

| Case | Review events | Eligible input C / H | Prepared C / H | Execution scope |
|---|---:|---:|---:|---|
| repeat-paper:c0 | 0 | 0 / 1 | 0 / 1 | Model opportunity |
| repeat-paper:c1 | 1 | 1 / 1 | 1 / 1 | Model opportunity |
| repeat-paper:c3 | 3 | 3 / 1 | 3 / 1 | Model opportunity |
| repeat-cloud:c0 | 0 | 0 / 1 | 0 / 1 | Model opportunity |
| repeat-cloud:c1 | 1 | 1 / 1 | 1 / 1 | Model opportunity |
| repeat-cloud:c3 | 3 | 3 / 1 | 3 / 1 | Model opportunity |
| repeat-promotion:c0 | 0 | 0 / 1 | 0 / 1 | Model opportunity |
| repeat-promotion:c1 | 1 | 1 / 1 | 1 / 1 | Model opportunity |
| repeat-promotion:c3 | 3 | 3 / 1 | 3 / 1 | Model opportunity |
| unseen-software:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| unseen-software:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| unseen-software:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| unseen-advert:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| unseen-advert:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| unseen-advert:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| unseen-consulting-receipt:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| unseen-consulting-receipt:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| unseen-consulting-receipt:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| changed-laptop:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| changed-laptop:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| changed-laptop:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| changed-app:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| changed-app:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| changed-app:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| changed-ad-placement:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| changed-ad-placement:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| changed-ad-placement:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| meaning-loan:c0 | 0 | 0 / 0 | 0 / 0 | Local gate |
| meaning-loan:c1 | 1 | 1 / 0 | 0 / 0 | Local gate |
| meaning-loan:c3 | 3 | 3 / 0 | 0 / 0 | Local gate |
| meaning-refund:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| meaning-refund:c1 | 1 | 1 / 0 | 0 / 0 | Model opportunity |
| meaning-refund:c3 | 3 | 3 / 0 | 0 / 0 | Model opportunity |
| meaning-transfer:c0 | 0 | 0 / 0 | 0 / 0 | Local gate |
| meaning-transfer:c1 | 1 | 1 / 0 | 1 / 0 | Local gate |
| meaning-transfer:c3 | 3 | 3 / 0 | 3 / 0 | Local gate |
| missing-purpose:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| missing-purpose:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| missing-purpose:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |
| missing-currency:c0 | 0 | 0 / 0 | 0 / 0 | Local gate |
| missing-currency:c1 | 1 | 1 / 0 | 0 / 0 | Local gate |
| missing-currency:c3 | 3 | 3 / 0 | 0 / 0 | Local gate |
| missing-fx:c0 | 0 | 0 / 0 | 0 / 0 | Local gate |
| missing-fx:c1 | 1 | 1 / 0 | 0 / 0 | Local gate |
| missing-fx:c3 | 3 | 3 / 0 | 0 / 0 | Local gate |
| evidence-conflict:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| evidence-conflict:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| evidence-conflict:c3 | 3 | 1 / 0 | 1 / 0 | Model opportunity |
| evidence-stale:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| evidence-stale:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| evidence-stale:c3 | 3 | 1 / 0 | 1 / 0 | Model opportunity |
| evidence-foreign:c0 | 0 | 0 / 0 | 0 / 0 | Model opportunity |
| evidence-foreign:c1 | 1 | 1 / 0 | 1 / 0 | Model opportunity |
| evidence-foreign:c3 | 3 | 3 / 0 | 3 / 0 | Model opportunity |

## Limits

- Synthetic AI-authored cases and labels; no independent human adjudication or production accuracy claim.
- The three correction states are paired hypothetical contexts, not independent users or longitudinal training.
- Curated eligible context is supplied equally; this does not measure database retrieval quality.
- Reference rules and local input gates are not paid model capabilities.
- The selector does not generate journals. Exact journal, posting and end-to-end workflow correctness remain unmeasured here.
- Provider/network latency is distinct from orchestration-inclusive wall time; missing measurements are not zero.
- No automatic routing or production adoption follows from this report. Workflow integration evidence is required separately.
