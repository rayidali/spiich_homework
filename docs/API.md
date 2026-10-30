# REST API quick reference

> Updated 2026-10-29. The API remains REST. Gemini/OpenAI adapters now share the same accounting validation; AI responses add provider/usage and query/context metadata. A key is configured locally, but live verification is blocked by this session's networking restrictions. See the [saved checkpoint](../CHECKPOINT.md).

All routes are under `/api`. Monetary amounts and exchange rates are **decimal strings**, dates are `YYYY-MM-DD`, and identifiers are UUIDs. The organization is resolved from trusted server configuration; this assignment has no login or public tenant-selection header.

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
