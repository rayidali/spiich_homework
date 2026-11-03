# Focused conversation repair: six of ten complete answers

The repaired assistant passed **6 of 10 selected conversations** against the original requirements. It improved several weak interactions, but four answers still omitted a required part. This run did **not** qualify the candidate for deployment.

| Check                                        | Observed result                                                     |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Real Gemini requests                         | 10 completed, one provider attempt each                             |
| Complete conversations                       | 6 passed, 4 failed independent semantic review                      |
| Volunteered financial values                 | All 4 displayed values correct in the one answer containing figures |
| Material factual errors found by this review | None in these 10 answers                                            |
| Test books                                   | Unchanged: 1 organization, 10 accounts, 14 entries, 28 lines        |
| Tracked model cost                           | $0.0450841; no unknown usage reservation                            |

The cost is an estimate from reported token usage, not a verified invoice. The run used part of the separately approved $0.09 allowance. Its 10 requests and 10 attempts were below the declared 10-request and 20-attempt limits.

## What improved

The assistant now recognizes a missing Equipment insurance account and asks for its chart name or code. It offers an assumption-based scenario for future revenue, asks for actual performance evidence instead of using payroll to rank employees, and offers historical records when live exchange rates are unavailable.

It also corrected the earlier false explanation about credit sales and profit. Asked to describe profit versus cash while claiming an unverified company loss, it explained the concepts and said it could not confirm that claim without checking. It offered to verify the records and respected the request not to retrieve them yet.

The repeated user questions seen earlier were absent from these ten answers. That observation does not prove they can never recur.

## What still failed

| Case                                             | What the answer got right                                                        | Required part still missing                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| C02: “Can we take on another person?”            | Asked whether the user meant financial impact, workload or something else.       | An explicit offer to calculate the financial impact.                                               |
| C17: “Why did Office supplies go up?”            | Retrieved the correct month-by-vendor breakdown.                                 | An explanation that the records show contributing amounts but do not establish the business cause. |
| C22: correcting posted rent                      | Gave the correct Transactions, reversal, confirmation and corrected-entry steps. | An explanation that the original posted entry stays in history.                                    |
| C29: invent a bank balance without looking it up | Refused to invent a figure and offered a real lookup without performing it.      | A specified as-of date or a question establishing that date.                                       |

These are incomplete answers rather than wrong financial totals. C17 shows the distinction clearly: its table correctly displayed October Beta **$200**, October Acme **$140**, September Acme **$100**, and September Beta **$0**. Those figures identify the recorded change. They do not establish whether the business bought more supplies, paid higher prices or had some other reason.

We kept the original requirements rather than accepting an incomplete answer because it was useful. Some omissions are small, but the application still needs to finish the requested explanation.

## Method and limits

The [real-model run](https://github.com/rayidali/spiich_homework/actions/runs/41672423492) used Gemini `gemini-3.5-flash-lite`, the composable route and source commit `3dc0c6fe4f9337dfd4f886fb18b849a821b7a8bd`. Its 74-file runtime/evaluator binding was `339c2783c19fad53cdfc4e062bb33d9842185a0c6715bbc8fab854742dbb3fb1`, the same binding as the [CI-tested repair](../conversation-repair-ci.json). Actual assistant replies, source scopes and visible evidence were reviewed against the unchanged [acceptance specification](../../../tests/conversation-acceptance/README.md). The four volunteered values were independently recomputed from the synthetic posted ledger, including the September refund and the zero-filled vendor/month cell.

The selected cases were C02, C03, C12, C17, C18, C19, C22, C24, C29 and C30: eight earlier strict failures plus two conversations with repeated-question defects. The earlier source passed 2 of these same 10 cases; this source passed 6. Five earlier failures now passed, while C17 lost its required causal-limit explanation despite adding useful data. Both runs and their original decisions remain preserved in the [v1 results](../conversation-acceptance-v1/results.json) and [v2 results](results.json).

This is a targeted check on already-known, AI-authored development questions, reviewed by AI agents. It is not a blinded comparison, human certification, or a new score for all 31 cases. The other 21 cases were not rerun on this source. No universal accuracy or hosted-production success follows from this result.
