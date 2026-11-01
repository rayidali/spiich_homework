# Conversational assistant work in progress

The user restarted the broader reliability goal after “can I fire an emplyee?” received a generic off-topic refusal. The goal remains active. A deployed accounting engine and a passing test suite do not establish that arbitrary questions are understood accurately.

## What caused the reported response

`request_details(reason=off_topic)` maps to a fixed sentence in `server/chat-clarification.ts`. There is no employee-keyword blocker. The deployed planner chooses a financial tool or one of several canned clarification reasons. The quoted response identifies that source path, but this incident has not been correlated with an individual runtime request; the actual provider arguments are not claimed as observed.

The missing behavior is a conversation about the intended business question. Staffing, pricing, purchases and expansion can involve finances, practical constraints or permission. The assistant should distinguish those meanings, then ask only for the missing information relevant to the chosen question.

## Current candidate

`discuss_business` is a small structured tool beside the existing queries and exact calculator. It allows a short explanation, a focused clarification or a specific limitation with a useful next step. Its text is generated for the conversation rather than selected from an employee-specific template. The production composable planner and optional adaptive planner offer it, including adaptive continuation. The experimental authored and complete grammars do not.

The tool accepts `kind`, `message` and an optional `question`. Strict validation rejects extra properties, fabricated evidence fields, oversized text and a clarification with no question. Application code returns no financial evidence and attaches `verifiedFinancialData: false`; it never lets the model choose that flag. The UI distinguishes general explanations, follow-up questions and information gaps from actual record/scenario evidence. It renders model content as plain React text.

The model is instructed to use financial tools for company figures and arithmetic, preserve prior user constraints, avoid inventing company circumstances, and avoid definitive current-law or employment-permission claims. A simple cost reduction does not require unrelated cash-reserve or receipts assumptions. Questions about future liquidity do require relevant future commitments and assumptions.

For example, after a natural clarification, a user can supply a $4,000 monthly reduction, three months and a $2,000 one-time cost. The existing calculator produces $10,000 from those explicit assumptions. This is a hypothetical cost comparison, not a recommendation to dismiss someone or a prediction about revenue. The integration test uses a scripted model response and the real calculator; it does not demonstrate live interpretation of that wording.

## What is and is not enforced

| Boundary                           | Enforcement or limitation                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Posted history and writes          | Existing accounting constraints and read-only chat remain unchanged. Conversation cannot execute a write.                                                                              |
| Financial query/calculator answers | Existing account/date/source/decimal validation remains in the financial tools.                                                                                                        |
| Conversation metadata              | Server-owned, with no financial evidence. The model cannot forge posted evidence or verification flags through this tool.                                                              |
| Conversational text                | Generated language. Schema validity, a general-explanation label and prompt instructions do **not** prove semantic truth or exclude all unsupported assertions.                        |
| Provider work                      | Uses the existing bounded planning/repair session; no additional model pass is added for an ordinary conversational reply.                                                             |
| Diagnostics                        | Logs finite reply-kind and legacy clarification-reason enums with the request ID. It does not log raw questions, answers, account names or tool arguments.                             |
| Mixed requests                     | The current single final tool still cannot freely combine a conceptual explanation and independently queried facts in one reply. This remains required work, not a successful outcome. |

This candidate deliberately does not add a superficial digit blacklist or call another model a truth oracle. A model could still choose an inappropriate response or put an unsupported assertion in prose. That is a live acceptance failure even when the HTTP response and schema are valid.

## Verification and remaining work

The new [conversation acceptance specification](../tests/conversation-acceptance/README.md) contains varied, independently authored synthetic scenarios, explicit expected facts and semantic criteria. It is a development acceptance set, not a blinded scientific study. Multi-turn evaluation must feed back the actual candidate's previous answer; fixed canned assistant turns would skip the behavior being tested.

Offline contracts cover tool parsing, bounded repair, retained conversation, a real hypothetical calculation, no unintended amount reads, diagnostic privacy and UI source labels. Browser tests use scripted responses and therefore establish presentation/transport, not model understanding. The independent fixture checks verify test data and expected arithmetic, not product accuracy.

Before production promotion, the candidate still needs full CI and browser execution, a new bounded real-model evaluation, semantic review of unsupported claims and unnecessary clarifications, and actual hosted acceptance. Existing closed research/acceptance cohorts stay closed. Their scores are not transferred to this changed source, and no additional provider spending is implied by the presence of these files.

The broader goal also requires mixed explanation-plus-data answers, better completion of multi-part questions, investigation of every observed failed case and fresh regression coverage. None of these is declared solved by adding this tool. Universal zero-error answering is not a supportable completion claim.
