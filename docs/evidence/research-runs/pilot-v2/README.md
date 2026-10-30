# Development pilot v2: incomplete, diagnostic only

The run recorded **101/108 episodes** before Gemini exhausted its daily free-tier quota. Status counts are **83 ok, 9 blocked and 9 error**. An `ok` execution is not necessarily a correct answer. Seven planned attempts are missing. The full scoped ledger-and-corpus fingerprint was unchanged before and after the run.

Read the [bound validity notice](validity-notice.json) with the [raw report](report.html). The original results and episodes are preserved; the notice binds their result-file SHA-256. This pilot cannot select an architecture. The first R6 cash attempt includes an inferred completion-file read race; one R3 request returned upstream HTTP 504; four later requests returned the provider's daily-quota HTTP 429. The final circuit-open episode made no provider call.

## Recorded structured success

These denominators are **recorded attempts**, not the full planned set. Unequal completion and the diagnosed issues make this table unsuitable for ranking. The figures display development diagnostics only.

| Route | Structured successes / recorded attempts | Planned attempts missing |
| --- | ---: | ---: |
| R0 | 4/11 | 1 |
| R1 | 5/11 | 1 |
| R2 | 6/12 | 0 |
| R3 | 5/12 | 0 |
| R4 | 6/11 | 1 |
| R5 | 5/11 | 1 |
| R6 | 6/11 | 1 |
| R7 | 6/11 | 1 |
| R8 | 5/11 | 1 |

The provider reported `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 500, and an initial retry delay of 29,601 seconds (about 8 hours 13 minutes). This is a daily quota, so increasing the spacing between requests does not restore capacity. The account plan has not been upgraded by this study.

## Next experimental revision

The queued transport will wait for a complete terminal marker before parsing completion, preserving the original request deadline. R0 will receive the shared clarification/assumption output vocabulary within its existing single call. The broader routes' shared instructions will clarify that draft amounts belong in proposal lines and historical ledger facts require posted evidence. These are development amendments; guards, reference labels and original outcomes remain intact. The final revised source requires offline verification and a small live development smoke before held-out freezing.

The planned 1,620 held-out route episodes and 240 held-out reviewer outcomes remain unmeasured. A second key on the same Google project does not provide a separate quota. See [Google's rate-limit guide](https://ai.google.dev/gemini-api/docs/rate-limits) and [billing setup](https://ai.google.dev/gemini-api/docs/billing).
