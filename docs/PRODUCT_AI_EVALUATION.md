# Product AI evaluation: posted-correction fixtures

The original product harness is separate from the completed nine-route study and the new category-selector comparison. Its current fixture version is `daybook-accounting-eval-v2-posted-corrections`. All 40 question texts, expected answers, case IDs and development/holdout assignments remain unchanged. This repair has no new live model results.

The financial workspace still has USD 27,377 cash at March 31, 2026 and USD 4,020 March expenses. Teaching entries live elsewhere so they cannot change those answers. Each selected correction case and repetition gets two fresh workspaces with matching old vendor history:

1. **Before:** no confirmed correction exists. The model may correctly ask for more information; matching the eventual category is only a diagnostic.
2. **After:** a reference-authored wrong proposal is recorded, a reference-authored corrected draft is bound to it, and the ordinary `postEntry` transaction posts the reviewed entry and creates an ACTIVE memory. The live model being evaluated never supplies this teaching entry.
3. **Isolation decoy:** a real posted Nimbus correction exists in another workspace. Context checks must reject its correction and entry IDs when answering in the financial workspace.

All known fixture writes finish before the protected journal fingerprint. Each provider invocation checks all fixture journals before and after, including failed calls. An unbound AI proposal may be stored by the normal application; creating, editing or posting a financial entry fails the evaluation. Repetitions never delete feedback or financial history to simulate a fresh start.

The after-context contains **both the posted teaching entry and its correction memory**. This exercises the real product workflow but does not isolate the effect of memory retrieval from history retrieval, demonstrate model weight training, or establish production accuracy. Clarification meaning still requires human review. V1 and V2 results must not be pooled as measurements of unchanged fixtures.

Run `npm run ai:evaluate -- --help` for bounded, opt-in provider runs. The default smoke suite has no before/after cases; development, holdout and all suites allocate pairs only for their selected correction cases. No existing workspace is reset. Provider calls may incur charges and the observed-token guard is not an absolute billing ceiling.

New run reports retain their unique paths under `docs/evidence/ai-evaluations/`; the V2 latest copy is `docs/evidence/ai-evaluation-v2.json`. Historical reports and `ai-evaluation.json` are preserved. Reports record all fixture workspace IDs, teaching proposal/entry/memory IDs, pre/post fingerprints, labels hash and relevant source hashes. The database-backed fixture tests exercise the real correction path without any provider requests; their execution requires migrated disposable PostgreSQL.
