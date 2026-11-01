# Conversation acceptance: numbers worked, some conversations did not

The new assistant correctly handled the reported employee question and all required calculations in this development run. It still missed parts of eight conversations, so this version was **not accepted for deployment**. Production remains unchanged.

Think of two separate jobs: choosing what the person means, and doing the bookkeeping calculation. A calculator can produce the right answer to the wrong question. We checked both jobs separately.

| Check                                   | Observed result                               |
| --------------------------------------- | --------------------------------------------- |
| Real Gemini requests                    | 35 completed, one attempt each                |
| Complete conversations                  | 23 of 31 passed semantic review               |
| Individual conversation turns           | 27 of 35 passed semantic review               |
| Required financial results              | 20 of 20 correct after separate source review |
| All displayed financial values reviewed | 25 of 25 correct across 16 turns              |
| Test books                              | Unchanged: 10 accounts, 14 entries, 28 lines  |
| Tracked model cost                      | $0.1516175, below the approved $0.20 ceiling  |

The original automatic numerical checker recorded 18 verified facts and two failures. We preserved that result. The independent review found that one answer quoted the exact amount "$2,000" instead of the checker's longer expected phrase, and another used a valid whole-company profit query rather than explicitly listing account IDs. Both amounts and source scopes were correct. This separate review is not a replacement score or a fresh model run.

## What worked

For "can I fire an emplyee?", the assistant asked whether the person meant financial impact or employment policy. After the person supplied a hypothetical $4,000 monthly saving, three months and a $2,000 one-off cost, it calculated **$10,000**. When the person changed only that cost to $5,000, it retained the other assumptions and calculated **$7,000**.

It retained Office supplies after a short "October 2026" follow-up, excluded draft payroll from posted expenses, included refunds, preserved the exact Acme filter across months, displayed quiet months, and answered a combined profit-and-cash question with both numbers and a separate explanation.

## What failed and what changed afterward

| Finding                                                                                    | Follow-up work; not a measured improvement yet                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hiring clarification chose a meaning too early; three replies repeated the user's question | Clarify field descriptions and reject an exact echoed follow-up through the existing bounded repair loop.                                                                |
| Missing Equipment insurance account became a journal text search                           | Make account identification precede category queries; unknown accounts need a name/code clarification.                                                                   |
| Future revenue, performance, correction and live-FX replies omitted useful next steps      | Supply accurate product capabilities and relevant next-step guidance instead of unrelated report suggestions.                                                            |
| A correct bank balance was retrieved despite "without looking anything up"                 | Explicitly respect no-retrieval instructions and offer verification. This was a request-following failure, not a fabricated amount.                                      |
| General prose said that uncollected credit sales could cause negative accrual profit       | Add concise accounting reference facts. Delayed collection affects cash; it does not by itself remove earned accrual revenue. Generated prose still requires evaluation. |

Some failures were incomplete help rather than false financial figures. The false general explanation is a substantive accuracy failure. A valid schema or a "general knowledge" label does not make it correct.

## How this was tested

The cases and expected answers were written before this run against a synthetic, separately migrated PostgreSQL database. Ten independent SQL totals and 28 stored lines were checked before model inference. The 31 cases include three conversations with follow-ups, eight topic families, missing information, misleading requests and deliberate attempts to induce invented facts. Actual assistant responses became the next turn's context.

Source `3eed0b10d15072eb10979b7cc2157c615185000d` passed [combined CI](../conversation-combined-ci.json), including 2,731 normal tests, 35 browser workflows, database checks and Docker. The Compose tests overlap the normal suite; their counts are not added. These checks establish software behavior, not language understanding.

The [real-model run](https://github.com/rayidali/spiich_homework/actions/runs/41360352344) used Gemini 3.5 Flash-Lite and the composable route. A separate AI reviewer inspected all turns against their written requirements, and an independent evidence audit passed 654 checks of source, stored outcomes, costs and numerical evidence. Raw responses remain privately retained; [sanitized results and per-turn reasons](results.json) expose the outcome without credentials. The three temporary CI secrets were deleted and their absence verified.

This is an AI-authored development set and AI-assisted review, not a blinded research comparison or human certification. The later repair has not inherited this version's scores. No universal accuracy, successful deployment or perfect model behavior is established.
