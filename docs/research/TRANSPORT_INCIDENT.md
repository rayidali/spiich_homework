# Held-out transport interruption and bounded recovery

**2026-10-31 UTC. Current state: stopped at 777/1,620; recovery has not been executed.** This is an operational amendment after a recorded infrastructure incident. The inference source, prompts, reference labels, index, reviewer threshold and preregistered scoring remain frozen. No partial result has been used to choose an architecture or tune an answer.

## What happened

The continuous dispatcher had completed 2,938 requests successfully when its next external tool operation was delayed. The queued request was created at 03:57:24.879Z and received the helper's pre-tool start timestamp around 03:57:28.127Z. Its response/footer files appeared at 03:59:24.905Z with HTTP 200 and a curl duration of 1.508 seconds. This supports a delay around command launch or orchestration, rather than a provider taking two minutes to answer. The exact platform cause is not established; the estimated network-start time is an inference from file timing and curl duration, not a packet capture.

The original caller's 25-second deadline expired. Two following generation requests and the final database-fingerprint request were never claimed or dispatched. Three generation attempts retained unknown usage, opening the existing circuit breaker; the next route recorded its local circuit-open failure and the runner stopped. The dispatcher then stopped cleanly after 2,939 sent requests, all with HTTP 200/full footers/curl exit zero. Successful late transport does not turn the original timed-out trial into success.

| Preserved state                         | Value                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| Recorded / planned main trials          | 777 / 1,620                                                          |
| Still unattempted                       | 843                                                                  |
| Final four outcomes                     | Three `RESEARCH_HTTP_TIMEOUT`, then `RESEARCH_PROVIDER_CIRCUIT_OPEN` |
| Three retained unknown-use reservations | $0.0265945                                                           |
| Full-run final data fingerprint         | Unavailable (`AFTER_CHECK_UNAVAILABLE`)                              |
| Additional funded tracked usage at stop | Gemini $2.7598245; Jev $0.01617588                                   |

The [immutable interruption snapshot](../evidence/research-runs/holdout-v1/interruption-01/snapshot.json), [file hashes](../evidence/research-runs/holdout-v1/interruption-01/sha256-manifest.json), [dispatcher diagnostic](../evidence/research-runs/holdout-v1/interruption-01/dispatch-delay-diagnostic.json) and [incident review](../evidence/research-runs/holdout-v1/interruption-01/incident-review.json) preserve the original episodes, report, usage, manifests and unavailable after-check. The earlier [first-pass integrity audit](../evidence/research-holdout-first-pass-check.json) remains valid for its 540-trial scope. It was not a full-run after-fingerprint check.

## Why the old quota recovery cannot be used

The earlier quota helper requires evidence of three actual HTTP 429 daily-quota failures. This incident has no such evidence. Renaming it a quota reset, inventing a key change, deleting usage records, resetting the circuit, or rerunning failed cases would be incorrect. The existing funded allowance also cannot be reinstalled as a reset.

The user's standing instruction is to finish the study within the approved allowance. The operator may record that existing authorization for routine transport repair; there is no new purchase, larger spending cap or inferred fresh user approval. The private authorization identifies that basis explicitly. The additional ceilings remain $6.40 Gemini/$0.10 Jev, within the original cumulative $10/$4 limits.

## The bounded operational changes

The external [transport recovery tool](../../scripts/recover-study-transport.ts) lives outside the frozen inference tree. It binds the actual timeout episode/usage IDs, complete usage prefix, existing policies and quota journal, incident evidence, fixed probe request/key, source/protocol and reviewed dispatcher files. It checks the original policies and caps through their existing exported validation functions. Its narrow fixed-probe pricing is checked against the frozen budget implementation in synthetic tests.

Preparation requires no active runner, dispatcher or outstanding queue work. Execution requires its exact newly activated sole dispatcher, and holds the existing budget and runner locks. An append-only operational journal consumes the permit before reserving and sending **one fixed Gemini 3.5 Flash-Lite availability request**, with a 25-second deadline and 128-output-token maximum. Its conservative reservation is $0.0010841. It contains no financial question or document, and has no retry.

Only HTTP success, exact expected output, valid reported usage within the reservation, matching frozen source and a drained single-request dispatcher can produce verified success. Durable verification is written before the new probe record becomes known-cost. Failed, malformed, interrupted or over-bound probes retain an unknown-cost record and at least their conservative charge, leaving the unchanged runtime circuit blocked. Original records, reservations and policies are never replaced. The tool never restarts the study or retries an episode.

The private launch guard moves ownership, replay, pacing and absolute-deadline checks into the local command that supplies curl configuration. An expired request receives the existing timeout footer and **no network URL**. This reduces the stale-deadline window; it does not make a chat-hosted dispatcher durable or guarantee that the operating system cannot pause later. Request deadlines are not enlarged. Its 22 synthetic tests and harmless local file-only invocation passed, with independent review. No default curl configuration was present in the observed environment. Private queue files and credentials remain excluded from publication.

## Verification and continuation criteria

The final recovery implementation passed **35 new synthetic tests plus 28 existing quota-recovery tests (63 total)**, strict TypeScript and formatting checks. Independent review checked immutable history, allowance enforcement, one-shot consumption, wrong credentials/owners, concurrency, partial writes, failures with reported tokens and crash ordering. Root additionally found a portability problem: tests depended on ignored helper files in the local workspace. That dependency is fixed: helper bindings follow the usage-ledger directory, and tests supply synthetic helper files in their own temporary fixtures. Independent review reran all35 tests in a clean checkout with no private `.tools` directory; all passed. These engineering checks do not establish provider availability.

Before continuation, publish/review the operational change and its checks, preserve the interruption, bind a short-lived permit to this exact incident, and execute at most its one probe with the new launch guard. A successful probe establishes momentary availability only. The same `holdout-v1` runner must then verify a fresh complete ledger/document/vector fingerprint against its original `before.json` and match all frozen settings.

Continuation skips all 777 recorded IDs, including failures. The remaining 843 cells keep their original route order/questions/repetitions. The final analysis must retain the interruption, the four failed trials, unknown reservations and recovery overhead; missing service timing stays unknown. End-to-end and conditional results remain distinct. No final score, completed study or winning architecture is claimed by this document.
