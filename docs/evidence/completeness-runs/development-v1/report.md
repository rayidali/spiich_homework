# Development stopped: no comparison winner

The user approved up to **$0.90**. [Development run 41274681768](https://github.com/rayidali/spiich_homework/actions/runs/41274681768) ran at source `50fecb17cc22effea85c6af67a9dc5af37cf1f7f` and stopped after the first question's three route executions. **Three of twelve development executions were recorded; none of the forty-eight held-out executions ran.** The comparison is incomplete and the cohort is closed.

Think of this as checking three calculators before an exam. Two answered the first practice problem; the third could not accept the request. That tells us to fix the third calculator's connection. It does not tell us which calculator would win the exam.

## What happened

The first practice question asked for August repair-parts spending with a named supplier. Both `composable` and `adaptive` returned the independently expected **$165.00**, with the account, supplier and dates visible. The `complete` route received **HTTP 400** before producing an answer. Its saved result is `AI_REQUEST_REJECTED`.

| Route              | First practice question    | Provider attempts | Known usage estimate | Unknown reservation retained |
| ------------------ | -------------------------- | ----------------: | -------------------: | ---------------------------: |
| Composable control | Structured-correct         |                 1 |           $0.0037233 |                           $0 |
| Adaptive           | Structured-correct         |                 1 |           $0.0043496 |                           $0 |
| Complete           | Request rejected, HTTP 400 |                 1 |              Unknown |                   $0.0353617 |

This is a record of three observations on one practice question, **not an accuracy ranking**. Missing executions are not passes or measured failures. No significance test, winner or held-out comparison chart is reported.

## Money and data

Known usage estimates total **$0.0080729**. The rejected request returned no retained usage metadata, so the controller kept its full **$0.0353617** reservation. Total charged allowance is **$0.0434346**, below the $0.20 development ceiling. The reservation is not a claim that Google billed that amount. These are standard-rate estimates, not an invoice or verified account balance. [Cost records](costs.json).

Unknown usage halted the run as specified before execution. The $0.70 holdout phase did not start. The two temporary cohort secrets were removed after terminal failure; the user's local key and historical evidence remain intact. There was no retry, budget reset, transfer, model switch or deployment.

All saved before/after/final synthetic-book fingerprints match: two organizations, 48 accounts, 51 journals and 104 lines. All 78 evaluation files and the 75-file frozen core still match. A separate audit passed 362 integrity/accounting checks over 30 sealed files; that is an audit of preserved evidence, not 362 successful model questions. [Audit and limits](integrity-audit.json), [closure](closure.json).

Before paid calls, formatting, TypeScript, migrations and **243 evaluator tests across ten files**, including four actual PostgreSQL fixture cases, passed. Those checks did not establish live provider schema acceptance. The workflow's failed status is correct and remains visible.

## What needs repair

Two findings are distinct:

1. **Confirmed diagnostic gap:** the evaluation transport saved successful response bodies but discarded the HTTP 400 error body. We know the status, exact request and failure location; we do not know Gemini's specific rejection reason. A new version should retain bounded provider error diagnostics privately after credential checks, with safe summaries, status and hashes. It must preserve unknown cost reservations and stop behavior. Offline checks should cover JSON and non-JSON errors, oversized/interrupted bodies and credential echoes.
2. **Unconfirmed schema-complexity hypothesis:** the failed request was 82,491 bytes, below the local 256 KiB request ceiling. Its tool parameter schemas total 46,246 bytes versus 10,022 and 12,756 for the accepted requests. It repeats the same 11,026-byte requested-output contract across three tools. Removing the contract and output-binding additions reproduces the accepted adaptive schemas. [Offline diagnostic receipt](schema-diagnostic.json). A single initial declaration envelope could reduce repetition while keeping strict server validation, but no such repair has been implemented or live-verified here. Google documents that forced function calling can reject very large or deeply nested schemas; it does not supply a rejection reason for this saved request. [Google's function-calling limits](https://ai.google.dev/gemini-api/docs/function-calling#notes-and-limitations).

The existing frozen [protocol](../../../research/COMPLETENESS_EVALUATION.md) forbids repairing and retrying this cohort, and requires successful development before holdout. Preserve this result and declare any subsequent experiment separately. The held-out question text was not inspected during diagnosis. Production remains the previously deployed `composable` route. There is no new reliability or hiring guarantee.

The [summary](summary.json), three sanitized outcomes ([control](D01-composable.json), [adaptive](D01-adaptive.json), [complete](D01-complete.json)), [export provenance](provenance.json) and private raw artifact retain the evidence. Public exports omit credentials, private approval, raw model payloads and thought signatures.
