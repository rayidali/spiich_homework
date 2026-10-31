# Category selector implementation

The selector is now connected in source to the short-form category button and `POST /api/ai/category`. This integration is awaiting its new database/browser CI checks and deployment; it is not yet a hosted feature. No live provider evaluation has been run for it. The completed nine-route research study did not measure this task.

## What it does

Suppose a user has already entered “Bought printer paper,” USD 340, October 31, and the company card. The amount, currency, date, exchange rate and paying account are fixed facts. The selector receives those facts and the business's eligible account list. It can suggest **Office supplies**, ask what the purchase was for, or say that the simple form cannot describe the transaction. It cannot change USD 340, move the payment to Checking, run SQL or post a journal entry.

The initial scope is one expense category for money out or one revenue category for money in. Existing-invoice settlement, loans, repayments, transfers, personal withdrawals, refunds, asset purchases and split transactions need the full entry workflow. An unknown personal versus business purpose has explicit clarification choices. Purpose is optional: a provider can interpret a clear current description, but history must not establish the current purpose. The offline reference requires explicit business purpose because it has no semantic model.

## Server API

```ts
const snapshot = prepareCategorySnapshot(facts, trustedContext);
const result = await selectCategory(snapshot, {
  provider: 'gemini', // or 'jev' or the offline 'reference'
  apiKey,
  // Optional bounded, single-attempt transport for tests or a future budget wrapper.
  transport,
});
```

`CategoryFacts` contains description, counterparty, direction (`IN`/`OUT`), amount, date, currency, exchangeRate, fundingAccountId, optional purpose and structure (`SINGLE`/`SPLIT`/`COMPLEX`). The server must explicitly identify the simple structure; missing structure prompts a question. Amounts and rates remain decimal strings; currency precision and nonzero rounded base value are checked before either provider is called. The current ledger uses USD as its fixed base, and this module rejects other base currencies. Missing or invalid fixed facts return `CLARIFY` before credentials or transport are used. Explicit unsupported structures/purposes return `UNSUPPORTED` without a model call.

`TrustedCategoryContext` is a server repository boundary, not an HTTP request schema. It supplies organization-scoped accounts and the existing `getCategorizationContext` corrections/history. That repository owns posting, reversal, expiry and forget eligibility. The selector repeats shape, organization, active-account and simple balanced-example checks; structural validation cannot prove that a caller actually fetched its input from the database. The category service builds this context itself, reconstructs the two fixed account effects, and calls `recordProposal`, which revalidates the accounts and balance before storing a proposal. It does not create or post a journal.

The snapshot is copied, frozen, hash-bound to its organization and contract version, and accepted only through its in-process object identity. A deserialized request cannot impersonate a snapshot. Its serialized model state contains one shared candidate order and the same examples for both providers. Account choices are sorted by code/id; unavailable, group, foreign-currency and wrong-type accounts are excluded. No top-k model-specific shortlist is used.

Results are a discriminated union:

- `SELECT`: one allowed `accountId`.
- `CLARIFY`: a fixed question, topic and, where applicable, explicit options.
- `UNSUPPORTED`: a reason and full-review message.

Every result has `reviewRequired: true`, a basis, snapshot hash, requested/returned model identifiers, attempts, latency and nullable token usage. These are category decisions, not generated or validated journal entries. The caller must keep the fixed funding account and use existing exact-money/ledger validation to build the eventual proposal. No writes occur here.

## Provider contracts and reference

Both providers receive the identical serialized facts/options/examples and the same task instructions. Gemini receives a constrained JSON choice. TypeSafe receives one Choice question with the same ordered options. Prompt/response APIs differ; input parity does not imply identical tokenization or model capabilities.

Jev uses the documented [`POST /v1/systemone` Choice contract](https://docs.typesafe.ai/primitives/choice) with the versioned model `jev-1.14.0`. Every returned option/probability is checked, including exact option membership, probability sum, maximum-probability choice, confidence formula and safe nonnegative token counts. Its [confidence statistic](https://docs.typesafe.ai/confidence) is retained as an uncalibrated model signal. No acceptance threshold is chosen here, and confidence is not an accuracy claim. [TypeSafe's model documentation](https://docs.typesafe.ai/models) explains version pinning and examples supplied as context; this is not customer weight training.

Gemini defaults to `gemini-3.5-flash-lite`, independently of the existing whole-entry provider module. Its request explicitly uses `MINIMAL` thinking and a 256-token output ceiling. [Google's thinking guide](https://ai.google.dev/gemini-api/docs/thinking) documents this level for the model; the [REST schema](https://ai.google.dev/api/generate-content#ThinkingConfig) defines its enum. The ceiling is a bounded configuration, not a measured guarantee against truncation. Bounded thought-signature metadata is accepted without being used as answer content. The returned model version is recorded when supplied; missing revision/usage remains `null`. A configured model name is not proof of immutable provider weights. The structured output may contain only an allowed choice; numeric facts, extra entry fields, truncated responses and invalid usage counts are rejected.

The offline reference uses exact normalized description **and** counterparty matches, prioritizing confirmed corrections over posted history. Conflicting examples cause clarification. Without a match, a unique literal account-label match can suggest a category. It has no merchant dictionary, gold labels, embeddings or model calls. A simpler reference is expected to have narrower semantic coverage; report it honestly.

## Transport and validation limits

The native transport performs one HTTPS POST with redirects disabled, a total timeout (10 seconds by default, at most 25 seconds), and a 128 KiB response ceiling. It has no SDK, retries, model fallback, debug logging, key lookup or budget configuration. Keys are explicit server options and never included in the state. Error messages exclude upstream bodies and raw exceptions. `getCategoryFailureMetadata(error)` exposes safe provider/model/attempt/status/usage fields for a later logger or budget wrapper through an internal WeakMap; it does not put them in public error details. The service uses these fields for request-correlated diagnostics; logs omit facts, examples, keys, raw responses and journal lines. HTTP errors use the existing `AI_RATE_LIMIT`/`AI_PROVIDER_ERROR` codes; malformed caller context uses `INVALID_INPUT`. The injectable transport is trusted infrastructure and must honor the one-attempt/no-logging contract; it must not hide retries. Its deadline signal is also enforced by the selector.

Descriptions, account names and history are data, not system instructions. Foreign choices and extra output fields are rejected. This separation and validation reduce failure paths; they do not prove that a model cannot be semantically misled into choosing a wrong _allowed_ account. The user still reviews the suggestion. Tests with synthetic responses are contract tests, not evidence of model accuracy or successful live provider access.

The service and UI integration use separate category availability/configuration. `CATEGORY_PROVIDER` is server-controlled; it defaults to Gemini pending the focused comparison. The button has no provider dropdown. Purpose questions present explicit options, never a silent business default. Category-only edits preserve the proposal link; meaning, amount, date, direction, funding, chart or mode changes cancel pending work and discard it. Aborted/stale browser responses cannot replace a later user choice. When a draft was saved before posting failed, `clearProposal: true` on the next changed-facts draft update atomically detaches its old proposal; omitted flags preserve the existing whole-entry/later-posting behavior. The full-entry natural-language workflow remains separate.

The category service limits concurrency to four requests per process. This is not a global rate limit or spending cap. A separate runner must account for provider usage and failed/unknown reservations during the focused experiment. The offline reference can exercise the actual database/UI flow without provider calls; those checks prove application behavior, not model accuracy. The new real-PostgreSQL and browser suites still need CI execution. No model spend, live category check or deployment is implied by these source changes.

## Provider metadata compatibility repair

The first live development attempt returned a valid Gemini decision, but the initial adapter rejected the additive `usageMetadata.serviceTier` field. That failed v1 outcome and its $0.000257100000 reported cost remain preserved. The revised adapter ignores extra provider-envelope/usage metadata while validating known token counts, exact model/allowed choice, content parts and Jev probability consistency. Omitted Gemini thinking counts become zero only when valid input/output counts are present; absent or incomplete usage remains unknown. Google documents this field in its [usage metadata reference](https://ai.google.dev/api/generate-content#UsageMetadata). Prompts, options and transaction facts did not change. The revised implementation requires its separately versioned evaluation and CI; the failed trial is not retroactively marked passed.
