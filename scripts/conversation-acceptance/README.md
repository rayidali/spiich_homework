# Opt-in conversation acceptance runner

This runner exercises the current application's `financialChat` against the new [31-case development specification](../../tests/conversation-acceptance/README.md). It is **prepared, not executed**. It does not reopen a historical study, reuse its allowance or claim a blinded scientific comparison. The current runner supports one declared `composable` candidate, exactly35 planned user turns and at most70 provider attempts including schema repairs.

It uses the real application, a new disposable migrated PostgreSQL database and the existing Gemini provider adapter. Model responses are saved privately and become the next turn's actual context. The shared UI helper includes any labeled general explanation in that context. A failed request is retained as an outcome; subsequent context rolls back to the previous conversation, matching the UI. No ideal assistant answer is substituted and no failed request is rerun. Every conversation starts fresh.

## Preparation without connections or spending

```sh
node --import tsx scripts/conversation-acceptance/cli.ts prepare
```

This only reads source files and prints a preparation record. It does not load keys, connect to PostgreSQL or contact a provider. It is deliberately not a valid spending approval.

The preparation binds all server/shared code, migrations, new acceptance fixtures, runner/tests, the reused transport and package configuration. Execution additionally compares every bound file with the exact approved Git commit. Uncommitted bytes or later source changes stop execution.

## PostgreSQL verification without inference

Create and migrate a **new** local database named `daybook_conversation_<unique suffix>` with the existing migration command. Do not use the application database, named Compose data volume or a previously seeded fixture database. Configure separate owner and non-superuser runtime URLs in `CONVERSATION_OWNER_DATABASE_URL` and `CONVERSATION_DATABASE_URL`, and its name in `CONVERSATION_DATABASE_NAME`. Allowed database hosts are localhost, loopback or the Docker service `postgres`.

```sh
NODE_ENV=test node --import tsx scripts/conversation-acceptance/cli.ts check-db .tools/conversation-fixture-check.json
```

The optional receipt path must be inside `.tools/` and must not already exist. The command requires an empty organization table and the exact applied migration checksums. It inserts a fresh synthetic organization, verifies28 stored lines and10 independently specified SQL totals, and confirms an unchanged snapshot after its reads. The EUR purchase is native EUR200 at stored1.10 FX, producing USD220 base expense. The runtime identity must differ from the owner and cannot have superuser, create-role or create-database privileges. Connections are closed; no provider module is invoked. This database remains seeded as evidence and will be refused by a later execution: use another fresh database for that run.

## Explicitly approved execution

After implementation and database checks, an operator can prepare a private JSON approval using the strict schema in `protocol.ts`. Required bindings include a unique cohort ID, exact source commit/hash, Gemini key hash, fresh database name, approval/expiry times, fixed business date, pinned model and all request/attempt/price limits. The `authorization` field records a real user approval; writing that field is not itself authorization. Supply the exact SHA256 of the approved file on the command line. Never put an API key or database URL in that JSON or in chat.

With the Gemini key and two dedicated database URLs available privately in the process environment:

```sh
NODE_ENV=test node --import tsx scripts/conversation-acceptance/cli.ts execute .tools/conversation-approval.json APPROVED_FILE_SHA256
```

`node --env-file=.env --import tsx ...` may be used if the key is in the local ignored file. The runner explicitly replaces application database/provider settings before importing application code; a production `DATABASE_URL` from `.env` is not used. The business date is passed through the server-only `asOfDate` option; the system clock and public HTTP API are unchanged.

The output directory is exclusively created at `.tools/conversation-acceptance-runs/<cohort>`. An existing directory cannot be reopened. It stores approval/source bindings, raw provider requests and responses without auth headers, durable attempt reservations, actual turn outcomes, book fingerprints and a closure record. Raw artifacts remain private. No GitHub secret installation, workflow dispatch, provider call or deployment is triggered by preparation or tests.

## Manual remote path

[conversation-acceptance.yml](../../.github/workflows/conversation-acceptance.yml) provides the same execution on a fresh PostgreSQL service when local PostgreSQL is unavailable. It has **only** a manual `workflow_dispatch` trigger and is separate from ordinary CI. It is not dispatched by this implementation.

Before any execution, the operator must have explicit approval and privately install three separate temporary secrets: `CONVERSATION_ACCEPTANCE_APPROVAL`, `CONVERSATION_ACCEPTANCE_GEMINI_KEY` and `CONVERSATION_ACCEPTANCE_ARTIFACT_KEY`. The last is a random256-bit key represented by64 lowercase hexadecimal characters; its string SHA256 is included as `artifactKeySha256` in the permit. The key must be retained privately to decrypt results and never appears in artifacts. The provider key is exposed only to the execution step, after all checks, tests and migrations. The private permit must name the service database `daybook_conversation_live`.

The dispatch inputs are `cohort`, `source_commit`, `source_hash` and `approval_sha256`, each matched against the permit. The checked-out commit must equal the reviewed source, the run must target main, and `GITHUB_RUN_ATTEMPT` must be1. The cohort is part of the explicit run name. Concurrency serializes its runs; the helper also reads complete workflow history and allows only the earliest run ID with that cohort name. Earlier failed or cancelled runs still consume the cohort. Missing current-run history, inconsistent totals, duplicate pages, API errors or history beyond the bounded ten-page scan fail closed. Deleting historical runs would undermine this history boundary; the operator must preserve them. It is not an independent external replay registry.

Before the provider key is made available, AES-256-GCM encryption/decryption is roundtrip-tested with the exact artifact key, source commit and GitHub run ID. The unchanged artifact codec is reused with `phase=development` as encoding metadata; a new encrypted wrapper receipt explicitly identifies this acceptance run and prevents it being confused with an old study. On success or failure, retained raw outcomes, provider errors, cost reservations and workflow receipts are encrypted into `.tools/conversation-encrypted/`. Upload includes **only** `artifact.json` ciphertext and a sanitized receipt containing the archive digest and binding. No plaintext response, approval, key or database URL is uploaded. Approval expiry does not prevent encrypting already retained failure evidence.

Do not rerun the GitHub job, reset a failed cohort or delete its history to bypass the earliest-run check. After retrieving and verifying the encrypted artifacts, the operator should remove all three temporary secrets while keeping the private artifact key and original records. The workflow itself cannot delete secrets and does not claim to have done so.

## Spending controls and limitations

The proposed **new** ceiling is **$0.20**, subject to explicit approval. The model is pinned to `gemini-3.5-flash-lite` at the verified standard-rate estimates of$0.30 per million input tokens and$2.50 per million output tokens including thinking. [Official pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite). This is not an account balance or an invoice guarantee.

The unchanged `completion-repair-evaluation/transport.ts` is reused as an accounting component in a completely new directory. Its internal format name reflects its origin, not reopening that cohort. Before every provider dispatch it durably reserves the cost of actual UTF-8 request bytes plus2,048 framing tokens and4,000 output/thinking tokens. Requests are capped at262,144 bytes. The largest permitted single-attempt reservation is **$0.0892576**. Successful reported usage replaces the reservation; unknown usage retains its full reservation and halts the new runner before another turn. Expired approval/source drift is checked both before each application turn and immediately before every network dispatch, including internal repair calls. If the latter check fails after reservation, that reservation remains conservatively charged.

The dollar ceiling may stop execution **before all35 turns finish**. No completeness promise, automatic refill, model rotation, cohort reset or best-of retry is implied. HTTP auth/quota/rate failures stop the transport. A budget, source, state, book-integrity or unknown-usage halt results in an incomplete run and a nonzero CLI exit. Cleanup steps are attempted independently; failed cleanup is retained rather than mislabeled as a fully closed transport. If persistence itself fails, inspect the retained transport ledger before any new activity.

## What the assessment proves

The scorer compares required facts against independent exact-cents references and the actual source scope, status, currency, visible evidence and supported arithmetic. Scope and value must both match. An unsupported representation becomes `needs_review`; a number found somewhere in prose cannot establish source correctness.

**All prose requirements remain pending independent semantic review. Overall status never automatically becomes pass.** Correct numerical evidence does not prove every claim in a response, question interpretation or complete helpfulness. Conditional and volunteered financial claims require review too. The runner keeps its original response and assessments unchanged for that review.

Run offline code checks with:

```sh
npx vitest run tests/conversation-acceptance-runner.test.ts tests/conversation-acceptance-scoring.test.ts tests/conversation-acceptance-workflow.test.ts tests/conversation-acceptance/specification.test.ts
npx tsc --noEmit
```

Those tests use mocked transport responses and pure fixtures. They are not real-provider understanding or a substitute for the separate actual PostgreSQL check.
