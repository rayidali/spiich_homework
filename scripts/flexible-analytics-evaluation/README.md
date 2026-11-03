# Flexible analysis acceptance: prepared, not approved or executed

This is a new **22-case / 26-user-turn development acceptance** for generated financial analyses. It follows the independently authored `acceptance-design.md`, retains every difficult case, and uses the unmodified independent Python exact-fraction oracle. Developers have read the cases, so this is not a blinded holdout. An actual model score does not exist yet.

The existing 31-case / 35-turn conversation suite is separate. Do not combine these correlated development conversations with old 23/31, 6/10, 3/5 or 2/2 results, or substitute this new suite for broader regression coverage.

## Before execution

1. The reviewed `workflow-template.yml` is installed as `.github/workflows/flexible-analytics-evaluation.yml`. Freeze the candidate, runner, all 22 cases and fixture in one exact commit. Run normal CI and the provider-free scorer/runner tests. Independently validate the fresh fixture in CI; no local production database is allowed.
2. `node --import tsx scripts/flexible-analytics-evaluation/workflow.ts prepare` prints the source binding and a **proposed** maximum of $0.30. It authorizes nothing. The full existing 31-case run retains its own separate proposed $0.20 approval and permit.
3. Only after explicit user approval, create a private `flexible-analytics-approval-v1` permit satisfying `approvalSchema`. It binds the exact source commit/hash, Gemini key hash, a new random artifact-key hash, all 22 case IDs in order, business date 2026-11-03, model `gemini-3.5-flash-lite`, composable route, 26 user requests, 52 maximum generation attempts, 4,000 output/thinking tokens, request byte limit, declared rates, and a maximum ceiling of $0.30. The operator records the real approval and expiry, never a fabricated authorization. The 48-hour expiry is checked before every model/count dispatch.
4. Use fresh private secrets `FLEXIBLE_ACCEPTANCE_APPROVAL`, `FLEXIBLE_ACCEPTANCE_ARTIFACT_KEY`, `FLEXIBLE_ACCEPTANCE_GEMINI_KEY`, plus dispatch inputs matching the permit bytes. Only local CLI authentication should be used to configure them. Never put keys in chat, public logs, source or a submission archive.
5. Dispatch once from reviewed main. The workflow refuses reruns, verifies the complete workflow history for reused cohort names, checks source bytes against the Git commit, verifies authenticated encryption, migrates a fresh PostgreSQL service and validates the stored fixture before any model call. Only loopback `daybook_flexible_live`, distinct owner/runtime users and an initially empty database are accepted. There is no resume/reset command.

`workflow-template.yml` and its installed counterpart are identical. Neither has executed a model run. `prepare` requires the installed counterpart because the exact workflow is part of the source binding.

## What is actually executed

The application receives actual questions and its actual previous assistant messages, including poor clarifications. A clarification is never replaced by a scripted successful one. Calls use the production `financialChat` path with frozen as-of date; real generated queries/programs execute over the synthetic PostgreSQL fixture. The application model never receives expected values or grader requirements.

The unchanged `EvaluationTransport` owns all reservations, generation tracking, optional token-count preflights, redacted requests/responses and stop conditions. The proposed permit may explicitly select `gemini_count_tokens_plus_2048`; this retains the 4,000 output reserve and known/unknown accounting rules. A cost ceiling is a conservative tracked estimate, not a guaranteed invoice bound. Unknown usage, a pending request, source/key changes or a changed ledger stops further work. Every attempt and failure remains in a new exclusive cohort directory; historical cohorts are untouched.

The fixture uses exact integer cents, balanced separate postings, signed refunds, zero months, a future-dated posting, a same-workspace draft and a different workspace sentinel. Actual stored lines and independent SQL annual/YTD totals are checked first. Fingerprints include all organizations, accounts, journals and lines before, after every user turn and at closure. The runner never truncates or deletes books.

## Scoring and review

The automatic checker independently replays source rows from the frozen journal fixture using integer cents, checks visible evidence references, exact output fractions, displayed rounding, signed/undefined values, required rows and ranking order. It rejects a wrong denominator, missing month, zero substituted for zero division, wrong source period/status/workspace/counterparty, unbound display values and input tables presented in place of requested computation. These scorer mutations are tested before a model run.

Automatic results are `verified`, `failed`, `needs_review`, or `not_applicable`; they are **not conversation passes**. No overall pass or accuracy is assigned by the runner. All actual transcripts, extra figures, numerator/denominator meaning, source filters, formula semantics, labels, clarification behavior and causal claims require a separate independent review. Unsupported legacy evidence shapes receive `needs_review`, never automatic success. Full conversation passes require all turns to pass review, including intermediate clarifications. Original automatic outcomes must remain alongside review adjudications.

The checker does not execute generated code to verify itself and does not use product report totals as its oracle. Program execution proves that a calculation ran; it does not prove that the model understood the user. Mathematical equality alone can miss a coincidentally correct wrong formula, so semantic/source review is mandatory. This is bounded development evidence, not universal reliability, production readiness or proof of million-user capacity.

## Retention and offline checks

Only AES-256-GCM ciphertext and a sanitized receipt leave CI. This reuses the unchanged existing encrypted-artifact codec; its legacy `conversation` wrapper label is encoding metadata, not a reopened old run. An `always()` encryption step preserves failures, incomplete runs, unknown reservations and original automatic outcomes. Keep the private decryption key locally, remove temporary GitHub secrets after closure, and retain the original artifacts.

Provider-free checks:

```sh
npx vitest run tests/flexible-analytics-evaluation.test.ts
npm run typecheck
```

A fresh migrated CI database may be checked with `workflow.ts check-db`; it seeds once and deliberately refuses any populated store. Run it in a separate disposable CI service from a later paid evaluation. Do not call it before `run` against the same database.
