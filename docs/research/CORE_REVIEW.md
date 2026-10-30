# Research core independent implementation review

Reviewed 2026-10-30 during implementation, before the comparative evaluation. This is a second coding-agent review, not an independent human accounting audit. Findings below are based on source inspection and executable unit tests; database permissions and external services still require actual integration checks.

## Scope and checkpoint

Reviewed `research/analytics.ts`, `answer.ts`, `budget.ts`, `io.ts`, `database.ts`, `setup.ts` and `retrieval.ts`. Added `tests/research-core.test.ts`, using injected transports and temporary private files. No model calls, database mutations, purchases or secrets were needed for this review.

The final local review checkpoint passed **25 core tests and 16 fixture tests (41 total)**, followed by a clean full TypeScript check. Earlier failing tests exposed unit/provenance and budget gaps; the implementing agent fixed them before this passing checkpoint. These are isolated code tests, not proof of live database/provider behavior.

## Defects identified and regression coverage

| Finding                                                                           | Why it matters                                                                                        | Current review evidence                                                                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every numeric query result was labeled USD, including transaction counts          | Unit mistakes could be accepted as financial facts                                                    | Fixed during review; count-provenance regression passes                                                                                                      |
| A USD source number could support an EUR answer merely because the digits matched | Numerical agreement does not prove currency correctness                                               | Typed provenance added; wrong-currency regression passes                                                                                                     |
| Metadata dates/IDs could supply numerical “evidence” for invented amounts         | A model could cite the year 2026 as USD 2026                                                          | Typed amount extraction added; metadata-as-money regression passes                                                                                           |
| Duplicate calculation IDs could overwrite previous calculated evidence            | Ambiguous references undermine reproducibility                                                        | Duplicate-ID rejection regression passes                                                                                                                     |
| Calculator lacked percentage-of/share operations under strict unit rules          | A salary plus 20% burden and a revenue share could be impossible to compute through the allowed tools | Explicit percentage-of/share operations added; salary-burden and revenue-share regressions pass                                                              |
| Unknown generation usage retained its reserve but did not stop subsequent work    | A long failing run could continue without confirmed usage                                             | Recorded protocol amendment: reserve conservatively and trip after three consecutive unreported generations; full/partial usage and restart regressions pass |

Additional regressions caught and fixed suffix currency amounts (`164615.00 USD`) and `%` notation being omitted from source extraction. Unknown account codes, interval-filtered as-of balances and mixed native-currency scopes now reject explicitly; valid native EUR balances retain EUR units.

Other passing checks cover SQL parameterization, unsupported query fields, finite result limits, posted/date filtering, distinct transaction counts, duplicate-query budgets, decimal arithmetic, divide-by-zero and invalid burn, invalid proposal currency/rates/balance, private budget files, secrets excluded from spending logs, restricted queue hosts, read-only repeatable-read headers and sanitized database errors.

## Remaining integration checks and limitations

1. **Actual permission tests are required.** A request header saying read-only is not proof of PostgreSQL permissions. Exercise the reader role against both approved scoped views and forbidden base tables, other-workspace records, writes and unsafe functions. Keep owner credentials out of model/runtime contexts.
2. **Match stored fixtures to the frozen snapshot.** `ON CONFLICT DO NOTHING` can retain older rows if the JSON fixtures change. Verify a full stored-data hash before measurements; a local file hash alone cannot prove the database matches it. Include answer-relevant description/vendor/currency/rate fields in no-write fingerprints.
3. **Typed numerical checks are not full semantic validation.** An amount may be true but refer to the wrong entity or period. A correct fact array can coexist with misleading summary prose. Automated scores must distinguish checked structured facts from unreviewed prose; concept tags do not establish human clarity or guarantee that the prose respects the stated assumption.
4. **Balance and flow semantics need explicit definitions.** The compiler now rejects a start-date filter on an as-of balance and rejects unknown account codes; regression tests pass. A model can still choose the wrong valid metric or period for a question. Evaluate that interpretation against the independent reference rather than treating valid SQL as a correct answer.
5. **Transport defense is layered.** The queue implementation restricts HTTPS destinations and private request files. The initial direct transport relied on trusted constructors and checked response length after reading the body; align both paths where practical. Do not treat request headers or prompts as authorization boundaries.
6. **Budget ownership must remain single-writer.** The ledger uses an atomic JSON replacement but initially had no multiprocess lock. Do not run two independent schedulers against one budget file without a lock or transactional store. Reservations are conservative estimates, not a provider billing invoice.
7. **Managed retrieval is not identical to custom retrieval.** File Search snippets are checked against authorized source records, but provider chunking remains opaque. Older or conflicting documents may be legitimately required; blanket “current version only” filtering would bias historical questions.

The tests prove specific code behavior under supplied examples. They do not establish provider reliability, production security, a real-world financial accuracy rate or scaling capacity.

## Route orchestration follow-up

A follow-up audit covered `research/routes.ts`, `scripts/research/run.ts`, and the new episode-limit/manifest helpers. The route tests exercise the real orchestration with mocked provider responses and database HTTP responses; they do not make paid calls.

The review found that the initial 60-second check ran only before final generation, duplicate Wren query IDs could collide, Wren numeric metadata could be misclassified as money, and resume checks did not freeze the actual working code/model configuration. The implementing agent added stage/deadline checks, shrinking HTTP timeouts, distinct generator/reviewer/embedding/rerank allowances, an eight-step analytical/retrieval budget, duplicate-query rejection, and source hashes checked during execution/resumption. Tests also confirm that R7 actually invokes its critic, R8 invokes Jev verification, mandatory-validation failures skip paid semantic review, and provider context excludes gold labels, split/group IDs and credentials.

At the final route-only checkpoint, **all 20 route tests passed**, followed by a clean full TypeScript check. The Wren route now consumes AST-proven `columnUnits`: safe integer counts retain count units, numeric IDs/years cannot become USD evidence, and native currency requires the proved currency plus the matching projected value. This was verified through the TypeScript route, not inferred from the engine tests alone.

Source inspection after the fixes confirms that resumption preserves the original database fingerprint and rejects drift, after-checks run from `finally`, and manifests record actual source/dependency hashes, runtime, model identities, selected questions/routes/repeats, index hash and verifier threshold/configuration hash. The published ancestor commit is explicitly distinguished from the actual working-source hash. These runner branches were inspected; the route suite does not simulate a complete process crash/resume. Same-model reviewer correlation remains a stated limitation. Public schema-key compliance is separate from whether a numeric amount is financially correct. The current primary gate withholds every reviewer non-PASS answer, including CLARIFY; it is a manual-review gate, not a conversational clarification repair loop.

## Inspected live preflight evidence

The coordinating agent performed the external checks; this review independently inspected the sanitized artifacts:

- [Database checks](../evidence/research-database-check.json): custom and actual Wren SQL both produced the independent September cash total; the scoped reader was denied research base tables, the demo ledger, writes and schema creation. The recorded ledger fingerprint remained unchanged.
- [Full fixture comparison](../evidence/research-fixture-check.json): 114 scoped posted lines from 57 entries and all 39 authorized documents matched the source snapshot. All 39 authorized embeddings were present, nonzero, finite and 768-dimensional. The snapshot hash was `92132d41e9f95ecc1804d68d646640aa8428bf054e480d92155ddbfeea23083e`. This checks vector integrity and content identity, not semantic embedding accuracy.
- [Component security checks](../evidence/research-security.json): 57 PASS, 0 FAIL and **3 UNASSESSED**, with no observed hard-gate failure and an unchanged fingerprint. This is not an all-routes language-model attack success-rate measurement; the unassessed cases remain visible.

These preflight observations do not replace the frozen pilot/held-out comparisons or establish a winning route. The broader report must retain provider errors, withheld answers, schema failures and unreviewed narrative limitations.
