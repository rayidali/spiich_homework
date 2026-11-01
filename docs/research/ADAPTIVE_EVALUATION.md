# Comparing complete financial-chat executions

**Protocol v1, prepared before provider calls.** Execution status and results belong in [the adaptive walkthrough](../ADAPTIVE_CHAT.md) and [build log](../BUILD_LOG.md); this source-bound protocol is preserved after execution. This is a new comparison of the current product routes, not a continuation of an older study. The existing category experiment still supports retaining Gemini for the narrow category selector. Its score says nothing about this new chat route.

## Question and control

Does letting the assistant inspect actual results before choosing its next query improve useful, correct answers over planning all queries in advance?

- **Control: `composable`.** The current default chooses a complete validated read/calculation plan before seeing results. It may use the existing single schema-repair attempt.
- **Candidate: `adaptive`.** The same application can inspect results, then select another read or exact calculation. Three total provider attempts include any schema repair; at most two inspection rounds and four unique queries are allowed.

Both call the actual `financialChat` function, the same Gemini 3.5 Flash-Lite provider adapter, the same restricted PostgreSQL runtime role and the same calculator. Both receive identical messages and chart/ledger data. Each question's route order alternates to reduce first-route ordering effects. The routes differ in available tools, instructions and maximum attempts; this measures the complete configurations, not the causal effect of one isolated prompt sentence. Provider randomness remains uncontrolled. Explicit dates avoid differences caused by relative-date interpretation across runs.

## New cases and independent expected answers

The new synthetic books and questions contain four development scenarios and sixteen held-out scenarios. Each held-out family has four cases:

1. Common direct financial questions.
2. Questions that require discovering an identity before a later read.
3. Arithmetic or combined grouping.
4. Missing-information and refusal boundaries.

Every scenario runs once per route: eight development and 32 held-out executions. Paired cases are the sampling unit; provider attempts and multiple outputs are not extra independent observations. Questions, expected account/date/counterparty scope, exact amounts and formulas are saved before provider calls. Expected answers are never sent to the model.

The fixture has independently specified journal lines and worked totals, plus refunds, drafts and another workspace's decoy records. Its loader verifies stored lines and posted balance rules. The scorer compares effective account identities and filters as well as amounts: a wrong query that coincidentally returns the expected number fails. Legitimately equivalent tool choices can pass. Calculation grading checks the selected source facts and formula, not just the final number. Required answers must all be present; incorrect extra financial claims fail.

The cases and scorer are internally AI-authored and reviewed. They are purpose-built synthetic tests, not independently sampled customer traffic or a human-accountant certification. The held-out split is untouched by provider trials and must not be used to tune this version. Development calibrates execution and scoring; its observations never enter held-out accuracy. Changing runtime, cases or scoring after calls requires a disclosed new version, not rewriting previous failures.

## What counts as success

The primary outcome is **structured task success out of all sixteen held-out questions**, separately for each route. Also report the four family counts and these distinct outcomes:

- Correct supported answer, including exact values and requested scope/formula.
- Wrong financial answer or unsupported extra financial claim.
- Safe but incomplete/no answer to an answerable question.
- Correct clarification/refusal for a case that requires it.
- Execution/provider error.
- Wording needing review where a structured check cannot establish its meaning.

An answerable question does not pass merely because the system refuses safely. A vague clarification cannot automatically pass a specific missing-information test. Keep subjective wording review separate from the frozen automatic score. The retained response and evidence must allow later inspection without assuming the score is infallible.

Report paired wins/losses, disagreement counts, exploratory uncertainty and the exact paired test where applicable. Sixteen scenarios are too few to establish universal accuracy. Report latency, provider attempts, repair frequency and tracked cost alongside correctness; adapter accounting adds measured overhead to both routes. Do not pool the old authored/composable study, category study, regressions or engineering test counts with this cohort.

The candidate qualifies for a separate hosted acceptance only if it has at least two net additional held-out successes, preserves every control success in the common family, and introduces no additional wrong financial answer or hard-boundary violation. Even a passing screen does not automatically promote the route or prove unrestricted question coverage. Failure or inconclusive evidence leaves the current default in place and identifies the next repair.

## Execution, preservation and spending

The workflow `.github/workflows/adaptive-evaluation.yml` is manual-only. It verifies the exact commit and source fingerprint, rejects reruns or another dispatch of the same phase, and uses a disposable database named `daybook_adaptive_eval_v1`. It applies the existing checksummed migrations without altering production books. Development must complete at the same source before holdout admission; its results are reviewed before the separate holdout dispatch.

The new cohort `adaptive-loop-20261031-v1` has a **$0.50 tracked allowance**: $0.10 / 20 maximum attempts for development and $0.40 / 80 for holdout. These are separate phase allocations within one ceiling, not automatic refills. Earlier cohorts stay closed. The standard-rate estimate uses $0.30 per million input tokens and $2.50 per million output tokens including thinking, verified on 2026-10-31 against [Google's pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite). Provider invoices, remaining account balance and unrelated product traffic are outside this ledger.

A sequential evaluator installs a Gemini-only fetch wrapper before importing the real application. It reserves estimated money durably **before each actual request**, including repairs and follow-ups, enforces the real 4,000-output-token cap, and settles usage before returning the provider response. Request UTF-8 bytes plus framing allowance give a conservative input reservation; this is a tracked estimate, not an external billing guarantee. Unknown usage retains the full reservation and stops further calls. HTTP/infrastructure failure halts the phase. Known invalid model plans remain failed observations. No automatic retry, cohort reset or key/model rotation is permitted.

The wrapper permits only the pinned provider URL and credential, rejects redirects and stores no credential headers or raw provider error bodies. A dedicated GitHub secret is available only to the live evaluation step. Key bindings remain private. The runner captures complete synthetic responses, source hashes, per-attempt accounting and before/after account/journal fingerprints. Failed and partial runs upload artifacts too. The real loop runs in one process with real database reads, preserving the application's shared deadlines and snapshot checks; it does not use the old first-plan-then-replay runner.

This comparison does not exercise Express request admission, the browser or production hosting. Those retain separate engineering evidence. General real-world interpretation, longitudinal correction retrieval, production load and universal correctness remain outside what this small experiment can prove.
