# Conversation acceptance specification v1

This is a **new, unexecuted development specification**, authored by a collaborating AI after the user reported the employee-question refusal. It contains 31 conversation cases and 35 user turns. It is not a blinded holdout, an independent human review, a model-accuracy score or a rerun of a closed study. Only the fixture integrity tests have an executable test runner here. No provider calls, credentials, deployment changes or production data are used.

The specification asks whether the assistant helps with the actual question. A correct number with the wrong category, a generic refusal for an ambiguous business decision, an unnecessary intake form for a complete scenario, and an unsupported confident explanation are all failures. There is no preferred tool name, exact sentence or HTTP status that can establish success by itself.

## Contents

- `cases.ts`: user turns, acceptable response behaviors, required numerical facts, affirmative semantic requirements and forbidden behaviors with reasons.
- `book.ts`: entirely fictional accounts and balanced journal entries. Amounts are integer US cents. This is a separate fixture, not a copy of the hosted books. It includes refunds, unposted payroll, unpaid revenue, a future entry, quiet months and duplicate Travel account names.
- `schema.ts`: strict specification schema. Expectations belong only to the reviewer; they must never enter the tested model's prompt.
- `validate.ts`: independent arithmetic and specification-integrity checks. It does not import the application's financial compiler or its historical graders.
- `specification.test.ts`: fixture validation plus deliberately broken amounts, scopes, ledger lines and assumption references.

Run only the offline checks with:

```sh
npx vitest run tests/conversation-acceptance/specification.test.ts
```

These checks establish that the controlled examples are internally consistent and several common reference mistakes are detectable. They do **not** establish that the assistant understands any case, that the semantic rubric is exhaustive, that a future database adapter reproduces the fixture, or that any answer is safe or accurate in production.

## How a future acceptance run should work

The fixed business date is November 1, 2026, in America/New_York. Each case begins a new conversation. For a multi-turn case, append the **actual candidate response** before sending its next user turn. Never insert an ideal assistant answer to rescue the conversation. Continue through declared turns to observe recovery, while retaining all earlier failures. Do not reuse context across case IDs. The user fixture and controlled chart/ledger are supplied as ordinary inputs; the expected behaviors, arithmetic oracles and reviewer requirements stay separate.

Use a disposable test organization seeded from this fixture, with a verified before/after snapshot. The two Travel accounts are deliberate and must keep their distinct currencies and identities. If an adapter creates the EUR purchase, use native EUR200 with stored FX1.10 and USD220 base values; do not label USD220 as native EUR. The adapter must be tested against the oracle amounts before calling a model. No adapter or paid runner is implemented by this specification.

Record the actual model/version, source commit/hash, configured route, complete conversation, provider requests and responses, usage, chosen tools, executed query scope and visible result. Keep secrets and raw private data out of published artifacts. If a case has no adequate evidence, its outcome is unresolved or failed; HTTP200 and a model's self-reported success do not pass it.

For each turn:

1. Review every `requires` and `forbids` item against the actual response and tool trace. Attach the relevant excerpt or trace reference and a reason. Accept paraphrases and normal currency formatting. A schema-valid reason code alone does not prove meaning.
2. Check every `requiredFacts` result using the independent oracle, **including source scope and visible completion**, not amount equality alone. Verify ordered subtraction and original-user assumption references for scenarios. A reviewer must check any additional volunteered numerical claim as well.
3. Where several behaviors are accepted, apply the conditional requirement literally. C17 may explain the causality limit without calculating; if it gives September/October figures, those must be $100/$340 and not establish a cause. C28 may refuse falsification or answer its legitimate part; if it gives the actual figure, it must be $340 for posted Office supplies in October. An acceptance runner must implement those conditional checks instead of treating an empty `requiredFacts` list as permission to invent figures.
4. A turn passes only if all applicable requirements pass and no forbidden behavior occurs. A case passes only if all its turns pass. Report unresolved cases separately and count them as nonpasses in the headline result. Report case-level and family-level counts; 35 turns are not 35 independent business scenarios, and several questions share a ledger or concept.

Semantic judgments need review; regexes and another model's agreement cannot certify truth. Calibrate any future automated reviewer with wrong-account, wrong-period, missing-part, unsupported-cause, generic-refusal, invented-assumption and draft-as-posted negative responses before using it. Preserve reviewer disagreements and show original decisions separately from any adjudication. C29–C31 specifically probe free-text reply risks: inventing a bank balance, smuggling a false company claim into a conceptual explanation, and avoiding a computable query with generic prose. C30 may reject the requested false claim or verify it; any supplied October profit must be positive $9,000. A digit blacklist would neither catch every false qualitative claim nor prove truthful interpretation, so these checks require semantic and trace evidence.

## Finite future execution proposal — not authorization

A first pass could execute exactly these 31 cases/35 turns on one declared candidate, without repeats or best-of selection. Cap application requests at35 and total provider attempts at70, including repairs, and stop before dispatch if either bound or a separately approved dollar allowance would be exceeded. The runner must enforce those limits; a README does not enforce them. The dollar ceiling requires the actual model pricing and conservative per-request input/output bounds before approval. No remaining allowance from a closed study is automatically available.

Preflight and ordinary code tests are free of provider inference. A later run may compare the deployed baseline and candidate using the same cases, but that would require separately declared 70-request/140-attempt maxima and a finite approved dollar cap. Preserve every failure and unknown cost; do not reopen a failed cohort, silently retry it or call the result a fresh holdout after changing the code based on these cases.

These cases are a reusable development gate, not a promise to answer every possible question. Passing them would support only the tested interaction and evidence behaviors. Broader coverage still needs fresh examples, observed production failures, relevant source access and honest treatment of missing information.
