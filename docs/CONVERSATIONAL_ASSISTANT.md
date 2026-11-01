# Conversational assistant work in progress

**Repair verification:** source `181dcfdeabb8867ff162f0833153c8f5473c6280` passed [full CI](evidence/conversation-repair-ci.json), including2,767 normal tests,35 browser workflows, PostgreSQL and Docker. A prepared ten-case focused model check requires a new approval, currently pending. Production and the original v1 scores remain unchanged. No live understanding improvement has yet been measured.

**Latest evidence:** source `3eed0b10` passed combined CI and completed the approved real-model evaluation: 23/31 conversations and 27/35 turns passed semantic review. All 20 required numerical facts were correct in separate source review; original automatic failures remain preserved. [Results, failures and costs](evidence/conversation-acceptance-v1/report.md). Production is unchanged. The current echo/account/next-step/reference repairs are a different, unmeasured version.

The original `question` field lacked a clear semantic description, and some model responses copied the user's question into it. The repair adds descriptions and rejects an exact latest-user echo after whitespace/case normalization. The existing bounded repair loop receives only a finite `repeated_user_question` reason; it does not silently replace the response or introduce another budget. Scripted tests exercise successful repair and exhaustion on both composable/adaptive paths. This mechanical check does not prove relevance or truth.

The prompt now distinguishes unknown chart accounts from no matching text records; explains actual correction navigation and useful next steps for missing data; respects explicit no-retrieval requests; and supplies concise accounting reference facts. [SEC's introductory financial-statement guide](https://www.sec.gov/files/investor/pubs/begfinstmtguide.htm) supports the profit/cash distinction. Instructions are not enforcement of arbitrary prose truth, so fresh focused model verification remains necessary.

The user restarted the broader reliability goal after “can I fire an emplyee?” received a generic off-topic refusal. The goal remains active. A deployed accounting engine and a passing test suite do not establish that arbitrary questions are understood accurately.

## What caused the reported response

`request_details(reason=off_topic)` maps to a fixed sentence in `server/chat-clarification.ts`. There is no employee-keyword blocker. The deployed planner chooses a financial tool or one of several canned clarification reasons. The quoted response identifies that source path, but this incident has not been correlated with an individual runtime request; the actual provider arguments are not claimed as observed.

The missing behavior is a conversation about the intended business question. Staffing, pricing, purchases and expansion can involve finances, practical constraints or permission. The assistant should distinguish those meanings, then ask only for the missing information relevant to the chosen question.

## Current candidate

`discuss_business` is a small structured tool beside the existing queries and exact calculator. It allows a short explanation, a focused clarification or a specific limitation with a useful next step. Its text is generated for the conversation rather than selected from an employee-specific template. The production composable planner and optional adaptive planner offer it, including adaptive continuation. The experimental authored and complete grammars do not.

The tool accepts `kind`, `message` and an optional `question`. Strict validation rejects extra properties, fabricated evidence fields, oversized text and a clarification with no question. Application code returns no financial evidence and attaches `verifiedFinancialData: false`; it never lets the model choose that flag. The UI distinguishes general explanations, follow-up questions and information gaps from actual record/scenario evidence. It renders model content as plain React text.

The model is instructed to use financial tools for company figures and arithmetic, preserve prior user constraints, avoid inventing company circumstances, and avoid definitive current-law or employment-permission claims. A simple cost reduction does not require unrelated cash-reserve or receipts assumptions. Questions about future liquidity do require relevant future commitments and assumptions.

Mixed concept-and-figures questions can now use a small `generalExplanation` field on an existing financial tool. For “What is profit and what was ours last month?”, the same call supplies a general definition and selects the profit report. Application code removes the explanation before the unchanged financial parser/executor, and returns it separately from the checked answer and evidence. Invalid financial work cannot become a success by supplying an explanation. No extra provider call or copy of the query grammar is added. The UI preserves both displayed texts in later conversation turns through a shared helper. This enables the composition; live tests must still establish that the model chooses it correctly.

For example, after a natural clarification, a user can supply a $4,000 monthly reduction, three months and a $2,000 one-time cost. The existing calculator produces $10,000 from those explicit assumptions. This is a hypothetical cost comparison, not a recommendation to dismiss someone or a prediction about revenue. The integration test uses a scripted model response and the real calculator; it does not demonstrate live interpretation of that wording.

## What is and is not enforced

| Boundary                           | Enforcement or limitation                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Posted history and writes          | Existing accounting constraints and read-only chat remain unchanged. Conversation cannot execute a write.                                                                                                     |
| Financial query/calculator answers | Existing account/date/source/decimal validation remains in the financial tools.                                                                                                                               |
| Conversation metadata              | Server-owned, with no financial evidence. The model cannot forge posted evidence or verification flags through this tool.                                                                                     |
| Conversational text                | Generated language. Schema validity, a general-explanation label and prompt instructions do **not** prove semantic truth or exclude all unsupported assertions.                                               |
| Provider work                      | Uses the existing bounded planning/repair session; no additional model pass is added for an ordinary conversational reply.                                                                                    |
| Diagnostics                        | Logs finite reply-kind and legacy clarification-reason enums with the request ID. It does not log raw questions, answers, account names or tool arguments.                                                    |
| Mixed requests                     | A general concept explanation can accompany a checked financial result. It cannot interpret results the model has not read. Arbitrary multi-part completion and correct interpretation still require testing. |

This candidate deliberately does not add a superficial digit blacklist or call another model a truth oracle. A model could still choose an inappropriate response or put an unsupported assertion in prose. That is a live acceptance failure even when the HTTP response and schema are valid.

## Verification and remaining work

The new [conversation acceptance specification](../tests/conversation-acceptance/README.md) contains varied, independently authored synthetic scenarios, explicit expected facts and semantic criteria. It is a development acceptance set, not a blinded scientific study. Multi-turn evaluation must feed back the actual candidate's previous answer; fixed canned assistant turns would skip the behavior being tested.

Offline contracts cover tool parsing, bounded repair, retained conversation, a real hypothetical calculation, no unintended amount reads, diagnostic privacy and UI source labels. Browser tests use scripted responses and therefore establish presentation/transport, not model understanding. The independent fixture checks verify test data and expected arithmetic, not product accuracy.

The first conversational candidate, `77dabb34722f5dc98adf943553d9a50bd87e01a4`, passed [full CI including browser and Compose](evidence/conversation-candidate-ci.json). That evidence does not cover the later mixed-explanation and acceptance-runner changes. The combined candidate needs its own full CI, a new bounded real-model evaluation, semantic review of unsupported claims and unnecessary clarifications, and actual hosted acceptance before promotion. Existing closed research/acceptance cohorts stay closed. Their scores are not transferred to this changed source, and no additional provider spending is implied by these files.

The broader goal also requires better completion of multi-part questions, investigation of every observed failed case and fresh regression coverage. No universal interpretation or zero-error claim follows from adding these tools.
