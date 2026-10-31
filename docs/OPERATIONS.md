# Finding and explaining a failed request

An error reference is a tracking number. When a request fails, Daybook shows a short explanation and **Copy error reference**. The same server-generated reference appears in the response header, error body and safe runtime diagnostics. If a transaction request fails, its text remains in the form so the user can correct it or retry.

For example, a Google HTTP 503 should produce `AI_SERVICE_UNAVAILABLE` at `provider_http`, with the provider/model, upstream status and deployed source revision. A malformed JSON answer is a different failure (`model_json`); a database problem is not relabeled as an AI formatting problem. These distinctions let an engineer find the broken step before asking the user to reproduce it.

## Local logs

With `npm run dev` or Docker Compose, inspect the API process's structured JSON logs and search for the exact reference. The useful events are `request_error`, `ai_request_failed`, `ai_provider_failure` and the final `http_request`. Background jobs use a job ID and operation instead of inventing a user request ID.

Do not search only by the words “AI error.” Find the reference, then inspect `stage`, `code`, `upstreamStatus`, `durationMs` and `deploymentRevision`. Multiple requests can run simultaneously; a timestamp alone is not a reliable match.

## Hosted logs through the local Vercel account

Use the user's existing local Vercel login and the Daybook project:

```sh
vercel logs runtime --project daybook-ledger --environment production --since 1h --limit 200 --json
```

Search the returned message text for the copied reference. Vercel also has its own platform `requestId`; that field is not Daybook's UUID inside the JSON message. Narrow to a deployment when necessary, and follow the CLI's pagination when the requested window contains more records. Runtime logs can arrive after a short ingestion delay. Build logs show installation/migrations and cannot explain a later user request.

In this workspace, Node-based CLI networking failed even though local authentication was valid. The installed CLI's read-only runtime query uses `POST /v1/observability/events`; an explicitly authorized HTTP tool using the same local login successfully retrieved the logs. Private authentication files and responses stay in ignored tooling. An API request must use RFC 3339 timestamps with at most millisecond precision. Do not mistake an empty first query for proof that no error occurred.

## What is retained

Diagnostic events allowlist request/job references, registered route templates, stage/code, provider/model, HTTP status, timing and deployment revision. They do not routinely record typed transaction text, model prompts/responses, SQL parameters, headers, credentials or raw exception messages. The accounting database separately retains saved entries and validated structured proposals for their legitimate product workflows.

This means a provider outage can be investigated without recovering the user's sentence. A wrong-but-valid category may still need the relevant transaction or a user-supplied example: a tracking number does not reproduce private conversation content that was never retained. That distinction must be stated honestly.

## Current proof and limits

[Core repair evidence](evidence/core-repair-release.json) records a deliberate hosted HTTP 400 whose body/header UUID was found in both error and completion runtime events, with the exact deployed source revision. CI separately checks browser display, actual clipboard copying, retained input and retry behavior. The hosted probe did not call a model and does not reproduce a provider outage. It left all 73 journal records and dashboard figures unchanged.

The later [category release](evidence/category-product-release.json) matched all 11 successful live acceptance request references to actual `http_request` events for exact source `b7bf5fe` and deployment `dpl_F1mVMsNU5QUttzpgaH441iQ7aJoE`. Its two category requests also matched `ai_category_result` events. That proves release/request correlation for those observations; it does not turn a successful request into a test of a provider outage.

No Sentry account or log drain was added. The existing runtime logs are sufficient for this demonstrated investigation. Retention, automated incident alerting and reliable long-term operational monitoring remain deployment concerns; adding another service should solve one of those specific needs rather than substitute for good error boundaries.
