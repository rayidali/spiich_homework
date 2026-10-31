# REST API quick reference

## Broader financial chat — 2026-10-31

The paired product comparison is complete: **composable queries18/20 versus authored tools6/20**, with7/7 versus6/7 on the predefined common-capability subset. Actual PostgreSQL replay checked both the chosen filters and exact results; the books stayed unchanged. Internal-AI review found no wrong displayed financial answer or hard-boundary violation in this small set. An account-group comparator false negative is documented separately; the primary score remains unchanged. [Evidence and CI](evidence/chat-query-runs/holdout-v1/ci.json), [two-page explanation](reports/chat-query-comparison.pdf), [details](CHAT_RELIABILITY.md).

The later candidate `7be9224` passed [full CI41237787408](https://github.com/rayidali/spiich_homework/actions/runs/41237787408), but its hosted acceptance **stopped after seven of eight requests**. Six answers passed review; the hiring calculation selected all assets where cash was required. Noncash balances happened to net to zero, so the displayed amount matched by coincidence; the source was still wrong. The stable alias was rolled back to the verified scoped-chat release `e7a514e`. The cohort is terminally closed at $0.0253555, with all 74 journals and 22 accounts unchanged and all seven requests correlated to the exact candidate runtime. [Incident and rollback](evidence/chat-broad-blocked-release.json). A separate cash-source repair is in progress and has no inherited study or acceptance score.

**Cash-source repair implemented locally; CI and hosted verification pending.** `cash_balance` requires empty `accountCodes` and lets the server select all cash-designated ASSET posting accounts, including archived history. It retains all-history cutoffs, saved FX amounts and explicit source metadata. The calculator rejects every generic `account_balance` query before database execution, including unused or wrapped queries, and carries actual cash account/date lineage through each calculation. Standalone asset-balance reports remain supported. This fixes the demonstrated asset substitution; it does not prove that every free-form question or formula has the intended meaning. Noncash balance arithmetic is deliberately unsupported. The new source does not inherit earlier study or acceptance scores.

## Previous scoped-chat repair — 2026-10-31

Executable `e7a514ef7072fbaabc6b63af026a6bab2fbd1478` passed [full CI41231800054](https://github.com/rayidali/spiich_homework/actions/runs/41231800054) and is deployed as `dpl_H7TtjDv11bmPNSiLnHT8QzuvGdX2`. The 66-file release adds account-scoped expenses, explicit expense top/all/total views, income totals and comparisons, scope-preserving date clarification and safe selected-query diagnostics. A separate closed hosted cohort passed16 exact-answer and7 clarification checks for $0.0298001; all74 current journal records and22 accounts stayed unchanged. Every request matched the selected tool and exact source in runtime logs. [Evidence](evidence/chat-scope-release.json).

The working tree additionally contains an **undeployed candidate** for composable queries, structured clarifications, shared PostgreSQL request admission, bounded provider JSON and clearer draft/evidence labels. Scenario arithmetic and the separate paired evaluation remain active. Do not apply the preceding repair's results to this candidate. [Reliability work](CHAT_RELIABILITY.md), [comparison protocol](research/CHAT_QUERY_EVALUATION.md).

## Previous category release API — 2026-10-31

Executable `b7bf5fe024f6fca33fa5a93ef5e6188e96455bae` passed [full CI](https://github.com/rayidali/spiich_homework/actions/runs/41226562746) and is deployed with Gemini 3.5 Flash-Lite for financial chat, whole-entry proposals and category suggestions. Eleven hosted regression requests passed, including all four financial question types, exact Supplies/Card and rent/bank entries, settlement of an existing receivable without recognizing revenue twice, and clarification of missing-account rent and the friend/party example. Every request reference matched runtime logs for the exact release. See [release evidence](evidence/category-product-release.json).

`error.requestId` and `X-Request-Id` reach the interface and safe backend diagnostics. A validated READY proposal includes `proposalId`; AI entry create/update binds it to the saved draft. Posting returns optional `categorizationLearning` and atomically remembers meaningful account changes from the server-issued proposal. Saving a draft alone does not teach the system. Entry detail includes learning status; `DELETE /api/ai/corrections/:id` forgets that example without changing the journal. The legacy `POST /api/ai/feedback` returns 410 `REVIEWED_POSTING_REQUIRED`; arbitrary client examples are not accepted. Alerts support `RESOLVED`; automatically resolved alerts cannot be manually reopened. These contracts use applied migrations 005/006.

The category comparison kept the same facts, chart and examples for all selectors. Gemini met the category and taught-preference target in 33/33 held-out cases; Jev met it in 31/33. These small synthetic selector results do not establish full-entry or production accuracy. [Two-page explanation](reports/category-learning-explained.pdf). Earlier provider outages and the original rent ambiguity failure remain in [repair evidence](evidence/entry-provider-recovery.json) and [BUILD_LOG](BUILD_LOG.md); they were not retroactively changed into passes. The original 40-case live evaluation remains separate and incomplete.

## Category suggestions

`POST /api/ai/category` accepts only transaction facts: `description`, optional `counterparty`, `direction` (`IN`/`OUT`), decimal-string `amount`, `date`, `currency`, `exchangeRate`, `fundingAccountId`, optional `purpose` (`BUSINESS`/`PERSONAL`/`LOAN`/`TRANSFER`) and `structure` (`SINGLE`/`SPLIT`/`COMPLEX`). It rejects client account lists, history, provider settings, keys and organization identifiers. The organization, active chart and eligible correction/history examples come from server repositories.

`SELECT` returns one allowed `accountId`, a server-built balanced `entry`, `proposalId`, `reviewRequired: true` and bounded provider metadata. It stores a validated proposal, **not a journal entry**. `CLARIFY` returns a question/topic/options; `UNSUPPORTED` directs the caller to the full entry workflow. Both return without a proposal. The simple category scope is expense/revenue selection; loans, transfers, refunds, assets and existing-invoice settlement are not silently treated as ordinary expenses or revenue.

The client submits the selected or corrected entry with its `proposalId` to the existing create/update draft endpoint. Posting still requires the existing explicit review action. A category-only change preserves the proposal binding so the atomic reviewed-posting correction system can learn it. Changing meaningful transaction facts invalidates that binding; late responses cannot restore it. If a category draft was saved before posting failed, its next `PUT /entries/:id` explicitly sends `clearProposal: true` to remove the old binding atomically with the revised draft. This flag is mutually exclusive with a new `proposalId`; omission preserves existing binding behavior. Posted entries cannot be cleared this way. The UI never defaults unknown purpose to business.

`GET /meta` exposes a separate `category: { available, provider, model }`, independent of `ai` availability for whole-entry description and financial chat. Server-only `CATEGORY_PROVIDER=gemini|jev|reference` chooses the category adapter; Gemini remains the default after the completed comparison. Jev uses `TYPESAFE_API_KEY`; Gemini uses `GEMINI_API_KEY`; the reference uses neither. There is no model selector in the UI. Configuration does not itself authorize an evaluation or purchase.

The selector retains its per-process four-call limit and single-attempt transport. All three HTTP AI endpoints additionally share PostgreSQL admission counters:12 requests/minute,100/day and four active requests per configured workspace, with bounded `Retry-After` responses. Safe diagnostics retain `X-Request-Id` correlation. These request controls are not a dollar spending cap. The separate evaluation runner owns its persistent budget. The category endpoint is deployed and passed live Supplies and laptop-boundary checks; its database/browser workflow passed CI. [Implementation and limits](CATEGORY_SELECTOR.md).

All routes are under `/api`. Monetary amounts and exchange rates are **decimal strings**, dates are `YYYY-MM-DD`, and identifiers are UUIDs. The organization is resolved from trusted server configuration; the application has no user login or public tenant-selection header. The hosted demo additionally sits behind Vercel Authentication; that platform gate is separate from application authorization.

| Method           | Route                                    | Purpose                                                      |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------ |
| GET              | `/health`                                | Database readiness                                           |
| GET              | `/meta`                                  | Workspace, business date, AI availability, open-alert count  |
| GET              | `/dashboard?from=&to=`                   | Actual cash, P&L, trend and review counts                    |
| GET/POST         | `/accounts`                              | Account balances or create account                           |
| PUT/PATCH/DELETE | `/accounts/:id`                          | Edit, archive/restore, delete unused account                 |
| GET              | `/accounts/:id/ledger?from=&to=&cursor=` | Opening/closing amounts and paginated running balances       |
| GET/POST         | `/entries`                               | List/search or create a draft                                |
| GET/PUT          | `/entries/:id`                           | Inspect or edit a draft                                      |
| POST             | `/entries/:id/post`                      | Post a reviewed draft                                        |
| POST             | `/entries/:id/reverse`                   | Create and post an exact linked reversal                     |
| GET              | `/reports/trial?from=&to=`               | Opening, interval, and closing trial balance                 |
| GET              | `/reports/income?from=&to=`              | P&L                                                          |
| GET              | `/reports/balance?to=`                   | Balance sheet as of a date                                   |
| GET/POST         | `/recurring`                             | List or create schedules                                     |
| PUT/PATCH        | `/recurring/:id`                         | Edit future content or pause/resume                          |
| POST             | `/recurring/generate`                    | Generate currently due drafts, bounded per call              |
| GET              | `/alerts?status=OPEN`                    | Review alerts; use `DISMISSED` for reviewed                  |
| PATCH            | `/alerts/:id`                            | Set status OPEN or DISMISSED                                 |
| POST             | `/ai/category`                           | Suggest a category using server context; prepare review only |
| POST             | `/ai/entry`                              | Propose a structured entry or clarify                        |
| POST             | `/ai/chat`                               | Execute an allowlisted financial insight                     |
| POST             | `/ai/feedback`                           | Retired: returns 410; learn from reviewed posting            |
| DELETE           | `/ai/corrections/:id`                    | Forget a reviewed correction without changing the ledger     |

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

The model transport makes one attempt per request with a 25-second timeout and a four-request concurrency limit. It never returns provider error bodies or credentials. Error codes distinguish `AI_NOT_CONFIGURED`, `AI_AUTH_ERROR`, `AI_REQUEST_REJECTED`, `AI_RATE_LIMIT`, `AI_MODEL_UNAVAILABLE`, `AI_TIMEOUT`, and malformed responses. It also distinguishes `AI_SERVICE_UNAVAILABLE` for upstream HTTP 5xx and `AI_CONNECTION_ERROR` for a connection failure without an HTTP response. A provider HTTP 504 is therefore service unavailability; the application's own elapsed deadline remains `AI_TIMEOUT`. CLI evaluation additionally enforces attempt and observed-token limits.

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

Common statuses: 400 invalid input/cursor, 404 missing resource, 409 stale/reused-key/in-use conflict, 422 accounting rule violation, 429 AI concurrency/provider limit, 502 provider/connection or invalid-model-output failure, 503 unconfigured AI/database timeout or upstream AI-service unavailability, 504 application model-call timeout. Request IDs appear in response headers and request logs. Database statements use bound parameters; request bodies and keys are not logged.

## Hosted access and scheduled work

The hosted base URL is https://daybook-ledger-delta.vercel.app. Browser requests need Vercel deployment access before reaching these routes. A Vercel sign-in page is not a response from Daybook's API. Local/Compose instances do not have that platform gate. Keep testing credentials private; do not put them into frontend code or examples.

`GET /api/cron` is a **hosting-only operational route** exported separately from the core Express API. It requires `Authorization: Bearer <CRON_SECRET>` in addition to any deployment access. It generates due recurring drafts for the configured organization, then processes one bounded durable job batch. It never posts drafts. The production schedule is daily 06:00 UTC; automatic firing has not yet been observed.

Successful response example, observed in the hosted check:

```json
{ "schedules": { "generated": 0, "failed": 0 }, "processed": 4 }
```

The scheduler sets `Cache-Control: no-store`. Unlike the general API envelope, its minimal operational errors are `{"error":"UNAUTHORIZED"}` (401, missing/wrong/unconfigured secret), `{"error":"METHOD_NOT_ALLOWED"}` (405 with Allow: GET), and `{"error":"SCHEDULE_UNAVAILABLE"}` (503). No work runs before authorization. PostgreSQL/worker details are not exposed. Core `POST /api/recurring/generate` remains available through the normal API; it generates pending drafts and is a separate operation.

The historical October 29 hosted financial-chat probe returned HTTP 504 with `error.code=AI_TIMEOUT`, a request ID and a message explaining that the books had not changed. Subsequent selected calls succeeded; the October 31 deployment, preserved rent failure and successful clarification regression checks are recorded at the top of this document. A metadata response with `ai.available=true` only means a key is configured; neither that flag nor model-metadata access establishes live generation quality.

Hosted requests use the same posting/reversal/revision rules as Docker. Successful mutating requests also register a bounded post-response anomaly job batch through `waitUntil`; the journal transaction does not depend on that analysis completing. Durable failures can be retried later. [Hosting](HOSTING.md) describes queue cadence and deployment configuration.
