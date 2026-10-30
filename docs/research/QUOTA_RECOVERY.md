# Explicit recovery and the one-cent key check

The second development pilot stopped after Gemini's daily free-tier quota was exhausted. The ordinary budget circuit blocks further generation after three attempts with unreported usage. Failed records and their conservative cost reservations are retained. This helper does not change the pilot's results or restart an experiment.

**One user-authorized replacement-key check succeeded on 2026-10-30 at 23:52:57 UTC. Ordinary research calls remain blocked.** The fixed `gemini-3.5-flash-lite` request returned HTTP 200 in 878 ms, with 14 input and 5 output tokens. Its reported-usage cost estimate was **$0.0000167**; the initial conservative reservation was $0.0010841. These are local estimates, not an invoice or a measurement of account balance. See the [probe receipt](../evidence/gemini-key-check-2026-10-30.json).

The persistent policy allowed at most **$0.01 additional Gemini usage, $0 Jev usage and one additional request**. That request is now consumed. Verification reconstructed `StudyBudget` with its ordinary defaults and confirmed that normal calls were rejected before reaching transport. The ledger has 841 records, with the original 840-record prefix unchanged. No study restarted, hosted credentials were not changed, and no File Search/index access was tested with the replacement key. Billing activation, project identity and remaining account balance are unknown; the larger-budget decision is pending. See the [spending checkpoint](../evidence/gemini-frugal-checkpoint.json).

## Prerequisites

At permit creation, the helper accepts only the latest three Gemini generation records when all three have HTTP 429, unknown usage, the same pinned `gemini-3.5-flash-lite` model, and membership in the run described by the sanitized daily-quota evidence. The permit binds the complete usage snapshot, those records, the evidence, authorization, unchanged original budget limits and the exact fixed request, including its private credential. When a restrictive policy is installed, its hash is bound too. A permit cannot be reused with a different key, model, payload, policy or history.

Three authorization reasons are implemented:

| Reason                          | Required observation                                                                                                                                      | Used for this checkpoint?                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `user_configured_key_change`    | The user requests testing a replacement key; private comparison confirms it differs from the previous key; a one-request restrictive policy is installed. | Yes. It makes no claim about project identity, billing or quota reset. |
| `user_confirmed_billing_change` | Actual user confirmation that billing changed for the same project after the quota failure.                                                               | No. This remains a generic capability.                                 |
| `documented_daily_quota_reset`  | The documented reset window has passed and the operator explicitly authorizes a probe.                                                                    | No. This remains a generic capability.                                 |

Old usage records do not contain credential fingerprints. The previous-key fingerprint is an operator audit assertion derived from known private request evidence; the helper does not independently recover historical account identity. Fingerprints and credential bindings stay private.

The observed quota was 500 daily requests per project and model; see [dispatch evidence](../evidence/dispatch-pilot-v2.json). Google documents a daily reset at midnight Pacific and cautions that actual capacity can vary. The helper converts that reset with the Pacific time zone and adds a one-minute margin. For this incident, the earliest reset-based probe is **2026-10-31T07:01:00Z**, or 03:01 Eastern. Passing that time alone does not execute anything. [Google quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits)

The study runner and dispatcher must be stopped with no outstanding request before changing transport formats or preparing recovery. Existing pilot-v2 raw records remain immutable. A new attempt receives a separate `recovery-probe:` identity.

## Persistent restriction for a replacement-key check

Before preparing a key-change permit, the operator installs the policy through this offline API in a private local script:

```ts
const budget = new StudyBudget('.tools/research/usage.json');
const policy = await budget.installKeyCheckPolicy('Private reference to the actual user request');
```

This performs no provider call. Under the existing budget lock, it records the complete baseline record count/hash and per-provider spend, counting unknown usage at its reserved amount. It writes `usage.json.policy.json` and the required-policy marker `usage.json.policy-required.json` beside the private usage ledger. The policy fields are:

| Field                                                        | Meaning                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `schemaVersion`, `id`, `createdAt`, `authorizationReference` | Version 1 and private audit metadata                     |
| `mode`                                                       | Exactly `fixed-key-probe-only`                           |
| `baselineCount`, `baselineHash`, `baselineSpendUsd`          | Bound, unchanged historical prefix and its tracked costs |
| `additionalAllowanceUsd`                                     | Exactly `{ "gemini": 0.01, "jev": 0 }`                   |
| `maximumAdditionalAttempts`                                  | Exactly 1                                                |

Every `StudyBudget` reservation using this ledger checks the installed restriction under the lock, including recovery dry-runs. The baseline must still match; new usage counts actual estimates where available and conservative reservations otherwise. Original dollar/attempt caps still apply. Ordinary generation, retrieval, embedding, indexing and Jev calls are prohibited by this mode; it permits only the already validated fixed probe. Restarting a process with the old $10 Gemini / $4 Jev defaults does not remove the policy.

Installation cannot overwrite or reset an existing policy. Missing, malformed or mismatched policy/marker state fails closed; after the probe, the recovery journal also anchors the required policy. The consumed request stays consumed even if it failed or used less than one cent. Neither successful output nor unused monetary allowance authorizes another request. A larger-budget answer requires an explicit reviewed change; do not delete the policy to continue.

## Private authorization and permit

Create an authorization JSON under ignored `.tools/research/` only after the prerequisite has been established. A replacement-key authorization has this shape:

```json
{
  "reason": "user_configured_key_change",
  "confirmedAt": "<actual user request timestamp>",
  "notBefore": "<start of explicit execution window>",
  "expiresAt": "<end of window, at most one hour later>",
  "evidenceReference": "<private reference to the actual user request>",
  "keyChange": {
    "observedAt": "<private comparison timestamp>",
    "previousFingerprint": "<private SHA256 of the exact prior key>",
    "currentFingerprint": "<private SHA256 of the exact replacement key>"
  }
}
```

These placeholders are not an executable artifact. Use ISO 8601 timestamps and private 64-character hashes. The exported `credentialFingerprint(key)` helper computes the hash; keys must never appear in command arguments or public artifacts. The two fingerprints must differ, the current fingerprint must match the fixed request, and the comparison must follow the user request and precede execution. The operator verified these prerequisites for the completed check. They do not establish whether the replacement key belongs to the same Google project.

For the generic reset path, the authorization instead contains exactly:

```json
{
  "reason": "documented_daily_quota_reset",
  "confirmedAt": "2026-10-31T07:01:00Z",
  "notBefore": "2026-10-31T07:01:00Z",
  "expiresAt": "2026-10-31T07:31:00Z",
  "evidenceReference": "Explicit operator decision and documented reset observation"
}
```

These are example timestamps, not a pre-created authorization. The billing-change path uses the same fields with reason `user_confirmed_billing_change`; its confirmation must follow the latest quota failure and describe an actual user-confirmed action. Only the key-change reason accepts `keyChange`. All execution windows may be at most one hour. Artifacts and exact credential/request bindings stay private.

Preparing the permit performs **zero provider calls**:

```sh
node --import tsx scripts/research/recover-quota.ts prepare \
  --authorization .tools/research/recovery/authorization.json \
  --quota-evidence docs/evidence/dispatch-pilot-v2.json \
  --permit .tools/research/recovery/permit.json
```

The CLI reads the existing `GEMINI_API_KEY` privately from `.env` and automatically binds any installed restrictive policy. Do not paste a key into command arguments or documentation. A changed usage snapshot or evidence file invalidates the permit; the helper does not silently rebind it. The completed key-check permit is consumed; these commands describe the workflow, not permission to repeat it.

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

Success requires HTTP 2xx, valid exact output and valid reported token counts. A safe public receipt records the outcome, timing, token counts and cost accounting; it excludes credentials, request bindings, response bodies and private authorization references. The private recovery journal is stored beside the usage ledger as `usage.json.recovery.json`.

Any failure or interruption keeps ordinary Gemini calls blocked. A crash after consumption cannot be retried with the same permit. A token-reported but malformed answer also stays blocked, even though its cost can be measured. Missing usage retains the new reservation. Do not delete the recovery journal or manufacture a successful record to resume.

Budget locks, including apparently stale PID locks, now fail closed instead of being removed automatically. A leftover lock requires explicit investigation of the owning process, queue and recovery journal before any audited cleanup. This avoids two processes replacing the same stale lock and both entering the budget writer.

A successful receipt only demonstrates momentary availability. Its `RECOVERED` outcome does not override an installed probe-only policy. It does not prove paid-tier status, project identity, remaining balance/quota or capacity for the planned full study. Starting a new development run or held-out experiment requires a separate explicit decision and reviewed policy change. No previous failed episode is replaced.

## Verification and limits

`tests/research-recovery.test.ts` covers one-shot consumption, unchanged history/costs, wrong key/model/payload, stale evidence, early and expired permits, active locks, monetary and attempt caps, concurrent/repeated use, crash state, malformed output, missing tokens, provider errors and Pacific reset conversion. All tests use synthetic inputs and injected transport; they measure safety behavior, not provider availability.

`tests/research-key-check.test.ts` adds 18 offline regressions covering fixed-policy installation, restart persistence, the one-cent/one-request limits, zero Jev allowance, unknown-cost retention, missing/malformed policy state, immutable history, private key-change evidence and blocking after successful output. The real checkpoint separately verified rejection before transport in a reconstructed budget instance.

The helper is intentionally narrow. It cannot clear arbitrary network-error circuits or infer billing activation. After a failed probe, the newest records include `recovery-probe:` rather than only the original pilot ID, so the original pilot evidence cannot authorize another permit. A new confirmation or another permit file alone will not recover it. Further diagnosis and a separately reviewed recovery path with evidence bound to the new failure are required; no general circuit-reset option exists. The evidence artifact is a reviewed observation, not provider-signed quota attestation.

The probe uses the same `generationConfig.responseFormat.text` wire grammar as the existing research Gemini client. One live fixed-output probe now succeeded with the replacement key. This establishes neither financial-answer accuracy nor access to the previously indexed documents; broader application and held-out tests remain separate work.
