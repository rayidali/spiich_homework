# Why Gemini rejected the request, and what changed

The observed failure was a request-compatibility problem. Gemini returned **400 / INVALID_ARGUMENT**, with “Request contains an invalid argument.” It did not report exhausted credit or quota. The account balance was not checked. Google did not identify which internal validator rejected the request, so schema complexity remains a hypothesis.

## The experiment in ordinary language

Imagine asking a librarian for the August repair-parts receipts from Wheelhouse. Our message included a very detailed form the librarian had to complete. Gemini rejected that request before returning the form.

We changed one setting: instead of forcing the provider to produce a function call (`ANY`), we let it choose one (`AUTO`). The same question and full form were accepted. Daybook still requires exactly one known function and validates every field before using it. Free-form numerical prose is never accepted as a financial answer. AUTO can return prose and therefore still fail our application checks; one acceptance does not prove reliable tool use.

| Probe                  | What changed from the original                           | Actual observation                                                                                                                                         |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original               | Nothing: exact archived request bytes                    | HTTP 400; generic invalid-argument error.                                                                                                                  |
| Mode only              | Function-calling configuration only: ANY → AUTO          | HTTP 200, but the response pointed to the wrong conversation message and used a table reference where a single value was required. The guards rejected it. |
| Reference instructions | AUTO plus general instructions explaining existing rules | HTTP 200; correct August/vendor/category query, original-user reference and single-value binding. One outer JSON wrapper was missing.                      |

All three probes used the same known development conversation. They are troubleshooting steps, **not three independent accuracy tests or a comparison score**. The historical failed experiment remains closed and unchanged; no held-out question was inspected or executed.

## Two small response mistakes exposed after acceptance

For a conversation `[you, assistant, you]`, computer positions are `0, 1, 2`. Gemini first attributed the second thing you said to position `1`. That points to the assistant. We clarified the general counting rule; we did not silently change the model's reference.

A question asking “how much?” needs a value from a specific row, not a reference to an entire table. We explained that distinction too. The third response got both right, but wrote `answerContract: [items]` where the form expects `answerContract: {outputs: [items]}`. The adapter now adds only that missing outer wrapper, then runs the same strict validation. It does not change the requested dates, account, vendor, quotations, row references, calculations or amounts. Follow-up attempts to replace the original declaration still fail.

The [before](instructions-validation-before-wrapper.json) and [after](instructions-validation-after-wrapper.json) receipts preserve this distinction. The after-check proves unchanged semantic fields and valid pre-execution structure; it does not itself execute a database query. [Mode-only validation](mode-only-validation.json) preserves the earlier rejected response rather than relabeling it successful.

## Checking the real answer

The new regression copies the third response's exact function arguments into the actual application and uses real PostgreSQL. The external model response is replayed; there is no additional paid inference.

The synthetic books contain two matching posted August purchases, **$100 + $65 = $165**. They also contain July and September purchases, a different vendor, a different expense category and an August draft. The test passed: exact August/Wheelhouse/repair-parts scope, bound **$165.00** as posted evidence, exactly one mocked provider call, and every account, journal and line unchanged. The completion declaration still says `userIntentVerified:false`: the software checks the declaration, not universal language understanding.

[Full CI 41277460581](https://github.com/rayidali/spiich_homework/actions/runs/41277460581) passed at source `49a0d81b5f0c588af39d10bee7ae164f96d955a2`: **2,449 normal tests/120 files**, four separate PostgreSQL fixture cases and **32 browser workflows**. Eight normal cases/two files skipped. Native research and Docker Compose also passed, including scheduling, anomaly lifecycle and persistence checks. The [exact-source receipt](ci.json) records counts, overlaps and skips. The captured regression is included in the normal total; Compose repeats many of the same tests. Browser workflows use the CI build and scripted AI responses; they are not a hosted live-model test. The replay does not establish broad answer focus or performance on unfamiliar questions.

## Cost and current state

Known usage estimates across the original failed development and this diagnosis total **$0.0303324**. Counting every unknown response and even two local DNS failures at their full reservations gives **$0.1717792** against the already approved **$0.90** ceiling. These are estimates and reservations, not an invoice or a verified remaining balance. [Exact accounting and run/request/response identities](closure.json).

The three remote slots are consumed, the diagnostic is closed, and its temporary GitHub key secret was removed after the final response. No further provider call is pending. The saved local key is unchanged.

The repair is a candidate in the repository. The hosted product remains on `93a8617` / `composable`; the experimental `complete` route has not been promoted. A fresh comparison is still needed before choosing a new winner. No old score was transferred to this changed source.

Safe error categories are now retained server-side with bounded reads; provider prose, keys and prompts stay out of ordinary logs and client errors. Raw responses are excluded from this report and the source archive. Their temporary GitHub Actions artifacts were removed after verifying byte-identical local archives; the [retention receipt](raw-artifact-retention.json) preserves their hashes and this access-history limitation. The [original failed study](../completeness-runs/development-v1/report.md) remains the historical record.

[Evidence and source hashes](provenance.json) bind the published receipts to the repaired candidate.
