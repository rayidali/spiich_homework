# REST API quick reference

## Declared-completeness candidate — published and CI verified, not deployed

Server-only `FINANCIAL_CHAT_ROUTE=complete` selects the new [declared-output checker](ANSWER_COMPLETENESS.md). It adds no REST endpoint or client-controlled route selection. The initial typed analysis/scenario/inspection call carries an immutable `answerContract` and `outputBindings`; initial inspection bindings must be empty. Later finish calls supply bindings only. The declaration freezes before financial-amount reads, after the planning account chart is available. It supports at most eight outputs and 16 KiB, with exact original-user quotes, scoped values/tables, ranked identities and ordered arithmetic.

Responses add `answerContract: {hash, contract}`, final `outputBindings`, and `completion` with `completionBasis: 'model_declared'`, `userIntentVerified: false`, overall `fulfilled | partial | unassessed` and per-output `fulfilled | missing | unsupported | invalid` statuses. Evidence locations point to server-produced rows/tables. Missing results get an explicit partial headline; an invalid source/binding withholds financial facts and evidence. Existing posted/draft/hypothetical labels remain visible. A missing execution-snapshot chart cannot be replaced with the planning chart.

The current candidate can execute a missing arithmetic output already specified in that frozen contract. Only absent bindings qualify; operands must resolve through fulfilled scalar outputs, exact original-user assumptions or one complete matching calendar-month series. Existing and generated nodes use the same calculator and source/visibility checks. No query or provider call is added. Unsupported units, zero division, missing sources and ambiguous month counts stay unresolved. Supplied bindings are never replaced, and hidden old calculations are not automatically rebound. If a generated dependency exposes an invalid supplied formula, the financial answer is withheld.

When a node is generated, the response also includes `generatedCalculations: [{outputId, calculationId}]` and original `modelOutputBindings`. Final `outputBindings` carries the combined bindings; the original contract/hash and model bindings are preserved. Diagnostics emit only bounded `generatedCalculationCount`, never those IDs or user quotes. Combined limits remain four queries, eight calculations and eight assumption IDs, including unused server-owned assumption IDs.

Evidence rows now have optional server-owned `factRef` links (`query_row`, `calculation`, `assumption`); query tables may carry `factSource` with query identity and truncation. These fields are additive. The value requirement's optional `selectedAccountCode` chooses one posting-account cell inside its declared scope, including the server-selected cash set, while retaining the original amount-threshold account basis.

The three-attempt/one-repair, two-read/four-query, 64 KiB feedback and shared 40-second planning limits remain. The authored, composable and ordinary adaptive routes retain their current behavior. Exact source `eee73f387f85d2676a50c1e0461bd46c3161ebaf` passed [CI 41264139687](evidence/declared-arithmetic-ci.json): 2,136 normal tests across 107 files, all 32 browser workflows in 42.8 seconds, native research and Compose. The seven new PostgreSQL cases and one new browser workflow are included, not additional counts. Compose passed 2,135 tests across 106 files; these runs overlap the 523 local tests and named suites. Live-AI was skipped. The preceding `382f39f` checker CI remains historical and source-specific. No provider call, new live-model score or deployment occurred; production remains `93a8617` / `composable`. Counts and limitations are recorded in [ANSWER_COMPLETENESS](ANSWER_COMPLETENESS.md#what-has-been-checked-and-what-remains).

The server-only setting `FINANCIAL_CHAT_ROUTE=adaptive` selects the opt-in [inspection candidate](ADAPTIVE_CHAT.md). It adds no REST endpoints and cannot be selected by a client request body. Its internal tools are `inspect_financial_data`, `show_inspected_results` and `calculate_from_inspection`; all financial results remain application-rendered. Source `2b2de76` passed full engineering CI. A later [complete paired service comparison](evidence/adaptive-runs/holdout-v2/report.md) retained real failures and grader limitations; its frozen screen did not qualify the candidate for promotion. It is not deployed. The default is still `composable`.

**Candidate update; [full CI verified](evidence/financial-interface-candidate-ci.json) at `1847a67`, not deployed:** inspection feedback now supplies request-local row handles in `rowId`. Follow-up `counterpartySource` and calculator query operands resolve those handles to the exact saved query/row; unknown, cross-query and other-request handles are refused. Final facts retain canonical IDs, with the mapping in inspection metadata. Exact canonical references remain compatible with existing validation. This adds no endpoint or client-controlled route switch. Gemini tool/proposal schemas also normalize literal constraints to singleton enums, and the existing one schema-repair message gains bounded, server-derived field hints. Strict validation, original-user assumption provenance and provider/time limits remain in force. No new live-model result or production change is claimed.

## Compound grouping — deployed and CI verified

Questions can now group recorded amounts jointly by two or three ordered dimensions: account, person/business and month or quarter. Account/time views include every scoped posting account; person/business combinations fill missing periods only for tuples actually observed after the requested filters. Closing balances retain opening history. Exact arithmetic keeps each row’s account identity and period. The server caps the complete grid at 30,000 cells and 120 periods, then applies a global 50-row display limit with explicit truncation. This expands supported queries; it does not prove general question or formula intent. [Plain-language grouped-spending walkthrough](COMPOUND_GROUPING.md).

Exact-source CI passed **1,629 tests across 85 files and all 29 browser workflows**. The 98 named compound-grouping tests—45 compiler/output, four chat, 35 calculator and 14 real-PostgreSQL tests—are included in that test total. The one new compound-result browser workflow is included in the browser total. Provider responses and the browser chat response are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

## Net cash movement — deployed and CI verified

`net_cash_movement` measures signed posted cash change over an inclusive date range: cash debits minus cash credits. The server selects all cash-designated asset posting accounts, including archived history. Results use saved USD base values or one explicit native currency, with activity filters and grouping kept visible. Calculator movement ancestry retains periods and identities separately from as-of cash balances. This is net change, not gross payments, payment allocation, revenue, profit or a formal cash-flow statement. [Plain-language cash-change walkthrough](CASH_MOVEMENT.md).

The earlier `012f297` cash-movement release passed **1,530 tests across 81 files and all 28 browser workflows**. The 75 named cash-movement cases—26 compiler/output, seven chat, 30 calculator and 12 real-PostgreSQL tests—are included in that total. Provider responses in engineering tests are stubbed; actual database cases use independently specified arithmetic. Browser checks run against the CI build, not the hosted demo. No provider inference, new model-accuracy score or reopened budget was involved. Protected health, metadata and SPA GETs verify deployment, not hosted browser behavior or model understanding. No fresh full-ledger comparison was made; unchanged current books are not claimed. Earlier studies and live-model results remain bound to their original source.

## Deployed expense scope response contract

The deployed `/ai/chat` implementation recognizes a deliberately limited grammar for the first user question, with no earlier user turns, such as “How much did we spend on Office supplies from 2026-01-01 to 2026-03-31?” An exact unique expense-account name or explicit account code identifies the requested posting account or group descendants. Supported shorthand and total-expense formulations use the same guard; optional dates must be explicit ISO bounds. Assistant-only preambles are allowed and preserve original message indices. Any earlier user turn makes the guard unassessed, even if the latest question appears complete: an earlier account, vendor or date instruction may still apply. The entire conversation continues to ordinary execution without a scope proof. This is not general language interpretation or a follow-up resolver.

A matching numeric plan receives `scopeVerification` with rule `explicit_expense_scope_v1`, original `userMessageIndex` and UTF-16 `accountSpan`, requested account identity, `resolvedPostingAccountIds`, requested/executed period and `checkedFields`. Only those fields are proved. Without stated dates, `period.requested` is `null`, `from`/`to` are absent from `checkedFields`, and evidence explicitly says the date range was not verified. Account identities and the financial read share one repeatable-read execution snapshot.

A conflict returns a deterministic clarification with `evidence: []`, the selected `query`, AI usage metadata and `limitation: { code: 'REQUEST_SCOPE_MISMATCH', reason }`; it has no `scopeVerification` and reads no financial amounts. Reasons include account/period scope, extra filters, unsupported plans/grouping, invalid periods, unknown explicit account codes and ambiguous names. Duplicate names and shorthand that could name a distinct account ending in “expenses” require clarification. Unrecognized questions receive no proof. A name unknown in both planning and execution charts stays unassessed, allowing an ordinary vendor query; an initially known name that disappears is withheld. The old chart can only veto lost identity, never establish a successful proof.

This guard does not rewrite plans, make repair calls or change journal data. Existing schema repair remains a separate bounded mechanism. The exact release below passed [CI and PostgreSQL checks](VERIFICATION.md#expense-scope-guard--ci-verified-and-deployed).

## Deployed conversation contract — CI verified

Both `/ai/chat` and `/ai/entry` now share a non-mutating conversation schema: 1–100 messages, 1–4,000 characters per message, at most 48,000 raw content characters and 112 KiB for `JSON.stringify({ messages })` encoded as UTF-8. Whitespace-only content is invalid; other whitespace and message order are preserved. Only user/assistant roles are accepted, and the final message must be from the user. Excess input is rejected before model work; no earlier messages are removed to fit. These are conversation-input bounds, separate from the bounded internal schema-repair diagnostic.

The UI checks the same budget before sending, retains an unsent draft on refusal and offers explicit New conversation. A reset does not post or delete a journal; on the next draft save it clears a discarded saved proposal binding, while a replacement proposal takes precedence. This shared contract is deployed in the exact-source release below. [Verification status](VERIFICATION.md#conversation-and-admission-checks--ci-verified).

## Current promoted compound-grouping release — 2026-10-31

Source **`93a8617932daff772c5b5d9c836be15692a64979` is promoted** at [Daybook](https://daybook-ledger-delta.vercel.app), deployment `dpl_2Rh1j9ryaPzor5vsREcDvYJHgFSQ`. [Full CI 41251437109](https://github.com/rayidali/spiich_homework/actions/runs/41251437109) passed verification, native research and Compose; live-AI was skipped. The actual stable alias and project production target match this READY/PROMOTED deployment, with all-deployment protection retained. [Release evidence](evidence/compound-grouping-release.json).

The active `composable` chat route combines existing report tools with validated ledger queries and exact scenario arithmetic. The model chooses a structured plan; application code compiles permitted queries and calculates the answer. It cannot execute arbitrary SQL or post entries. Cash sources are server-selected, assumptions require original-user evidence, and eligible explicit all-history requests retain their full date scope. Shared PostgreSQL request admission and safe request/provider/plan diagnostics are enabled. File Search, vector retrieval, Wren and reviewer agents remain separate research paths.

The preceding `7ac0a88` release passed **three known date-scope regressions** for $0.0100061 in three provider attempts, with all 74 journals and 22 accounts unchanged and all three requests matched to 12 runtime events. All-history guard provenance was observed, but the model already chose the canonical date (`changed: false`): no actual lower-bound replacement or schema-repair call occurred live. This is bounded regression evidence, not a new general accuracy score. The earlier frozen comparison's 18/20 result belongs to its own source. [Three-case acceptance](evidence/chat-history-acceptance.json). These calls were not repeated for the `f4f3a7` conversation release or the later expense-scope, cash-movement and compound-grouping releases.

## Comparison and preceding release checks — historical

**The all-history guard is deployed and CI-tested.** For a supported, affirmative all-history phrase in the latest original user message, the server changes only a single flow query's `from` to `0001-01-01`, preserves its end date and every other filter, and validates the complete arguments again. Examples include “across all recorded history through October31,2026” and an exact “all-time” follow-up. Quoted names, negation, competing bounds and unsupported trailing wording do not widen a query. Comparisons, multiple queries, scenarios and balance queries are unchanged. This conservative grammar is not a general language-intent guarantee.

An eligible response includes `scopeNormalization`: rule, target field, original and executed start dates, unchanged end date, `changed`, and the exact UTF-16 span/index in the original user conversation. This is also emitted when the model already chose the canonical start. Executed query arguments/facts retain the actual date; primary answers and evidence cards say “all recorded history through …”. The prior C05 failure and closed acceptance ledger below remain unchanged. The prior `7ac0a88` three-case acceptance checked original-user provenance and preserved explicit bounds; D01 did not require changing the model’s already-canonical lower date.

The paired product comparison is complete: **composable queries18/20 versus authored tools6/20**, with7/7 versus6/7 on the predefined common-capability subset. Actual PostgreSQL replay checked both the chosen filters and exact results; the books stayed unchanged. Internal-AI review found no wrong displayed financial answer or hard-boundary violation in this small set. An account-group comparator false negative is documented separately; the primary score remains unchanged. [Evidence and CI](evidence/chat-query-runs/holdout-v1/ci.json), [two-page explanation](reports/chat-query-comparison.pdf), [details](CHAT_RELIABILITY.md).

The later candidate `7be9224` passed [full CI41237787408](https://github.com/rayidali/spiich_homework/actions/runs/41237787408), but its hosted acceptance **stopped after seven of eight requests**. Six answers passed review; the hiring calculation selected all assets where cash was required. Noncash balances happened to net to zero, so the displayed amount matched by coincidence; the source was still wrong. The stable alias was rolled back to the verified scoped-chat release `e7a514e`. The cohort is terminally closed at $0.0253555, with all 74 journals and 22 accounts unchanged and all seven requests correlated to the exact candidate runtime. [Incident and rollback](evidence/chat-broad-blocked-release.json). The later cash-source repair has separate CI and blocked hosted evidence below.

The preceding cash-source candidate `7b52a9b` was also never promoted. Its cohort remains closed after one pass and one HTTP502 / `AI_INVALID_RESPONSE` at `model_schema`, with $0.0088424 known use plus a retained $0.02 unknown reservation. The rejected field is still unknown; the later successful request does not reveal that cause. [Earlier staged incident](evidence/chat-cash-blocked-release.json).

**Previous schema-repair candidate — preserved failure.** Schema-repair source `012edb2432f0843bd1f8581a7aa114a42620373d` passed [full CI41241451555](https://github.com/rayidali/spiich_homework/actions/runs/41241451555) and reached READY/STAGED as `dpl_CFRd32kxBfYump4D8r93K3yQkzef`; it was never promoted. All six planned HTTP requests completed, but acceptance was **five passes and one scope failure**. C05 asked for all recorded Office supplies history; the model invented `from: 2000-01-01`. Its $1,740 total happened to equal the current full-history total, so this is a wrong scope with no observed dollar error. The cohort is terminally closed at **$0.0281190**, all known usage, six provider attempts and zero live schema repairs. All 74 journals and 22 accounts stayed unchanged; each request matched usage, final-plan, selected-tool and HTTP logs. At that checkpoint, the stable demo remained on `e7a514e`. [Preserved blocked-release receipt](evidence/chat-schema-repair-blocked-release.json). Completing all slots is not successful acceptance; no old failure or score was rewritten.

**Bounded schema repair passed CI; its second-call recovery remains unobserved live.** After an allowed financial tool returns schema-invalid arguments, the app may make one correction request only when the first attempt reported complete, consistent token usage. The same tools and guards apply; diagnostic feedback is untrusted and capped at 16 KB. Financial assumptions are still validated against only the original user conversation. HTTP, envelope, semantic, account and database failures do not trigger repair, and no third model call is allowed. Each provider timeout is at most 25 seconds within the remaining 40-second planning budget; repair is skipped with less than one second remaining. Safe issue-code/schema-path diagnostics and per-attempt usage, including known and unknown portions, are retained on success or error. This can improve schema reliability, not prove that the chosen query or formula matches every question. Offline review passed 76 targeted tests. All six preceding schema-repair checks and all three prior `7ac0a88` history checks used one model attempt, so none demonstrates second-call recovery succeeding live.

**Cash-source contract retained in the promoted release.** `cash_balance` requires empty `accountCodes` and lets the server select all cash-designated ASSET posting accounts, including archived history. It retains all-history cutoffs, saved FX amounts and explicit source metadata. The calculator rejects every generic `account_balance` query before database execution, including unused or wrapped queries, and carries actual cash account/date lineage through each calculation. Standalone asset-balance reports remain supported. This fixes the demonstrated asset substitution; it does not prove that every free-form question or formula has the intended meaning. Noncash balance arithmetic is deliberately unsupported. The new source does not inherit earlier study or acceptance scores.

## Previous scoped-chat repair — 2026-10-31

Executable `e7a514ef7072fbaabc6b63af026a6bab2fbd1478` passed [full CI41231800054](https://github.com/rayidali/spiich_homework/actions/runs/41231800054) and was deployed as `dpl_H7TtjDv11bmPNSiLnHT8QzuvGdX2` at that earlier checkpoint. The 66-file release adds account-scoped expenses, explicit expense top/all/total views, income totals and comparisons, scope-preserving date clarification and safe selected-query diagnostics. A separate closed hosted cohort passed16 exact-answer and7 clarification checks for $0.0298001; all74 current journal records and22 accounts stayed unchanged. Every request matched the selected tool and exact source in runtime logs. [Evidence](evidence/chat-scope-release.json).

That historical candidate was later extended and promoted as the composable route recorded above, with structured clarification, shared PostgreSQL request admission, bounded provider JSON, exact scenario arithmetic and draft/evidence labels. The paired evaluation is closed; neither earlier repair results nor frozen comparison scores become new measurements of the promoted code. [Reliability work](CHAT_RELIABILITY.md), [comparison protocol](research/CHAT_QUERY_EVALUATION.md).

## Previous category release API — 2026-10-31

Executable `b7bf5fe024f6fca33fa5a93ef5e6188e96455bae` passed [full CI](https://github.com/rayidali/spiich_homework/actions/runs/41226562746) and was deployed with Gemini 3.5 Flash-Lite at that earlier checkpoint for financial chat, whole-entry proposals and category suggestions. Eleven hosted regression requests passed, including all four financial question types, exact Supplies/Card and rent/bank entries, settlement of an existing receivable without recognizing revenue twice, and clarification of missing-account rent and the friend/party example. Every request reference matched runtime logs for the exact release. See [release evidence](evidence/category-product-release.json).

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

The entry endpoint returns `action`, `explanation`, `questions`, and a validated `entry` or null. Continue clarification using the prior user/assistant messages. Chat uses the same `messages` field without `date` and returns `answer` plus evidence blocks. The deployed source uses the shared conversation limits above; it does not silently trim history to the former twelve-message limit.

Both AI endpoints also return `ai` metadata: provider, configured model, reported model version when available, request duration and reported token usage. Entry responses include `context` with retrieved correction/history IDs. Chat includes the validated `query: {name, args}` used for the answer. The server supplies organization scope; model-supplied scope or extra tool arguments are rejected. `/meta` includes `ai.provider`; `ai.available` means a key is configured, not that its access or model accuracy has been verified.

Each model transport invocation makes one attempt, with a timeout of at most 25 seconds and a four-request concurrency limit. Entry generation does not retry. Financial chat can make one additional invocation only for the bounded argument-schema correction described above, within its shared 40-second planning allowance. It never returns provider error bodies or credentials. Error codes distinguish `AI_NOT_CONFIGURED`, `AI_AUTH_ERROR`, `AI_REQUEST_REJECTED`, `AI_RATE_LIMIT`, `AI_MODEL_UNAVAILABLE`, `AI_TIMEOUT`, and malformed responses. It also distinguishes `AI_SERVICE_UNAVAILABLE` for upstream HTTP 5xx and `AI_CONNECTION_ERROR` for a connection failure without an HTTP response. A provider HTTP 504 is therefore service unavailability; the application's own elapsed deadline remains `AI_TIMEOUT`. CLI evaluation additionally enforces attempt and observed-token limits.

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
