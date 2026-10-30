# Common-capability subgroup, version 1

Defined **2026-10-30 during the development pilot and before held-out execution**. This is a supplementary, descriptive comparison of ordinary tasks within the original R0 interface. The whole-benchmark six-family macro score remains the primary result. No episode outcomes were used to choose membership, and this document reports no subgroup performance.

The machine-readable definition is [common-capabilities-v1.json](common-capabilities-v1.json). It lists all 60 scenario groups, both question IDs in each group, split/family, inclusion or exclusion, capability, and a rationale. It also records SHA-256 hashes of the exact baseline, route-dispatch, and question files inspected. These documents are separate from the frozen runtime and do not change model prompts, reference labels, scoring, or the running pilot.

## Why this subgroup exists

Suppose a new calculator knows multiplication while the old one knows only addition. Testing both on multiplication measures the benefit of the new capability, but does not tell us whether the new calculator still performs ordinary addition well. Both questions matter.

Here, the whole benchmark measures broad useful coverage. The common-capability subgroup asks whether the more elaborate routes perform the existing, answerable accounting tasks well. It therefore excludes tasks that require a document reader, a new analytical operator, a second composed query, or a response that is necessarily clarification/refusal. Those excluded tasks remain in the primary benchmark and safety reporting.

Membership means **the requested capability is expressible through R0's implemented interface**. It does not mean R0 chose the right tool, returned the right schema, passed source validation, or successfully answered. All provider errors, incorrect answers, unnecessary blocks, and missing runs still count according to the normal reporting rules.

## Selection rule and inspected sources

The rule is to include a complete, ordinary, fully specified request whose required output can be supplied by one of R0's fixed financial tools or its review-only proposal endpoint. Both paraphrases must satisfy that rule; whole groups remain together. We do not infer capability from a lucky match in a limited result set, knowledge of a reference value, or a correct observed response.

Only these sources were consulted for membership:

- [R0 implementation](../../research/baseline.ts): four financial tools, clarification, proposal instructions, concrete output adapters, limits, and currency behavior.
- [Route implementation](../../research/routes.ts): the R0 dispatch and shared control boundary.
- [Question texts and group metadata](../../research/fixtures/questions.json): what each request actually requires.

No financial reference answers, expected behavior labels, document contents, ledger rankings, or pilot/held-out episode correctness were used to decide membership. The author previously helped create the fixtures and review the scorer; this is **not** independent blind annotation or external preregistration. The timing is a documented development-stage amendment before holdout, not a claim that this exact list existed before all development work.

R0 supplies these capabilities:

| Interface            | Available output                                                                                 | Relevant limit                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `cash_position`      | Total cash and individual cash accounts as of one date, at stored USD carrying value             | No native-currency balance, arbitrary liability, or receivable balance                     |
| `expense_summary`    | Total expense for one date range and the five largest expense accounts                           | No account filter, monthly grouping, or multiple-period expense comparison                 |
| `revenue_comparison` | Revenue totals for two ranges, dollar change, and percentage change                              | Revenue only; no customer filter/grouping or composed expense calculation                  |
| `find_transactions`  | Matching posted entries, returned count, and individual journal totals                           | Bounded results; no duplicate analysis, customer revenue total, or post-search aggregation |
| Entry proposal       | Review-only balanced lines from supplied transaction details and chart, with exact amounts/rates | Cannot retrieve company policies or invent missing FX rates                                |
| Clarification        | Ask for missing information or unsupported capabilities                                          | Handled in the full benchmark; excluded from the answerable subgroup                       |

The existing question set contains no ordinary stand-alone transaction-search question or straightforward two-period revenue comparison. Therefore this subgroup does not measure every feature of the original interface. We preserve the existing benchmark rather than adding favorable examples after development has started.

## Frozen included groups

There are **15 groups and 30 questions**: 18 development questions and 12 held-out questions. The held-out subset contains only **six scenario groups**, three financial and three entry groups. At the planned three repetitions, it yields 36 episodes per route; repetitions do not create 36 independent scenarios.

| Group        | Split       | Question IDs                       | R0 capability                                            |
| ------------ | ----------- | ---------------------------------- | -------------------------------------------------------- |
| financial-01 | Development | `financial-01-1`, `financial-01-2` | Total booked USD cash at one date                        |
| financial-02 | Development | `financial-02-1`, `financial-02-2` | Current period revenue supplied by revenue comparison    |
| financial-03 | Development | `financial-03-1`, `financial-03-2` | Total posted expenses for one period                     |
| financial-06 | Held-out    | `financial-06-1`, `financial-06-2` | Total booked USD cash at one date                        |
| financial-07 | Held-out    | `financial-07-1`, `financial-07-2` | Current period posted revenue                            |
| financial-09 | Held-out    | `financial-09-1`, `financial-09-2` | Total expenses at stored USD amounts                     |
| analytics-03 | Development | `analytics-03-1`, `analytics-03-2` | Top three accounts are contained in the ordered top five |
| entry-01     | Development | `entry-01-1`, `entry-01-2`         | Complete supplies purchase paid by bank                  |
| entry-02     | Development | `entry-02-1`, `entry-02-2`         | Receipt settling an already-recorded customer invoice    |
| entry-03     | Development | `entry-03-1`, `entry-03-2`         | Complete bank-funded rent payment                        |
| entry-04     | Development | `entry-04-1`, `entry-04-2`         | Software purchase using company credit card              |
| entry-05     | Development | `entry-05-1`, `entry-05-2`         | Explicit loan-principal repayment                        |
| entry-07     | Held-out    | `entry-07-1`, `entry-07-2`         | Payment of an already-recorded supplier payable          |
| entry-08     | Held-out    | `entry-08-1`, `entry-08-2`         | Owner capital contribution                               |
| entry-09     | Held-out    | `entry-09-1`, `entry-09-2`         | Foreign-currency travel with explicit booking rate       |

Single-period revenue is included because the requested value is an explicit output of `revenue_comparison`, even though that tool also produces a comparison. Whether a model selects sensible arguments or its extra claims pass validation remains part of measured performance. Top-three expense ranking is included because the tool returns an ordered top-five list; we do not treat that as support for every named expense account.

## Exclusions and ambiguous boundaries

| Group(s)                                                                       | Reason for exclusion                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| financial-04                                                                   | Profit requires revenue, expense, and subtraction; no R0 tool supplies it.                                                                                   |
| financial-05, financial-10                                                     | Receivable/loan balances are outside the cash-only balance interface.                                                                                        |
| financial-08                                                                   | Requires both native EUR and base USD; R0 returns base USD only.                                                                                             |
| analytics-01, analytics-02, analytics-07                                       | Require account-specific multi-period expense calculations or monthly grouping.                                                                              |
| analytics-04, analytics-09                                                     | Require customer/channel revenue filtering or grouping.                                                                                                      |
| analytics-05                                                                   | Named Travel account may fall outside the top five; inclusion cannot depend on inspecting actual rankings.                                                   |
| analytics-06                                                                   | Requires receivable and payable balances.                                                                                                                    |
| analytics-08                                                                   | Requires vendor purchases separated by expense versus capital asset, with settlement exclusion. Search journal totals do not supply that analysis.           |
| analytics-10                                                                   | Search supplies individual postings, but the requested aggregate expense and possible duplicate amount require additional calculation/interpretation.        |
| documents-01 through documents-10                                              | Require specific contractual/policy evidence; R0 has no document retrieval.                                                                                  |
| scenario-01 through scenario-09                                                | Require documents, their interpretation, and/or broader scenario calculations. Partial cash information is insufficient.                                     |
| entry-06                                                                       | Explicitly requires the company's capitalization policy. General equipment knowledge cannot verify the requested company policy.                             |
| entry-10, scenario-10                                                          | Explicitly missing FX rate or hiring assumptions; clarification is appropriate capability handling, not a fully specified answerable task.                   |
| adversarial-01, adversarial-02, adversarial-07, adversarial-09                 | Missing transaction/tax context, guaranteed future values, or unavailable live FX tools. Keep these uncertainty tests in the whole benchmark.                |
| adversarial-03, adversarial-04, adversarial-05, adversarial-06, adversarial-10 | Forbidden access/writes, destructive instructions, malicious attachments, or secrets. Keep all security gates; these are not normal capabilities to fulfill. |
| adversarial-08                                                                 | Requests counting a draft as posted revenue. This is a test of resistance to a false accounting premise, not an ordinary supported revenue question.         |

In particular, **excluded does not mean an error is acceptable**. A safe system must still clarify or refuse when appropriate. Those obligations remain measured in the whole benchmark and security analysis, and hard-gate violations are never erased by filtering to the common subgroup.

The `adversarial-01` wording resembles an incomplete entry request, but the actual R0 study dispatch sends the adversarial family through its query/clarification endpoint. We record that boundary rather than assuming the proposal endpoint was exercised.

## Reporting contract for the later postprocessor

Filter each route by the static `selectedQuestionIds` for the requested split, preserving the original scores and outcomes. Do not change the list after looking at success rates. Do not replace failed requests with successful retries, suppress unsupported responses, or reinterpret a reference label for this subgroup.

Report subgroup successful/planned/measured episodes, micro success, provider error rate, missing episodes, and per-family results. Compare routes on the same question/repeat pairs. If an observed-family macro is shown, label which families it covers. **Do not label the held-out subgroup's two-family macro as the primary six-family macro.** Missing document/scenario/adversarial families are outside this subgroup, not zero performance.

Paired uncertainty must cluster both paraphrases and repetitions by scenario group, as in the whole benchmark. Six held-out groups provide weak precision: intervals may be unstable or degenerate. Label them exploratory and unadjusted, preserve paired/unpaired counts, and do not infer broad superiority from a favorable interval. Keep the whole-benchmark score and hard-gate status beside any subgroup result.

The mapping itself contains only the static definition. The separate analyzer has produced a diagnostic supplement for the initial development pilot; that run remains ineligible because of its known validity defects and incomplete subgroup coverage. The analyzer stores the mapping file's SHA-256 in its output so every result can be traced to this pre-holdout definition.

## Independent postprocessor

The implementation lives outside the frozen inference runtime in [scripts/analyze-common-capabilities.ts](../../scripts/analyze-common-capabilities.ts). Run it after the primary report and raw episode log describe the same snapshot:

```sh
node --import tsx scripts/analyze-common-capabilities.ts docs/evidence/research-runs/holdout-v1
```

It writes `common-capabilities/common-capabilities.json`, `report.md`, `success.svg`, and `analysis-provenance.json` beneath the run directory. The command reuses preserved primary scores rather than silently rescoring with later labels. It cross-checks raw episode identity/metadata, rejects duplicates and stale report/log pairs, preserves errors and blocks, reports missing versus unscheduled cases, and propagates whole-run route hard gates. It requires full primary benchmark coverage, verified ledger-and-corpus fingerprints, complete subgroup measurements, and valid membership-source hashes before comparative eligibility.

The comparison source hashes come from that run's `source-manifest.json`, not whichever runtime file happens to be on disk later. Current question metadata must still match the definition. Baseline or question hash changes make the analysis diagnostic; they cannot be waived through a route-file amendment.

If an explicitly reviewed route-file change leaves the defined R0 capability boundary intact, a second argument may identify a separate amendment JSON with these fields:

```json
{
  "schemaVersion": 1,
  "mappingId": "daybook-common-capabilities-v1",
  "file": "research/routes.ts",
  "definitionSha256": "exact original routes.ts SHA-256 from the mapping",
  "comparisonSha256": "exact routes.ts SHA-256 from the compared run",
  "reviewedAt": "ISO timestamp of the actual review",
  "rationale": "Explain the reviewed change and why subgroup capability membership remains valid."
}
```

This is a format example, not an approved amendment. The analyzer accepts only the exact hash pair, retains the amendment in its output, and records its hash in analysis provenance. Without that artifact, route-source drift stays visibly diagnostic and ineligible. A changed capability boundary requires a new subgroup definition before examining the new held-out outcomes.

Fifteen provider-free tests cover subgroup counts, unequal-family denominators, errors/blocks, missing/unscheduled work, hard gates outside the subgroup, snapshot gates, exact amendment binding, unwaivable baseline/question drift, stale/duplicate logs, mapping integrity, superseding validity notices, and standalone escaped SVG output. They passed together with TypeScript validation on 2026-10-30. These are analysis checks, not measured model performance.

The analyzer also reads an adjacent `validity-notice.json`. A negative notice overrides the original report's mechanical eligibility flag. Its run ID and original-results digest must bind to the input report; an unbound notice also forces diagnostic status. Original scores remain preserved.

The [reviewed v2 route-source amendment](common-capabilities-amendment-v2.json) binds the original capability definition to the corrected development runtime's exact route-file hash. It confirms that baseline tools, question texts, and subgroup membership are unchanged; the R0 evidence adapter and broader planner contracts were corrected. This membership review does not validate or rescore the initial pilot. Pass this artifact only when analyzing a run with that exact reviewed route hash.
