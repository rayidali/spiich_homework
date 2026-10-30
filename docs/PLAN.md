# Delivery plan for a one-day assignment build

> Updated 2026-10-29. The user authorized implementation after the report. Gemini/OpenAI support, the new evaluation harness and simpler UI are implemented in source. Database/browser regression, Docker startup and persistence passed in CI. Live model evaluation, fresh visual review and physical-device checks remain. See the [saved checkpoint](../CHECKPOINT.md).

The highest-value submission is a complete, explainable product with defensible financial rules. The intended sequence protects that outcome before adding polish.

The [visual report](reports/architecture-review.pdf) and [interactive walkthrough](reports/architecture-review.html#plan) illustrate the proposed next iteration. Its planning allocation is **12 focused hours plus up to 4 hours of reserve**: preserve the baseline (0.5h), Gemini adapter (2.5h), live evaluation (2h), simpler UI (2h), Docker verification (2h), relevant regressions (1h), phone review/fixes (1h), and demonstration/package (1h). Use reserve time for unfinished verification before a retrieval experiment. These are estimates, contingent on provider and Docker access, not recorded work or a completion guarantee. The table below records the earlier build allocation.

| Phase                       | Budget     | Exit condition                                                                              | Status                                   |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Translate the brief         | 45 minutes | Written invariants, accounting example, explicit boundaries                                 | Complete                                 |
| Build the ledger            | 3 hours    | PostgreSQL migrations, exact money, balance/immutability guards, idempotency, reversal      | Complete                                 |
| Reports and background work | 2 hours    | Four reconciling reports; recurring drafts; durable anomaly processing                      | Complete                                 |
| AI boundary                 | 1.5 hours  | Structured entry proposals, corrections, allowlisted SQL insights, unavailable/error states | Implemented; live key evaluation pending |
| Product UI                  | 3 hours    | Dashboard and every requested workflow usable with real API data                            | Complete                                 |
| Verification and recovery   | 2 hours    | Database/concurrency tests, production browser checks, error cases, Compose config          | Complete in CI, including persistence    |
| Documentation and demo      | 1 hour     | README, architecture, walkthrough, demo script, honest verification record                  | Complete                                 |
| Daybook design revision     | Follow-up  | Independent brand, revised interface, chart data, mobile forms and focus handling           | Complete; real-device check pending      |
| Contingency                 | 2 hours    | Live model checks, clean Docker run, final rehearsal                                        | Reserved for live AI and visual review   |

These are planning allocations, not recorded durations. The build log records observed work.

## Highest-value remaining steps

1. Run the implemented Gemini smoke suite, then development cases, from a Terminal/environment that can reach PostgreSQL and Google. A local key is saved but has not been validated: the session's provider DNS failed. Inspect failures before running the reserved holdout cases. The changed PostgreSQL and browser suites passed in CI; inspect the fresh screenshots and rehearse the simpler entry flow. Do not treat isolated unit tests as live accuracy or browser-layout evidence.
2. Review the successful CI evidence for Docker startup and posted-entry persistence. Re-run relevant checks after implementation changes; hosting is a separate next step if requested.
3. Rehearse the six-minute demo. Be able to explain why the five-event example produces $12,260 profit but $22,600 cash.
4. Check the phone layout on a real device, especially the keyboard, safe areas, forms, and drawers. Browser emulation has passed; physical-device behavior is not yet verified.
5. Refresh the submission ZIP after any further code or documentation changes.
6. Spend any remaining time on a real issue found during those checks, not extra infrastructure or speculative features.

## Proposed one-to-two-day finish and comparison

The user clarified that they want to finish within one or two days because of other commitments. The role is uncertain, so the plan covers both advertised engineering roles. The baseline provider, harness and UI work below is now implemented; the current backend/browser/Docker runtime checks passed in CI. Live evaluation and retrieval comparison have not run. Source is now committed to GitHub through a separate permitted local publishing checkout; the prior ZIP remains preserved.

**First day:** preserve a stable baseline in local version control, add the Gemini adapter behind the existing provider boundary, strengthen and run bounded live evaluations, and simplify the main transaction/review flows. Reserve time to execute the Compose startup/persistence checks on a Docker-enabled host. The existing ledger, reports, database constraints, and background jobs remain the shared foundation. A functioning complete submission takes priority when a time budget expires.

**Second day, if available:** spend at most a few focused hours on one retrieval experiment, fix failures, repeat the relevant checks, and prepare the demonstration and results. Framework migration is not a prerequisite. Keep time for container verification and usability if those remain unfinished.

| Candidate                | Single change being evaluated                                                          | Question answered                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A: proposed baseline     | Gemini adapter with current PostgreSQL/text retrieval and approved financial functions | How well does the smallest complete implementation handle our cases?                                    |
| B: first challenger      | Same Gemini setup, adding lexical/vector retrieval of relevant corrections and history | Does semantic retrieval find useful examples that text search misses, and improve the final suggestion? |
| C: conditional follow-up | Add a Jev category decision/check to whichever baseline is retained                    | Does it reduce incorrect account suggestions enough to justify latency and cost?                        |

Wren is a separate experiment for broader analytical questions. It would require reviewed business definitions, organization-scoped permitted views, restricted query execution, resource limits, and evidence checks. Comparing its supported question coverage with the existing four insight families is more meaningful than bundling it with B and attributing all changes to retrieval. Mastra is an orchestration option if workflow/tracing requirements warrant it; its presence in a job description alone is not an implementation requirement.

Use one evaluation harness and configurable adapters. Use a short-lived branch/worktree for dependency-heavy experiments if needed, with an isolated test database or schema and new migrations; preserve applied migrations and the user's demo data. Keep the fixture, date/timezone, account definitions, model version/settings, tool permissions, and shared assertions fixed across candidates. Record the retrieved evidence and prompt/context versions. Only the tested component and its resulting context should vary.

Proposed initial dataset: **40 labeled cases**, with 20 for development and 20 held out. Cover 16 transaction/correction scenarios, 12 financial questions, 8 required clarifications, and 4 misleading-data or isolation cases, distributed across both splits. Include new vendors, synonymous descriptions, the same vendor serving different purposes, invoice payments already recorded as receivables, missing FX rates, date boundaries, reversals, stale examples, and descriptions containing instructions. Freeze the held-out set before tuning and repeat it three times per candidate within an explicit provider-attempt/token budget. These are small-sample engineering checks, not a production accuracy estimate.

The former eight-case script has been replaced. The new harness compares the full entry line multiset, native/base amounts, rates, date and account identities; financial questions compare exact tool arguments and structured SQL evidence. It records correction retrieval, source hashes, model/usage metadata, unchanged journals and fail-fast budgets. A clarification's nonempty question and correct routing are automated checks; its actual meaning still requires the recorded human-review rubric. The harness has not run against a live model yet.

Measure exact task success, required-clarification success, unsupported claims, wrong-category suggestions, relevant-example retrieval, provider failures, p50/p95 latency, and observed token/call cost. For corrections, compare the same case before and after storing relevant feedback. Keep numerical checks deterministic; use human review for meaning and any optional model judge only as supplementary evidence. Count unnecessary clarification as a usability cost so an assistant cannot appear correct by refusing every task.

Require no observed unconfirmed postings, invalid accepted money, or cross-organization evidence in the test suite. Report counts and failure examples, not claims of zero production risk. Accept extra infrastructure only for a repeatable improvement on the relevant cases without critical regressions, with understandable operating cost and a fallback. If there is no clear improvement, retain the simpler candidate and record what the experiment showed. No candidate has earned acceptance yet.

## What makes the submission strong

- Demonstrate a rule the database refuses to break, not only a balanced form.
- Show a retry and concurrency policy that preserves money correctly.
- Make AI suggestions reviewable and financial answers traceable to actual records.
- Let the UI reveal the source of a number and the consequences of posting.
- Explain the limits precisely: historical FX, fixed USD base, no authentication, statistical alerts, and unmeasured production capacity.
- Present the tests and tradeoffs in a form a reviewer can inspect in minutes.

A strong implementation improves the evidence a reviewer sees; it cannot guarantee a hiring decision.
