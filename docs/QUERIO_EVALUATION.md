# Querio test results, explained simply

**November 3, 2026 · Real API calls against synthetic accounting books**

**Querio is connected and tested. Sonnet produced better rent answers than Haiku in our small matched check, but neither passed every conversation rule. Daybook’s live chat has not been replaced.**

We connected a separate Neon database called **Daybook accounting test books** in Querio. It contains 48 fictional, balanced journal entries and 96 lines. A restricted database user can read four accounting views; it cannot edit the books or see the other test business’s records. Our production accounting tables stayed unchanged.

## What we tested

Imagine a calculator with an assistant beside it:

```text
Your question → AI writes SQL/Python → database returns records
              → calculation produces a table → AI explains the answer
```

We checked every step. A working database connection does not prove the right records were selected. A correct calculation does not prove the explanation repeats it correctly.

Before running the questions, we fixed eight cases, ten user turns and 32 required final results. An independent Python calculation supplied the answers. A separate check compared all stored fixture records and passed 2,971 assertions; those are engineering checks, not 2,971 model questions. Another AI agent reviewed the actual queries, results, conversation and additional claims. This was not a blinded study or human-accountant audit.

The data deliberately includes refunds, months without expenses, an unposted draft, a different business and a future-dated transaction. It uses USD only. The AI received ordinary accounting rules and schema descriptions, never the expected answers. Questions and follow-ups were preserved exactly, including the assistant’s actual earlier replies.

## Results with the economical model

With **Claude Haiku 4.5**, all eight cases executed successfully after the session fix described below. **Three of eight answers passed the full financial review.** A passing answer needed correct results, correct meaning and supported extra claims.

| Question                                                           | Result            | What happened                                                                                                       |
| ------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Monthly rent, followed by “this year” and the denominator          | Fail              | Replaced undefined months with 0%; the summary invented 23.81% while its own annual calculation showed 58.33%.      |
| All twelve 2025 monthly rent percentages                           | Precision failure | Underlying calculations were correct; September displayed 33.3%, below the fixed two-decimal requirement of 33.33%. |
| Rent as one annual percentage for 2025                             | Pass              | $1,200 ÷ $2,050 = **58.54%**.                                                                                       |
| Average of 2025 monthly rent percentages                           | Fail              | The notebook calculated **49.81%** and nine months correctly; the summary said **33.93%**.                          |
| Median monthly spending in 2025                                    | Fail              | The median **$150** was correct, but the explanation invented incorrect counts of quiet and positive months.        |
| October 2025 Marketing with exactly Alpha, divided by all expenses | Pass              | $120 ÷ $500 = **24.00%**, with the correct separate filters.                                                        |
| January and August 2025: zero total expenses                       | Fail              | Both percentages were undefined correctly, but January’s known zero activity was presented as unavailable amounts.  |
| June and November 2025: refunds changing the shares                | Pass              | Correctly returned **−100%** and **200%**, with supported explanations.                                             |

The required-result tally was **22/32 correct**: eight incorrect zeros, one contradictory mean and one precision mismatch. These results are correlated rows, not 32 independent questions. Correct required numbers did not excuse invented additional claims. Only three notebooks retained saved cells; the other cases still had captured execution evidence. Notebook persistence was reviewed separately, not added afterward as a new financial scoring rule. [Detailed Haiku evidence](evidence/querio-evaluation-haiku.json).

## Checking Querio’s default model

To avoid judging the product only by its cheaper model, we repeated the **two original rent cases** with **Claude Sonnet 5.5**. Only model selection changed; questions, accounting instructions and fixture stayed the same. These cases were selected development diagnostics, not an eight-case retest.

| Same two rent cases                          | Haiku |    Sonnet |
| -------------------------------------------- | ----: | --------: |
| Correct required final results               | 14/23 | **23/23** |
| Entire conversations passing the fixed rules |   0/2 |   **1/2** |

Sonnet’s remaining failure was **clarification**, not a wrong final calculation: it openly assumed “this year” and “share of total expenses” before the user confirmed them. Our prewritten rule required asking first. Its eleven monthly results, annual 58.33% and explanations were consistent. The other twelve-month question passed, including September’s 33.33%. Both analyses retained notebook cells. This is promising evidence on two questions, not proof that Sonnet or Querio will answer every financial question correctly. [Detailed Sonnet evidence](evidence/querio-evaluation-sonnet.json).

## What went wrong during connection

The documented run-creation POST returned HTTP 406. The documented message-events POST worked and returned durable run IDs that we could inspect. Reusing one execution environment then caused five later questions’ tools to report “Session is closed,” despite API status `completed`. Creating a fresh environment per case removed that observed failure. The initial six-case/eight-turn attempt remains preserved and is not mixed into the model comparison. [Querio’s API lifecycle](https://docs.querio.ai/api-v3).

Accounting instructions were uploaded before sessions started, at the documented datasource knowledge path with `context: always`. Readback matched exactly; the context root was correct. We did not inspect the complete resolved provider prompt. [Querio’s context rules](https://docs.querio.ai/reference/context).

Across setup investigation and both completed configurations, we submitted **22 user turns**, including repeats. One user turn can generate multiple model calls. All created execution environments were closed. Final fixture records and production accounting fingerprints matched their starting values. No subscription was purchased; provider token metadata was retained, but a verified Querio dollar charge or account balance was unavailable.

## What this means for Daybook

The useful discovery is simple: **the calculator can be right while the assistant’s explanation is wrong.** Broader SQL and Python generation helps answer new questions, but it needs reliable account definitions, correct dates and denominators, and a final answer whose numbers come directly from checked results.

Sonnet is the more promising configuration on the two matched rent cases. I would test the remaining six cases before considering a production change. There is no current paired winner against Daybook’s new generated-analysis candidate: its live-model run has not happened. Different data interfaces also prevent treating a product comparison as a pure architecture experiment.

Open **Daybook accounting test books** in Querio’s datasource list to explore the connection. Use the saved Sonnet analyses for the retained rent tables. These are fictional test books; Daybook’s hosted chat still uses its existing implementation.

The added fixture code also passed [full application CI](evidence/querio-evaluation-ci.json): 2,942 tests, all 37 browser workflows, Docker startup, automatic jobs and persistence. Those engineering checks are separate from the answer scores above. Source, evidence and the refreshed submission archive are saved.
