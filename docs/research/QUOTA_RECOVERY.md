# Explicit quota recovery

The second development pilot stopped after Gemini's daily free-tier quota was exhausted. The ordinary budget circuit remains closed after three generation attempts with unreported usage. Failed records and their conservative cost reservations are retained. This helper does not change the pilot's results or restart an experiment.

Recovery is implemented and tested offline. **No recovery probe has been executed at this checkpoint.** Execution requires an explicit operator action after a confirmed billing change for the same project or the documented daily reset. Permission to implement the helper does not constitute confirmation that billing changed.

## Prerequisites

The helper accepts only the latest three Gemini generation records when all three have HTTP429, unknown usage, the same pinned `gemini-3.5-flash-lite` model, and membership in the run described by the sanitized daily-quota evidence. The permit binds the complete usage snapshot, those records, the evidence, authorization, unchanged budget limits and the exact fixed request, including its private credential. It cannot be reused with a different key, model, payload or history. Historical project identity is an operator-confirmed prerequisite; the old usage records do not contain credential fingerprints.

The observed quota was 500 daily requests per project and model; see [dispatch evidence](../evidence/dispatch-pilot-v2.json). Google documents a daily reset at midnight Pacific and cautions that actual capacity can vary. The helper converts that reset with the Pacific time zone and adds a one-minute margin. For this incident, the earliest reset-based probe is **2026-10-31T07:01:00Z**, or 03:01 Eastern. Passing that time alone does not execute anything. [Google quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits)

The study runner and dispatcher must be stopped with no outstanding request before changing transport formats or preparing recovery. Existing pilot-v2 raw records remain immutable. A new attempt receives a separate `recovery-probe:` identity.

## Private authorization and permit

Create an authorization JSON under ignored `.tools/research/` only after the prerequisite has been established. It contains exactly:

```json
{
  "reason": "documented_daily_quota_reset",
  "confirmedAt": "2026-10-31T07:01:00Z",
  "notBefore": "2026-10-31T07:01:00Z",
  "expiresAt": "2026-10-31T07:31:00Z",
  "evidenceReference": "Explicit operator decision and documented reset observation"
}
```

These are example timestamps, not a pre-created authorization. The alternative reason is `user_confirmed_billing_change`; its confirmation must follow the latest quota failure and describe an actual user-confirmed action. The execution window may be at most one hour. The artifact and exact credential/request bindings stay private.

Preparing the permit performs **zero provider calls**:

```sh
node --import tsx scripts/research/recover-quota.ts prepare \
  --authorization .tools/research/recovery/authorization.json \
  --quota-evidence docs/evidence/dispatch-pilot-v2.json \
  --permit .tools/research/recovery/permit.json
```

The CLI reads the existing `GEMINI_API_KEY` privately from `.env`. Do not paste a key into command arguments or documentation. A changed usage snapshot or evidence file invalidates the permit; the helper does not silently rebind it.

## One explicit probe

Only after the prerequisite and permit have been reviewed, invoke:

```sh
node --import tsx scripts/research/recover-quota.ts execute \
  --authorization .tools/research/recovery/authorization.json \
  --quota-evidence docs/evidence/dispatch-pilot-v2.json \
  --permit .tools/research/recovery/permit.json \
  --receipt docs/evidence/quota-recovery-result.json
```

The default transport is native fetch. The environment's existing `RESEARCH_TRANSPORT=queue` path can be used with an explicitly started dispatcher; it does not require a study runner. Do not start another runner or dispatcher. The private queue files contain credentials and must not be published.

The fixed same-model request asks only for `{"ok":true}`, with no documents, financial tools or study questions, at most 128 output tokens and a 25-second request deadline. There is no retry. The permit is consumed under the budget lock before reserving or dispatching. Dollar and attempt caps still include every unknown historical reservation. An active runner, pending recovery, changed record, early/expired permit, exhausted cap or reused permit results in zero provider calls.

Success requires HTTP2xx, valid exact output and valid reported token counts. A safe public receipt records the outcome, timing, token counts and cost accounting; it excludes credentials, request bindings, response bodies and private authorization references. The private recovery journal is stored beside the usage ledger as `usage.json.recovery.json`.

Any failure or interruption keeps ordinary Gemini calls blocked. A crash after consumption cannot be retried with the same permit. A token-reported but malformed answer also stays blocked, even though its cost can be measured. Missing usage retains the new reservation. Do not delete the recovery journal or manufacture a successful record to resume.

Budget locks, including apparently stale PID locks, now fail closed instead of being removed automatically. A leftover lock requires explicit investigation of the owning process, queue and recovery journal before any audited cleanup. This avoids two processes replacing the same stale lock and both entering the budget writer.

A successful receipt only demonstrates momentary availability. It does not prove paid-tier status, remaining quota or capacity for the planned full study. Starting a new development run or held-out experiment is a separate explicit decision. No previous failed episode is replaced.

## Verification and limits

`tests/research-recovery.test.ts` covers one-shot consumption, unchanged history/costs, wrong key/model/payload, stale evidence, early and expired permits, active locks, monetary and attempt caps, concurrent/repeated use, crash state, malformed output, missing tokens, provider errors and Pacific reset conversion. All tests use synthetic inputs and injected transport; they measure safety behavior, not provider availability.

The helper is intentionally narrow. It cannot clear arbitrary network-error circuits or infer billing activation. After a failed probe, the newest records include `recovery-probe:` rather than only the original pilot ID, so the original pilot evidence cannot authorize another permit. A new confirmation or another permit file alone will not recover it. Further diagnosis and a separately reviewed recovery path with evidence bound to the new failure are required; no general circuit-reset option exists. The evidence artifact is a reviewed observation, not provider-signed quota attestation.

The probe uses the same `generationConfig.responseFormat.text` wire grammar as the existing research Gemini client. Its own live provider execution remains untested; offline validation is not a claim of live readiness.
