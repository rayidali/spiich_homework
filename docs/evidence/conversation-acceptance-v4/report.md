# Two repaired conversations: focused v4 acceptance

**Both selected conversations passed their original criteria: 2/2 cases, 2/2 turns.** These were two known development questions selected after earlier failures. This is a targeted repair check, not a new score for the full 31-case/35-turn specification or evidence that arbitrary questions work.

The [actual run](https://github.com/rayidali/spiich_homework/actions/runs/41679318831) used source [`9f90a500`](https://github.com/rayidali/spiich_homework/commit/9f90a500a98ea98e74bed592435fd045c4564b8d), which passed [its source-specific CI](https://github.com/rayidali/spiich_homework/actions/runs/41677801649). The model remained `gemini-3.5-flash-lite`, using the composable route and the fictional accounting fixture dated November 1, 2026. The 75-file runtime/evaluator binding was `1371f2311a89d15ddbc006a3b4707788894ac1c9d43a660bf461664c683b0cf9`. [Structured review and costs](results.json) preserve the exact scope.

| Question                                                             | What the actual answer did                                                                                                                                                                                      | Review |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C02: “Can we take on another person?”                                | Explicitly offered to calculate the financial impact, then asked whether the user meant affordability or practical capacity and workload. It requested no long list of assumptions and made no hiring decision. | Pass   |
| C17: “Why did Office supplies go up from September to October 2026?” | Showed September **$100** and October **$340**, with the correct account, period and currency. A separate general explanation said that underlying business reasons require context beyond journal records.     | Pass   |

C02’s short follow-up was: “Do you mean whether we can afford the financial impact, or are you asking about practical capacity and workload?” This satisfies both parts of the original requirement: clarify the meaning and offer financial help.

C17’s explanation was: “Recorded ledger entries contribute to month-to-month changes, but underlying business reasons or motivations require context beyond journal records.” Its monthly table is a relevant breakdown under the unchanged rubric. It did not invent inflation, waste or another cause. The rubric did not require a vendor breakdown, individual-entry list or separately calculated difference.

The two displayed amounts were checked separately from the application’s answer, using integer-cent sums from the fictional posted Office supplies lines:

| Period         | Fixture calculation           | Displayed result |
| -------------- | ----------------------------- | ---------------- |
| September 2026 | $170 purchase − $70 refund    | $100.00          |
| October 2026   | $140 purchase + $200 purchase | $340.00          |

Only account 5030 and the requested two months were included. November spending was excluded. Both monthly rows were shown. Before and after fingerprints matched across the fixture’s one organization, ten accounts, fourteen journals and twenty-eight lines. No books changed.

The automatic scorer left both responses as **`needs_review`**, because these cases require reading the meaning of the answer. Those original statuses remain unchanged. A separate collaborating AI reviewer checked every required and forbidden behavior, all volunteered figures, the visible explanation and actual tool scope. The root agent separately agreed. Reviewers had access to earlier results and observations; this was neither blinded nor independent human certification.

Both first model plans were valid, with **one generation attempt each**. C17 used `currencyMode: "base"` with `currency: null`. **No live schema-repair attempt occurred.** Scripted tests demonstrate the new bounded repair behavior; this two-question model run establishes successful first-plan behavior only.

| Spending measure                                             |            USD |
| ------------------------------------------------------------ | -------------: |
| C02 generation, reported usage                               |     $0.0041690 |
| C17 generation, reported usage                               |     $0.0050567 |
| This run                                                     | **$0.0092257** |
| Unknown usage reservations in this run                       |             $0 |
| Combined v2, v3 and v4 against the additional $0.09 approval | **$0.0771448** |
| Remaining from that approval                                 | **$0.0128552** |

These are tracked token-cost estimates, not invoices or a verified provider balance. Two unbilled token-count preflights preceded the two generations. The explicitly selected evaluation mode counted the complete generation request, retained 2,048 input tokens of headroom and the unchanged 4,000-token output cap, then reserved cost before generation. Google documents the [full-request counting scope](https://ai.google.dev/api/tokens) and [unbilled token counting](https://ai.google.dev/gemini-api/docs/billing#is-gettokens-billed). This remains an accounting estimate, not a guaranteed invoice bound. The extra preflight round trip also means these timings should not be treated as a direct latency comparison with earlier runs.

The same two cases failed in v3 and passed here. That is a descriptive comparison of known questions on changed source, not a fresh held-out accuracy estimate. Historical results remain **v1: 23/31 cases and 27/35 turns; v2: 6/10 cases; v3: 3/5 cases**. Their other questions were not rerun on this source, and their passes are not added to this result.

This targeted acceptance permits the remaining release checks to proceed. It does not itself prove deployment, protected hosted rendering, broad conversational accuracy or universal factual correctness.
