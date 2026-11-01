# Answer completeness: fresh comparison protocol

Protocol `daybook-completeness-comparison-v1`; cohort `completeness-20261101-v1`.
This document specifies an experiment. It contains no measured model results and grants no spending authorization.

## What this tests, in plain language

Imagine asking, “How much did we spend on office supplies?” The assistant replies with all company expenses and puts office supplies somewhere in a table. The numbers can be true while the answer is poor. This experiment requires the answer to address the requested subject, use the right records and finish the requested work.

An illustrative question might ask for July spending, August spending, the difference and the percentage change. Showing only the two monthly amounts is incomplete. The evaluator checks those four requirements independently. It does not ask the assistant whether it thinks it succeeded.

We compare three existing configurations using the same model, business books and questions:

| Route                  | What it does                                                                                                                       | Why compare it                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `composable` — control | Selects existing report tools or a validated query-and-calculation plan before seeing financial results.                           | Current product baseline.                                                    |
| `adaptive`             | Can inspect returned records, then select another bounded query or calculation.                                                    | Tests whether inspecting evidence helps questions that require discovery.    |
| `complete`             | Adds a frozen declaration of requested outputs, server checks and completion of supported missing arithmetic from verified inputs. | Tests whether explicitly tracking unfinished work improves complete answers. |

The third configuration combines several changes. This is a **whole-route comparison**, not an experiment isolating the effect of arithmetic generation alone. The routes have different tool interfaces and attempt limits. No separate arithmetic ablation is claimed. None can execute arbitrary model-written SQL, alter the books or create executable code.

## Sample and isolation

There are four development questions and sixteen fresh held-out questions. Each is run once through each route: **12 development and 48 held-out executions**. The independent unit is the question, not each route execution or each financial row. There are no paraphrase repeats or retries of failed executions.

Each split has equal representation of four families:

- **Common:** ordinary financial questions, including filters and follow-up context.
- **Discovery:** identify relevant records or entities before answering.
- **Arithmetic:** deliver multiple requested totals, comparisons or explicit scenarios.
- **Boundary:** ask for clarification or refuse when the request cannot safely be answered.

The synthetic workshop books cover June's opening balance and July–September 2026 activity. They include 24 accounts per workspace, 51 journals and 104 lines across two workspaces. Invoices and cash receipts differ; refunds, a later reversal, an archived cash account, draft entries, foreign-workspace decoys, saved exchange rates, equal amounts and case-distinct supplier identities prevent easy but wrong shortcuts. Questions specify calendar periods or an as-of date so results do not depend on the execution day. These are invented books, not customer documents or uploaded files.

Before held-out questions are authored, freeze the solver, evaluator, ledger, development cases and this protocol using `coreSource()`. Save the digest and timestamp in `freeze.json`. A separate collaborating agent then authors the sixteen questions and worked references. The question/scorer authors share AI tooling and project context; this is not independent human authorship. Solver and scorer authors must not inspect those questions after the freeze. Both live phases use the same final source, including the held-out data. Expected values and labels never enter provider messages.

Changing frozen core code, labels, thresholds or prices requires closing this cohort and declaring a new experiment. Development failures remain evidence; they are not quietly repaired before continuing this cohort. All older research cohorts and budgets remain closed.

## Independent expected answers

Fixture arithmetic uses integer cents and rational operations separately from the production query compiler. Handwritten PostgreSQL checks verify storage, posted-entry constraints, amounts, cash identity, reversals and scope. Mutations deliberately introduce wrong amounts, wrong accounts, wrong periods, hidden or missing calculations, unsafe claims and misleading focus. Calibration also accepts legitimate row reordering and equivalent source representations.

Each question declares its required claims, allowed supporting claims, primary subject and any list/ranking coverage. A claim describes both the value and its meaning: account, person/business, date, currency, posted/draft status and calculation ancestry. Matching a dollar amount alone is insufficient. A largest-supplier answer may show a longer ranking if the correct leader is first; a request for an entire list requires its declared coverage. Explicit equal-rank alternatives are fixed before execution.

The scorer checks visible source-linked facts. Hidden intermediate values can validate a calculation but cannot count as an answer delivered to the user. Strict adapters also recognize existing server-written report templates that predate source-linked facts, so the control is not automatically penalized for using a valid legacy tool. Unknown output formats or unverifiable extra claims are **ungradable**, not automatically correct or automatically wrong money.

Answer focus is distinct from numerical correctness. A numeric headline must match a predeclared primary claim. For a known generic nonnumeric headline, the first visible financial row must match a primary claim or the requested table. Reordering equivalent primary rows is allowed. A truthful all-expenses headline with the requested office amount buried below fails focus. A known partial, withheld or limitation headline cannot count as a complete financial answer. Unknown numeric prose is not silently accepted.

Scores never use `answerContract`, `completion.status` or the model's own completeness judgement as truth. The product's `userIntentVerified:false` remains meaningful. The deterministic grader checks recognized structured output and server-authored wording; independent human prose quality, tone and general conversational interpretation are not measured.

## Scoring and decision rules

Per execution, retain:

- Complete structured answer or correct expected clarification/refusal.
- Required claims and tables delivered, primary focus, verified and unverifiable extras.
- Wrong financial claims and hard-boundary violations, separately from omissions.
- Partial answers, execution errors and ungradable outputs as failures for the primary pass count.
- End-to-end service duration, actual attempts, known usage estimates and unknown reservations.

Report held-out pass counts by route and family. Pair each candidate with the control on the same sixteen questions. Use the exact one-sided paired binomial/McNemar test on discordant pairs and Holm correction across the two candidate comparisons at familywise alpha 0.05. Route Wilson intervals are exploratory descriptions of this small synthetic sample. Shared ledger/context, internal authorship and nonrandom question selection limit generalization; statistical significance is not a production accuracy guarantee.

To qualify for **separate acceptance work**, a candidate must meet every predeclared screen:

1. At least two additional complete answers relative to the control.
2. Holm-adjusted improvement p-value at most 0.05.
3. No wrong financial claim or hard-boundary violation anywhere in the held-out set.
4. No common-question regression versus the control.
5. All four boundary cases pass.

Missing executions disable eligibility. If both candidates qualify, report both; there is no automatic deployment or post-hoc tie-break. If neither qualifies or the result is inconclusive, retain `composable`. Costs and latency are descriptive, not secretly added to the acceptance score. A small study can expose failures and inform a decision; it cannot establish perfection or that every possible interviewer question will work.

## Execution, costs and audit trail

The proposed maximum is **$0.90**: development $0.20 and held-out $0.70. Unused development allowance does not transfer. The current standard Gemini 3.5 Flash-Lite rates used are $0.30 per million input tokens and $2.50 per million output tokens, including thinking, checked 2026-10-31 against [Google's pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite). [Model limits](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) and [project rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) do not prove an account balance or available quota.

The control allows at most two provider attempts; each candidate allows three. Totals are capped at 32 development attempts and 128 held-out attempts, including schema repairs. Each request permits at most 256 KiB and 4,000 output tokens. Pure serialization tests check request size and label separation using the actual request builder; they do **not** prove that 4,000 tokens will suffice for a live multi-output response. Truncation and provider failures count and are preserved.

Before each network request, the evaluation-only transport durably reserves a conservative byte-based input estimate plus maximum output. It validates endpoint, model, key binding, request shape, limits and response usage. Unknown usage retains its reservation and stops the run; no retry, automatic refill, model rotation, reopening or reset is allowed. Reported usage and prices are estimates, not invoices or a hard provider-side billing cap. No `countTokens` call is required.

Execution is manual GitHub Actions only, first attempt on the exact reviewed main commit. It requires a **new explicitly approved private permit** bound to source, core freeze, key digest, finite phase limits and expiry of at most seven days. Proposed protocol limits alone do not authorize spending. Separate new secrets are `COMPLETENESS_EVALUATION_APPROVAL` and `COMPLETENESS_EVALUATION_GEMINI_KEY`; they must not be installed until approval. Credentials are absent from ordinary checks and never archived.

The controller checks paginated workflow history and refuses any previous dispatch of the same phase, including failures. Holdout requires the successful immutable development artifact at the same source and permit, with closed known accounting, all twelve outcomes and unchanged books. Artifact hashes detect corruption within GitHub's provenance; they are not signatures against a privileged operator replacing both a manifest and its contents.

Each phase creates fresh synthetic organizations in an empty, explicitly named disposable database. Full organization/account/journal/line fingerprints must remain unchanged before and after every case. Request/response records, failures, source bindings, cost reservations and scores are retained in restricted artifacts. Neither production history nor existing research databases are reset. Main CI runs the new PostgreSQL fixture checks separately without provider keys.

The runner calls the real `financialChat` service. It does not measure Express request admission, hosted browser usability, physical devices, authentication, concurrency, million-user capacity or production deployment. Those require separate evidence. A JSON analysis, Markdown report and standalone SVG comparison chart are generated only from actual collected held-out observations; no illustrative score is presented as a measured result.
