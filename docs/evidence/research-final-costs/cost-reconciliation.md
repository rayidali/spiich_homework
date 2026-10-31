# Research cost reconciliation

Exact decimal addition of the stored serialized numbers; counted = reported estimate where present, otherwise retained reservation. Not a provider invoice.

| Category | Records | Reported estimate USD | Unknown reservation USD | Counted USD |
| --- | ---: | ---: | ---: | ---: |
| All research records | 5271 | 5.620660417999999899085 | 0.42994234999999999746 | 6.050602767999999896545 |
| gemini | 4826 | 5.58016804999999989704 | 0.42994234999999999746 | 6.0101103999999998945 |
| jev | 445 | 0.040492368000000002045 | 0 | 0.040492368000000002045 |
| baseline | 841 | 0.582978593999999995256 | 0.19558530000000000301 | 0.778563893999999998266 |
| additional | 4430 | 5.037681823999999903829 | 0.23435704999999999445 | 5.272038873999999898279 |

Provider and baseline/additional rows are alternative partitions, not extra costs to add together.

| Category | Records | Reported estimate USD | Unknown reservation USD | Counted USD |
| --- | ---: | ---: | ---: | ---: |
| main_holdout | 3881 | 4.69348841199999991072 | 0.19433994999999999523 | 4.88782836199999990595 |
| reviewer_holdout | 160 | 0.030792289999999999617 | 0 | 0.030792289999999999617 |
| reviewer_development | 160 | 0.029702419999999999541 | 0.0238326000000000005 | 0.053535020000000000041 |
| development_pilots_smokes | 758 | 0.855084985999999989373 | 0.13567385000000000319 | 0.990758835999999992563 |
| indexing_preflight | 308 | 0.011558909999999999834 | 0.07392774999999999854 | 0.085486659999999998374 |
| recovery_key_quota | 1 | 0.0000167 | 0 | 0.0000167 |
| recovery_transport | 1 | 0 | 0.0010841 | 0.0010841 |
| recovery_prelaunch_continuation | 1 | 0 | 0.0010841 | 0.0010841 |
| recovery_operator | 1 | 0.0000167 | 0 | 0.0000167 |

- Records count reservations, not proven network calls. A local rejection can still retain a reservation.
- Unknown costs include successful embeddings without reported usage; HTTP status and request kind remain separate.
- A known estimate of zero remains known; missing usage never becomes a zero estimate.
- All four operational recovery categories are overhead, excluded from route accuracy and route-only costs.
- Baseline/additional is the immutable ledger position boundary, not a date or an inferred billing period.
- Stored estimates and original reserves are not repriced or retroactively rounded. Prior Number precision cannot be restored.
- This is the shared research ledger only; production traffic, unrecorded external services and actual account balance are outside its scope.
- The exporter checks a quiescent local snapshot, not experiment completion or scientific validity; those require the run audits.

The JSON detail table partitions each phase by provider, baseline/additional, request kind and observed HTTP outcome. Exact totals retain serialized precision; do not add independently rounded display values.
