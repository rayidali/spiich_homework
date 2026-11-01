# Proposed answer completeness contract

**Design only. This is not implemented, deployed or evaluated.** It proposes a small extension to a future opt-in adaptive candidate. The production composable route, current provider budgets and frozen studies remain unchanged. No new success score is claimed.

The purpose is to catch a specific failure: an answer can contain correct numbers and still omit something the user requested. The [held-out comparison](evidence/adaptive-runs/holdout-v2/report.md) includes correct month/category tables that omit a requested difference. A separate problem in that comparison was the grader's reliance on table position. Neither problem requires another general-purpose validation agent.

## What exists and what is missing

Current code validates the selected tool, runs bounded queries, checks exact arithmetic and renders recorded amounts. It does not retain a machine-checkable list of the requested deliverables. `FinancialInspection.show()` can finish after displaying the inspected tables; the scenario renderer emphasizes its last calculation. A successful execution therefore does not establish that the complete question was answered.

The proposed boundary is:

1. Before seeing database results, the planner declares the outputs it intends to deliver.
2. The application freezes that declaration for the request.
3. Reads and calculations produce facts under the existing accounting safeguards.
4. A deterministic finalizer checks whether each declared output has the correct source and is actually visible in the answer.
5. Missing work is reported explicitly or completed within the existing allowance.

This checks **fulfillment of the declared task**, not whether the declaration captures everything the user meant. A model can omit a requirement from both its declaration and its plan. Exact quotations and spans establish where words came from; they do not prove correct or exhaustive interpretation.

## Walkthrough: four requested results

Illustrative example, not a new measured trial:

> Show Acme's January and February spending, the dollar change, and the relative change from January to February.

Suppose complete, scoped database results are January **$240** and February **$90**. The declaration must contain four outputs:

| Requested output  | Supporting source or operation                                 |                      Result |
| ----------------- | -------------------------------------------------------------- | --------------------------: |
| January spending  | Exact January query row for the selected recorded counterparty |                        $240 |
| February spending | Exact February query row for the same recorded counterparty    |                         $90 |
| Dollar change     | February minus January                                         |                       −$150 |
| Relative change   | Dollar change divided by January                               | −0.625, displayed as −62.5% |

There is no model-supplied amount and no invented divisor. The arithmetic is `90 − 240`, then `−150 ÷ 240`. Percentage display is formatting of the checked ratio. If January is zero, division is undefined; the application must explain that limitation rather than invent a percentage.

Showing only the two month totals is partial. Computing the difference internally but hiding it is also partial. Showing the relative change alone does not satisfy the other three outputs. A calculation using another counterparty with coincidentally equal amounts must fail its source check.

## Proposed data contract

Keep the **initial requirements** separate from their **later evidence bindings**. The following is an interface sketch, not an existing API:

```ts
type RequestedOutput = {
  id: string;
  sourceQuotes: OriginalUserQuote[]; // server resolves and stores exact spans
  requirement:
    | { kind: 'values'; queryRequirementId: string; selection: RequestedSelection }
    | { kind: 'selected_identity'; queryRequirementId: string; selection: RankedSelection }
    | {
        kind: 'arithmetic';
        operation: 'add' | 'subtract' | 'multiply' | 'divide';
        operands: [RequestedOutputReference, RequestedOutputReference];
      };
};

type OutputBinding = {
  outputId: string;
  source:
    | { kind: 'query_row'; queryId: string; rowReference: string }
    | { kind: 'query_result'; queryId: string }
    | { kind: 'calculation'; calculationId: string };
};
```

`OriginalUserQuote` contains an original conversation message index and a bounded exact quote. The server requires a unique matching substring in that original USER message and computes its UTF-16 start/end positions; do not ask the model to count offsets. Repeated or ambiguous quotes need more context, not fuzzy matching. Inspection feedback, schema-repair data, vendor labels and assistant text do not qualify. Keep the original message array intact. These anchors establish requirement provenance only; they do not authorize numerical assumptions or prove interpretation.

Query requirements should derive validators from the existing `publicFinancialQuerySchema` with `pick`/`omit`, reusing its metric, aggregation, account scope, dates, currency, status and filter rules. Table obligations additionally retain grouping, ordering, limit and all-results versus top-N coverage. Do not maintain a second account/date parser that can disagree with the compiler. Compare a scalar duty against the effective scope of a trusted row, so an appropriate monthly/account cell can satisfy it regardless of table layout.

A deferred identity slot may reference only an earlier immutable `selected_identity` output. For example, the February counterparty must equal the January winner's exact returned identity; the planner cannot silently switch to a new independently ranked winner. Match the actual stored counterparty key or account identity, never its display label or dollar amount.

`RequestedSelection` and `RankedSelection` above deliberately remain design choices. Their exact first-version semantics must be settled before coding. A total, an entire grouped result, the requested top N, and a unique highest-ranked identity are different obligations. One cannot stand in for another merely because they contain the same number.

Prefer eight outputs with one to three original-user anchors each, consistent with the existing calculation limit. Overlapping anchors can be legitimate; assistant or feedback anchors cannot. Validate unique IDs, finite acyclic dependencies, exact source matches and supported requirement kinds. The contract cannot contain arbitrary SQL, executable expressions, model-written numerical answers or free numeric constants. Hypothetical operands still require the existing original-user assumption evidence and units.

Do not confuse a requested quantity with one mandatory implementation. A combined total over disjoint expense accounts may be fulfilled by a correctly scoped direct aggregate, without a separate calculator node. Several duties may share one binding only when their scopes and meanings are equivalent. Unsupported expression equivalence is unassessed, not proof that a displayed dollar amount is wrong. Define any supported equivalence narrowly and test it rather than accepting equal numbers alone.

## Freeze first; bind later

The first planner response establishes the contract **before the first database read**. Deriving it from a final answer would allow an omitted calculation to disappear from both the answer and its checklist.

The application stores an immutable copy and its version/hash in the request-local inspection session. Later tool calls can supply exact bindings or report an unresolved obligation. They cannot remove outputs, replace their original spans, change subtraction order, or broaden a requested account/date/vendor scope. The initial contract must cover an ordinary final-tool path as well as an inspection path; otherwise the planner could bypass the check by choosing `financial_analysis` directly.

Discovered row handles resolve through the committed request-local map. The application then checks the canonical query/row and its actual metadata. A handle identifies a row; it does not prove that the row was the intended winner, that similarly spelled counterparties are one vendor, or that a bank line was allocated to a particular expense.

Future conversation turns need a new contract derived from the retained conversation, with explicit dependencies on earlier user constraints. This version must not use a heuristic such as “the latest sentence looks complete, so prior restrictions no longer apply.” Handling contract changes across turns is a separate decision below.

## A server finalizer shared by every finish path

The finalizer should receive the immutable contract, exact validated facts, checked calculations and the proposed bindings. It should:

- Resolve each output ID exactly once and reject unknown, duplicate or dangling bindings.
- Check the requested source scope against the actual query/row: metric, effective posting-account identities, dates, currency, status, filters, dimensions and any declared same-counterparty relationship.
- Check arithmetic operations, operand order, units and complete source ancestry. Matching dollar values alone are insufficient.
- Distinguish complete tables from limited rankings. A truncated discovery can support only a declared, provable selection; it remains unsuitable as an arithmetic operand under current rules.
- Require each fulfilled result to appear in the rendered answer or visible evidence. A hidden fact or unused calculation does not count.
- Return a structured outcome for every requirement: fulfilled, missing, unsupported or invalid. Invalid scope/source evidence must not be presented as a valid partial answer.

The renderer needs **additive, server-owned fact references on evidence rows**, such as `{queryId, rowId}` or `{calculationId}`, preserving existing labels, values and rendering. These are generated from the validated execution, not accepted as assertions from the model. Query-result tables also need their query identity and truncation information. The finalizer and future graders should bind by these references, not table titles, position, row counts alone or a bag of matching numbers.

Render requested results first, then supporting tables. A hypothetical request for ending cash and reserve margin should visibly name both outputs, with hypothetical labeling inherited from their actual sources. This improves usability without letting the model write unchecked numerical prose.

## Handling unfinished work

In the first version, the finalizer checks existing validated calculations; it does not synthesize a missing formula or become a new executor. Compare the declared ordered dependency graph with the actual calculation ancestry. Reversing subtraction is not equivalent. Normalize commutative addition/multiplication only if that equivalence is deliberately supported and tested. Reject unknown or cyclic dependencies before any read.

A later extension could compile an already declared operation with complete exact operands into the existing calculator without another model call. That would execute the frozen graph, not guess a formula from a question or two matching amounts, and should be implemented and tested separately.

For the smallest rollout, the finalizer itself makes no provider call and rewrites no query plan: it returns the unresolved outputs. A subsequent extension could expose those IDs as bounded data in an already permitted adaptive continuation. That consumes the **same** remaining provider/time allowance. It does not create a new validator agent, automatic retry budget or unbounded “keep trying” loop; any new continuation policy must be measured as part of the new candidate.

If the allowance is exhausted, return a clear partial result only when the available evidence remains valid and internally consistent. For example: “I found the two monthly amounts. I could not complete the requested percentage change.” Do not equate “all rows from this query are shown” with “the whole question is answered.” A changed snapshot, invalid source or poisoned inspection session must continue withholding its combined result.

Suggested metadata distinguishes what has actually been checked:

```ts
{
  completionBasis: 'model_declared',
  userIntentVerified: false,
  status: 'fulfilled' | 'partial' | 'unassessed',
  outputs: [/* server-computed per-output status and evidence references */]
}
```

For the **new opt-in completion-required candidate**, a missing or invalid initial contract must not produce a final financial answer described as complete. Reject that candidate or use the already permitted bounded schema-repair path. Existing authored and composable routes without the feature remain `unassessed` until separately measured; do not silently label legacy answers complete or change their behavior as part of this experiment.

## Safeguards that remain mandatory

Retain organization scoping, read-only typed queries, decimal/rational arithmetic, saved exchange rates, cash identity predicates, draft/hypothetical labeling, original-user assumption evidence, complete operand checks and snapshot consistency. The proposed finalizer supplements these checks; it cannot override them.

Retain the current adaptive limits: three total provider attempts including at most one schema repair, two inspection read rounds, four unique queries, 64 KiB feedback, and the shared 40-second planning/inspection budget with late-result withholding. This is not a guaranteed HTTP wall-time service level. Unknown usage or a provider failure must not fund another attempt. No partial answer should release stale evidence after a failed reread.

The H10 limitation is material: generic `account_balance` arithmetic is deliberately rejected in the current calculator. For a question specifically about all cash accounts, the planner can use the supported `cash_balance` metric and per-account cash provenance. Do not silently turn a generic balance into cash based on its name or amount. Noncash balance arithmetic remains unsupported until its source/unit semantics are separately implemented and tested. A completeness contract should expose that limitation, not bypass it.

Log only bounded operational metadata such as output IDs, status counts, reason codes and request ID. User text/spans, business labels, raw model arguments and credentials should not become default logs.

## Decisions to resolve before implementation

| Decision                    | Recommended starting point                                                                               | Remaining limitation                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| First-call API              | One opt-in envelope around the initial adaptive plan and immutable contract; reuse existing validators   | Adds grammar complexity; verify real provider compatibility before claiming reliability |
| Scope representation        | Reuse typed query descriptors, with explicit deferred identity references                                | Do not allow arbitrary scope placeholders or later unrestricted rewrites                |
| First supported outputs     | Values/tables and arithmetic over exact existing query results                                           | Unsupported kinds must be explicit; no universal-business-question claim                |
| Ranked identity selection   | Specify ordering, requested count and tie behavior before execution; clarify unresolved ties             | Current top-one results prove a maximal row, not uniqueness or all tied leaders         |
| Arithmetic fulfillment      | Check declared operations against exact existing calculation ancestry; no new execution                  | Do not infer a subtraction merely because two periods were read                         |
| Partial results             | Show verified parts with an explicit missing-output list when the session remains valid                  | Never present invalid or stale source evidence as “partial success”                     |
| Multi-turn contract changes | Rebuild from the retained original conversation; preserve earlier constraints unless explicitly resolved | General conversational intent resolution remains unverified                             |
| Adoption                    | First offline contract/renderer tests, then a separately authorized and versioned opt-in evaluation      | Existing held-out outputs are regressions, not fresh independent holdout data           |

## Required tests

| Case                                                                        | Expected result                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Four correct month/category cells but omitted requested delta               | Partial; a table cannot satisfy the arithmetic obligation                          |
| January240, February90, requested delta and relative change                 | All four outputs visible; −150 and −0.625 from exact typed sources                 |
| Difference computed internally but not rendered                             | Not fulfilled                                                                      |
| Only the last of two requested scenario results rendered                    | Partial; both ending cash and reserve margin are required                          |
| Wrong account/counterparty with the same dollar amount                      | Reject the binding; value coincidence does not prove scope                         |
| May/June operands swapped, or currency/status/date changed                  | Reject the requested operation/scope mismatch                                      |
| Acme and acme are separate ranked rows                                      | Keep exact stored identities; no label-based merging                               |
| Winner is tied or ranking is insufficiently established                     | Clarify or mark unresolved under the declared tie policy                           |
| Truncated discovery used directly in arithmetic                             | Preserve current refusal; obtain a complete permitted operand if allowance remains |
| Complete cash series versus generic/noncash balance arithmetic              | Supported cash source works; generic/noncash restriction remains                   |
| Relative change with a zero baseline                                        | Explain undefined result; no invented zero, infinity or percentage                 |
| Missing contract on the new contract-required path                          | No final financial answer claimed complete; legacy route stays unassessed          |
| Contract output removed or changed after inspection                         | Reject mutation                                                                    |
| Duplicate, unknown, cross-query or foreign-session binding                  | Reject; no guessed row or amount                                                   |
| Inspection label or repair feedback masquerades as a requirement/assumption | Cannot establish original-user provenance                                          |
| Earlier user vendor restriction followed by a standalone-looking question   | Retain the restriction; no implicit reset                                          |
| Unknown usage, exhausted deadline or maximum attempts reached               | No extra call; no invented completion                                              |
| Earlier data changes during the next read                                   | Preserve failed-session withholding; no stale partial answer                       |
| Renderer reorders tables or adds a supporting table                         | Source-linked completeness stays correct; no position-based grading                |
| Relative ratio versus displayed percentage                                  | Exact ratio−0.625 formats as−62.5%; free prose cannot change the unit              |
| Nine outputs or more than three anchors for an output                       | Reject the proposed bounds rather than silently dropping duties                    |
| Original message contains emoji or a repeated quote                         | Compute exact UTF-16 spans; repeated/ambiguous matches require more context        |
| Direct disjoint-account aggregate fulfills a combined total                 | Accept the checked quantity without forcing a calculator representation            |
| Model omits a duty from its initial contract                                | Declared outputs may be fulfilled, but `userIntentVerified` remains false          |

Also test the interpreter separately with fresh paraphrases and multi-part questions whose expected requirements are written before execution. Structural tests demonstrate that the contract is enforced. They cannot establish that a model consistently extracts every intended requirement.

The next implementation should remain narrow and reviewable. No changes to the [frozen adaptive protocol](research/ADAPTIVE_EVALUATION_V2.md), original responses, scores or spending ledgers are required to document this design.
