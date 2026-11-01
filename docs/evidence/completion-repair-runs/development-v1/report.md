# Repaired development closed before the comparison finished

[Development run 41280216704](https://github.com/rayidali/spiich_homework/actions/runs/41280216704) recorded **8 of 12 development cells** at exact source `1e6adba78016bee484b0a41a08e4445b9c310170`, then stopped at the development budget boundary. Seven cells made provider requests; the eighth was refused before sending. There were **10 provider attempts**, all returning HTTP 200. **No held-out question ran.** This is incomplete development, not a comparative accuracy result or a route-selection result.

The distinction matters: Gemini accepted the requests, but several returned forms still could not be used safely. Passing a connection check did not establish reliable answers.

## Recorded outcomes

Each cell is one question/route combination. The same development question is shared across routes; these are not independent samples. Four cells are missing, and the controller did not replace them or rerun failed cells.

| Question | Route      | Recorded outcome                               | Provider attempts |
| -------- | ---------- | ---------------------------------------------- | ----------------: |
| D01      | Composable | Structured-correct                             |                 1 |
| D01      | Adaptive   | Structured-correct                             |                 1 |
| D01      | Complete   | Execution error                                |                 2 |
| D02      | Adaptive   | Safe no-answer; requested answer not delivered |                 2 |
| D02      | Complete   | Execution error                                |                 2 |
| D02      | Composable | Partial answer                                 |                 1 |
| D03      | Complete   | Execution error                                |                 1 |
| D03      | Composable | Budget refused before provider access          |                 0 |

The observed pass counts are 1/3 composable, 1/2 adaptive and 0/3 complete, against four planned development cells per route. These unequal, incomplete development denominators must not be presented as an accuracy ranking. D03 adaptive and all three D04 cells are missing. No significance test, held-out score or winner is reported. The scorer flagged no wrong financial claim or hard-boundary violation among the recorded cells; that does not turn omissions and rejected responses into successful answers. [Full sanitized cell metadata](summary.json).

## What failed

The preceding HTTP 400 rejection did not recur in this run. All ten responses had HTTP 200, including those that failed application validation.

- **D01 complete:** the first response included an extra `answerContract.type: "OBJECT"` field. The strict schema rejected it. The existing bounded schema-repair attempt then ended with the provider finish reason `MALFORMED_FUNCTION_CALL` and contained no structured function call.
- **D02 complete:** the initial inspection response added `selectedAccountCode:null` to a `selected_identity` requirement, where that field is not allowed. Its repair response repeated that extra field and added a second contract key literally named `"outputs"`, including quote characters, alongside the ordinary `outputs` key. Both responses failed strict schema validation.
- **D03 complete:** the initial response ended with `MALFORMED_FUNCTION_CALL` and supplied no structured function call.

These are recorded schema and provider-output failures. No financial/source guard was relaxed to accept them. Diagnostic prose was not converted into a function call or executed.

The two malformed-call responses contain provider `finishMessage` diagnostic text with date tokens that lack immediate opening quotes: four tokens in D01's repair and twenty-four in D03's initial response. **That describes Google's diagnostic rendering; it does not prove the internal parser cause.** The provider did not identify that cause. Both responses omitted `candidatesTokenCount`; their reported total equaled their input count. Missing output usage was not assumed to be zero. [Strict failure metadata and limits](failure-metadata.json).

The D01 initial request had the same bytes as the earlier successful diagnostic probe, but this new model response differed. One successful response replay therefore did not establish reliable behavior on repeated generation, even for that known question.

## Cost and closure

This development phase used **$0.0546772 in known usage estimates** plus **$0.0718688 in retained unknown reservations**, totaling **$0.126546**. Before another request, the controller could not fit its full conservative reservation under the fixed **$0.14** development cap and stopped. The cap was not reached by paid usage alone: reservations also consume allowance.

Adding the already closed **$0.1717792** predecessor/diagnostic charges gives **$0.2983252** overall against the authorized **$0.90**, leaving **$0.6016748** in overall allowance. These are usage estimates and reservations, not invoices or a verified account balance. Neither unknown reservation was released. The closed development phase was not refilled or resumed, and the holdout allowance was not transferred into it. [Attempt-level accounting](costs.json).

The new controller correctly preserved isolated failed cells and continued to distinct scheduled cells. Budget exhaustion then stopped the whole run, as declared in the [new protocol](../../../research/COMPLETION_REPAIR_EVALUATION.md). Its predecessor verifier rejects this incomplete development artifact, so it cannot authorize that cohort's holdout phase.

All three temporary secrets were removed after closure, with HTTP 204 recorded for each deletion. Local keys and private evidence remain preserved. The full archive was encrypted before GitHub upload; its downloaded ZIP digest and authenticated source/run/phase were verified before local decryption. Public files exclude raw model responses, provider signatures, prompts, keys and private approval contents. [Closure and encrypted-artifact identity](closure.json).

## What was verified separately

A **207-check** independent audit verified the 79 sealed evidence files, all **95 source-file hashes against the exact Git commit**, durable reservations, response hashes, accounting and per-cell/final book fingerprints. The two synthetic organizations, 48 accounts, 51 journals and 104 lines remained unchanged. These are integrity checks, not 207 model questions. [Audit receipt](integrity-audit.json).

Before paid execution, **298 evaluator tests across 15 files**, including four actual PostgreSQL fixture cases, passed. The separate [full CI run 41280198601](https://github.com/rayidali/spiich_homework/actions/runs/41280198601) also passed at the same source: **2,504 normal tests/125 files**, four separate PostgreSQL fixture cases and **32 browser workflows in 37.6 seconds**, plus native research and Compose. Normal verification skipped eight cases/two files; Compose passed 2,503 overlapping tests/124 files and skipped nine cases/three files. [Exact-source CI receipt](../../completion-repair-ci.json). These totals overlap and must not be added. CI used scripted provider responses; it did not measure new model accuracy or hosted behavior.

Production remains `93a8617` / `composable`. The broad goal remains open, with offline work continuing on a simpler provider request representation before further paid execution. This failed cohort stays closed; neither its failures nor the earlier studies will be relabeled as successful. [Export provenance](provenance.json).
