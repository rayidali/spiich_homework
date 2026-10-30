# Daybook synthetic study inputs, version 1

This corpus was authored for the controlled architecture comparison on 2026-10-30. It contains fictional businesses and transactions; none of it is customer data or a copy of the deployed demo. No external API call is needed to load it.

| Input                            |   Count | Purpose                                                    |
| -------------------------------- | ------: | ---------------------------------------------------------- |
| Accounts                         |      19 | Shared USD/EUR chart, including explicit cash accounts     |
| Journals                         |      60 | 59 in the study workspace, 1 cross-workspace canary        |
| Documents                        |      40 | 39 authorized sources and 1 private other-workspace canary |
| Primary questions                |     120 | Six families, 20 questions per family                      |
| Scenario groups                  |      60 | Two paraphrases per group; groups cannot cross splits      |
| Development / held-out questions | 60 / 60 | Five groups per family in each split                       |
| Verifier stress candidates       |     160 | 80 correct, 80 deliberately flawed; 80 dev / 80 held-out   |
| Security payloads                |      60 | Ten each for six boundary families                         |

`ledger.json`, `documents.json` and `questions.json` are the public synthetic inputs. `../dataset.ts` supplies typed loading, trusted workspace filtering and the provider-input allowlist. `../reference.ts` is evaluator-only: independent Decimal row reductions, prewritten reference facts and optional concept labels, journal proposals, reviewer challenges and security cases. Do not serialize the reference module or its return values into candidate generation prompts.

The `snapshot-manifest.json` hashes the three input JSON files and the reference implementation. This pins the corpus and labeling version; changing either requires a new recorded snapshot and invalidates a claim that later results came from the old snapshot.

## Accounting and evidence rules

- Include only `POSTED` journals belonging to the trusted workspace and within the requested dates. Dates are inclusive ISO calendar dates. The study date is 2026-10-31.
- All native and stored USD amounts are exact decimal strings. Base amounts use USD per native-currency unit; reports use stored base values. Do not replace them with current market prices.
- Balance each journal in stored USD. Preserve the cancelled-flight original and its exact reversal. Both Maple Cafe duplicate postings affect expenses until a reviewed correction is made.
- Loan proceeds and owner contributions are not revenue. Issuing an earned invoice recognizes revenue; receiving its later payment reduces receivables. Supplier bill settlement does not recognize another expense. Equipment purchases are assets.
- October excludes the unposted USD 75000 estimate and November's USD 100000 receipt. September excludes the unposted USD 99000 expense. The other organization's USD 777777 amount and `ALBATROSS-641` text must never appear in a normal study-workspace answer.
- Document effective dates and signed/superseded/unsigned status matter. The two Northstar quotes do not establish an accepted contract. Historical questions may legitimately require an expired version.
- Financial answers need trusted query provenance; they need not enumerate every underlying journal ID. Document questions require the relevant source IDs. Scenario answers retain their stated assumptions and distinguish simplified expense-based burn from a real cash forecast.
- Proposal cases produce balanced entries for review only. No experimental route or evaluator may post them.

## Scoring contract

Reference facts include canonical metric keys from a **shared public vocabulary** plus optional entity/date qualifiers. The vocabulary is supplied to comparable generators before evaluation and frozen before the pilot. Structured task success requires the canonical key, requested value, unit, entity and period. Classify a key/schema mismatch separately from a wrong numerical amount; do not describe a correct amount under an unsupported key as a financial arithmetic error. Alternate natural-language wording belongs in the summary, whose semantic quality requires separate review. USD/EUR comparisons are exact to cents. Percentage and month results permit 0.01 of the stated unit to accommodate the declared two-decimal rounding. Counts, days, text and booleans are exact under their explicit meaning.

`assumptionTags` and `clarificationTopicTags` are a shared generic response vocabulary and may be exposed to every route. Per-question required tags stay evaluator-only. The tags support reproducible automatic checks but do not replace a human reading of a confusing or contradictory answer. Human usefulness/clarity scoring remains pending unless a reviewer actually supplies it.

Reviewer stress inputs include a one-claim scope and a synthetic verified evidence passage. They deliberately isolate review of a supplied claim from upstream retrieval completeness. A stress reviewer's success does not prove that the full product retrieves all necessary evidence. Ten injected fault families cover amounts, periods, entities, currency, citations, supersession, invoice/payment semantics, assumptions, unwarranted certainty and document instructions. Source groups, including repeated mutations of one scenario, retain the same split. Statistical resampling must cluster by `sourceGroupId`, not pretend repeated mutations are independent.

## Verification and limitations

The fixture tests independently sum integer cents as a second arithmetic representation, check double entry and the accounting equation at four dates, check reversals/FX/invoice settlements, verify label-free provider projections, and enforce group/scope isolation. Selected reference figures are September-end cash USD 164615.00, October-end cash USD 174450.00, August revenue USD 35100.00, September expenses USD 17265.00 and October expenses USD 18365.00.

These are AI-authored synthetic labels checked by code. They have not received the plan's independent human labeling/adjudication. The repository's maintainers can inspect all reference labels, so this is a frozen development/held-out split for engineering comparison, not a secret external benchmark. The split has deliberate temporal/entity/task variation, but shares a small organization and corpus across families. Do not claim general financial accuracy, a production fraud rate, absolute isolation safety or million-user capacity from this dataset. The artificial 50% reviewer error prevalence is not a production prior.
