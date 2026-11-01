# Compact completion held-out comparison

This is cohort `compact-completion-20261101-v1`. The frozen scoring/analysis method retains its inherited version identifier. The known development smoke scored **0/3**; its operational compatibility gate allowed the predeclared held-out comparison and did not establish correctness.

# Three-route held-out comparison

Status: **complete** (48/48 executions). Sixteen paired questions. Deployment remains unchanged.

| Route      | Complete answers    | Exploratory Wilson 95% | Focus correct | Required claims matched | Detected wrong-financial flags | Detected hard-boundary flags |
| ---------- | ------------------- | ---------------------- | ------------- | ----------------------- | ------------------------------ | ---------------------------- |
| composable | 9/16 (16 observed)  | 33.2%–76.9%            | 11/16         | 22/37                   | 1                              | 0                            |
| adaptive   | 10/16 (16 observed) | 38.6%–81.5%            | 11/16         | 24/37                   | 0                              | 0                            |
| complete   | 5/16 (16 observed)  | 14.2%–55.6%            | 7/16          | 8/37                    | 0                              | 0                            |

## Family results

| Route      | Family     | Complete answers | Focus correct | Required claims matched |
| ---------- | ---------- | ---------------- | ------------- | ----------------------- |
| composable | common     | 4/4 (4 observed) | 4             | 10/10                   |
| composable | discovery  | 2/4 (4 observed) | 2             | 8/12                    |
| composable | arithmetic | 0/4 (4 observed) | 2             | 4/15                    |
| composable | boundary   | 3/4 (4 observed) | 3             | 0/0                     |
| adaptive   | common     | 4/4 (4 observed) | 4             | 10/10                   |
| adaptive   | discovery  | 2/4 (4 observed) | 2             | 8/12                    |
| adaptive   | arithmetic | 1/4 (4 observed) | 2             | 6/15                    |
| adaptive   | boundary   | 3/4 (4 observed) | 3             | 0/0                     |
| complete   | common     | 1/4 (4 observed) | 1             | 2/10                    |
| complete   | discovery  | 0/4 (4 observed) | 2             | 6/12                    |
| complete   | arithmetic | 0/4 (4 observed) | 0             | 0/15                    |
| complete   | boundary   | 4/4 (4 observed) | 4             | 0/0                     |

## Paired comparisons with composable

| Candidate | Paired questions | Candidate-only passes | Control-only passes | Net gain | Exact one-sided p | Holm-adjusted p |
| --------- | ---------------- | --------------------- | ------------------- | -------- | ----------------- | --------------- |
| adaptive  | 16               | 1                     | 0                   | 1        | 0.5               | 1               |
| complete  | 16               | 1                     | 5                   | -4       | 0.984375          | 1               |

- adaptive: not eligible; unmet gates: minimumAdditionalAnswers, allBoundaryCasesPass, holmImprovement.
- complete: not eligible; unmet gates: minimumAdditionalAnswers, noCommonRegressions, holmImprovement.

## Descriptive operations

| Route      | Attempts         | Median / p95 milliseconds     | Known USD + unknown reservations |
| ---------- | ---------------- | ----------------------------- | -------------------------------- |
| composable | 16 (16 reported) | 2188.5 / 4990.0 (16 reported) | $0.0722019 + $0 (16 reported)    |
| adaptive   | 18 (16 reported) | 2179.5 / 4469.0 (16 reported) | $0.0911901 + $0 (16 reported)    |
| complete   | 18 (16 reported) | 2700.0 / 6558.0 (16 reported) | $0.1018973 + $0 (16 reported)    |

- Sixteen synthetic question blocks; three routes are paired, not 48 independent accuracy samples.
- Wilson intervals are exploratory and do not establish production accuracy; related questions may be correlated.
- Exact paired tests condition on discordances and assume exchangeable directions across question blocks; Holm covers the two declared comparisons only.
- External scorer outcomes are analyzed as supplied. Model completion status is not a correctness label; unrestricted prose meaning is not independently judged here.
- Claim coverage and answer focus are separate from wrong financial claims. Boundary cases with no required claims have no claim-coverage denominator.
- Wrong-financial and hard-boundary counts are detected scorer flags, not an exhaustive tally of every false number; grading may stop at the first invalid row. Case counts identify affected responses.
- Cost and duration are descriptive of this execution environment, not load tests or invoice guarantees. Missing metric values are not imputed.
- Missing executions prevent eligibility. Passing this screen only identifies candidates for separate acceptance; it never selects or deploys a winner.
- Source, fixture, authorization and ledger integrity must be audited separately; this pure analyzer does not authorize spending.

Input SHA-256: `18c6ab1d31b7fc859487bc04a9327fe0815571e6316a5de57ea4083fad158d24`.
