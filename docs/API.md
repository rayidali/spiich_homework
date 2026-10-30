# REST API quick reference

## 2026-10-30 live AI recovery update

The hosted model and source default are now **`gemini-3.1-flash-lite`**. Direct API testing reproduced the earlier model's generation timeouts and confirmed working text/JSON/tool calls on Flash-Lite. A separate journal-proposal rejection was traced to the 100-line `maxItems` constraint in Gemini's decoding grammar: the transport now omits array maxima, while the full original Zod limit, account checks and exact-money/balance rules remain enforced locally.

Selected hosted checks succeeded: cash **$125,620.00**, **12 Acme Corp entries**, September expenses **$9,265.00**, and a review-only **$340 Supplies debit / Company credit card credit** proposal. Cash/search/expense values matched independent endpoints, and the 73-entry journal list was unchanged. An initial expense timeout succeeded on manual repeat, while a later search failed; **intermittent provider failures remain**. No automatic retry, paid-plan change or accuracy guarantee was introduced.

Local build/native imports and **60 isolated tests** passed, including two new schema regressions. Full CI for source `7ecb435c421862dba5efd4e3b6f743c93fd1888e` is [queued](https://github.com/rayidali/spiich_homework/actions/runs/41103851106); the previous 101-test full run remains the last completed regression evidence. These selected checks are not the full 40-case live evaluation. [Detailed evidence](evidence/chat-recovery-verification.json) records successes and failures. Earlier timeout-only notes below describe the 2026-10-29 snapshot.

> Saved 2026-10-29. API design is REST with Zod-validated contracts and decimal-string money. The latest full CI passed 101 backend tests; hosted health/report/scheduler HTTP checks passed. Gemini metadata access succeeded, but financial chat returned the handled 25-second timeout. See [verification](VERIFICATION.md) and [checkpoint](../CHECKPOINT.md).

All routes are under `/api`. Monetary amounts and exchange rates are **decimal strings**, dates are `YYYY-MM-DD`, and identifiers are UUIDs. The organization is resolved from trusted server configuration; the application has no user login or public tenant-selection header. The hosted demo additionally sits behind Vercel Authentication; that platform gate is separate from application authorization.

| Method           | Route                                    | Purpose                                                     |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------- |
| GET              | `/health`                                | Database readiness                                          |
| GET              | `/meta`                                  | Workspace, business date, AI availability, open-alert count |
| GET              | `/dashboard?from=&to=`                   | Actual cash, P&L, trend and review counts                   |
| GET/POST         | `/accounts`                              | Account balances or create account                          |
| PUT/PATCH/DELETE | `/accounts/:id`                          | Edit, archive/restore, delete unused account                |
| GET              | `/accounts/:id/ledger?from=&to=&cursor=` | Opening/closing amounts and paginated running balances      |
| GET/POST         | `/entries`                               | List/search or create a draft                               |
| GET/PUT          | `/entries/:id`                           | Inspect or edit a draft                                     |
| POST             | `/entries/:id/post`                      | Post a reviewed draft                                       |
| POST             | `/entries/:id/reverse`                   | Create and post an exact linked reversal                    |
| GET              | `/reports/trial?from=&to=`               | Opening, interval, and closing trial balance                |
| GET              | `/reports/income?from=&to=`              | P&L                                                         |
| GET              | `/reports/balance?to=`                   | Balance sheet as of a date                                  |
| GET/POST         | `/recurring`                             | List or create schedules                                    |
| PUT/PATCH        | `/recurring/:id`                         | Edit future content or pause/resume                         |
| POST             | `/recurring/generate`                    | Generate currently due drafts, bounded per call             |
| GET              | `/alerts?status=OPEN`                    | Review alerts; use `DISMISSED` for reviewed                 |
| PATCH            | `/alerts/:id`                            | Set status OPEN or DISMISSED                                |
| POST             | `/ai/entry`                              | Propose a structured entry or clarify                       |
| POST             | `/ai/chat`                               | Execute an allowlisted financial insight                    |
| POST             | `/ai/feedback`                           | Store a confirmed categorization correction                 |

## Draft creation and posting

Send an `Idempotency-Key` header of 8–128 characters for entry creation, reversal, and recurring-template creation. Reuse it for the same create request's retries; do not reuse it for another logical operation.

```json
{
  "date": "2026-03-04",
  "description": "March studio rent",
  "counterparty": "Landlord",
  "reference": "",
  "source": "MANUAL",
  "lines": [
    {
      "accountId": "<rent-account-uuid>",
      "debit": "2400.00",
      "credit": "0",
      "exchangeRate": "1",
      "memo": ""
    },
    { "accountId": "<bank-account-uuid>", "debit": "0", "credit": "2400.00", "exchangeRate": "1", "memo": "" }
  ]
}
```

The response includes the draft's `id` and `revision`. `PUT /entries/:id` accepts the same body plus `expectedRevision`. `POST /entries/:id/post` accepts `{"expectedRevision": 3}` using the revision you actually reviewed. For a foreign recurring occurrence, also send `"exchangeRatesConfirmed": true`. Reversal accepts `{"date":"2026-03-06"}`.

Only MANUAL/AI are accepted as caller-supplied sources. Internal recurrence/reversal/seed provenance is assigned by the corresponding services and constrained by PostgreSQL.

## Query filters

Entry filters are `search`, `from`, `to`, `status=DRAFT|POSTED`, `accountId`, `currency`, `limit` (1–100), and `cursor`. The default page size is 25. A page returns `items` and `nextCursor`. Treat the cursor as opaque and preserve filters between pages. Account ledgers page in batches of 50.

Report periods default to the current month through today. Balance sheets use only `to`; they do not imply a period-start cutoff. All dates are inclusive. Accounts default to all posted history, or accept `asOf`.

## AI request shape

```json
{
  "messages": [{ "role": "user", "content": "Bought $340 of office supplies using the company credit card" }],
  "date": "2026-03-04"
}
```

The entry endpoint returns `action`, `explanation`, `questions`, and a validated `entry` or null. Continue clarification using the prior user/assistant messages. Chat uses the same `messages` field without `date` and returns `answer` plus evidence blocks. Maximum conversation length is 12 messages of 4,000 characters each.

Both AI endpoints also return `ai` metadata: provider, configured model, reported model version when available, request duration and reported token usage. Entry responses include `context` with retrieved correction/history IDs. Chat includes the validated `query: {name, args}` used for the answer. The server supplies organization scope; model-supplied scope or extra tool arguments are rejected. `/meta` includes `ai.provider`; `ai.available` means a key is configured, not that its access or model accuracy has been verified.

The model transport makes one attempt per request with a 25-second timeout and a four-request concurrency limit. It never returns provider error bodies or credentials. Error codes distinguish `AI_NOT_CONFIGURED`, `AI_AUTH_ERROR`, `AI_REQUEST_REJECTED`, `AI_RATE_LIMIT`, `AI_MODEL_UNAVAILABLE`, `AI_TIMEOUT`, and malformed responses. CLI evaluation additionally enforces attempt and observed-token limits.

## Errors

```json
{
  "error": {
    "code": "STALE_DRAFT",
    "message": "This draft changed after you opened it. Reload and review the latest version before posting.",
    "requestId": "<request-uuid>"
  }
}
```

Common statuses: 400 invalid input/cursor, 404 missing resource, 409 stale/reused-key/in-use conflict, 422 accounting rule violation, 429 AI concurrency/provider limit, 502 provider or invalid-model-output failure, 503 unconfigured AI/database timeout, 504 model timeout. Request IDs appear in response headers and request logs. Database statements use bound parameters; request bodies and keys are not logged.

## Hosted access and scheduled work

The hosted base URL is https://daybook-ledger-delta.vercel.app. Browser requests need Vercel deployment access before reaching these routes. A Vercel sign-in page is not a response from Daybook's API. Local/Compose instances do not have that platform gate. Keep testing credentials private; do not put them into frontend code or examples.

`GET /api/cron` is a **hosting-only operational route** exported separately from the core Express API. It requires `Authorization: Bearer <CRON_SECRET>` in addition to any deployment access. It generates due recurring drafts for the configured organization, then processes one bounded durable job batch. It never posts drafts. The production schedule is daily 06:00 UTC; automatic firing has not yet been observed.

Successful response example, observed in the hosted check:

```json
{ "schedules": { "generated": 0, "failed": 0 }, "processed": 4 }
```

The scheduler sets `Cache-Control: no-store`. Unlike the general API envelope, its minimal operational errors are `{"error":"UNAUTHORIZED"}` (401, missing/wrong/unconfigured secret), `{"error":"METHOD_NOT_ALLOWED"}` (405 with Allow: GET), and `{"error":"SCHEDULE_UNAVAILABLE"}` (503). No work runs before authorization. PostgreSQL/worker details are not exposed. Core `POST /api/recurring/generate` remains available through the normal API; it generates pending drafts and is a separate operation.

The hosted financial-chat probe returned HTTP 504 with `error.code=AI_TIMEOUT`, a request ID and a message explaining that the books had not changed. This is a handled failure, not a successful financial answer. A metadata response with `ai.available=true` only means a key is configured; neither that flag nor model-metadata access establishes live generation quality.

Hosted requests use the same posting/reversal/revision rules as Docker. Successful mutating requests also register a bounded post-response anomaly job batch through `waitUntil`; the journal transaction does not depend on that analysis completing. Durable failures can be retried later. [Hosting](HOSTING.md) describes queue cadence and deployment configuration.
