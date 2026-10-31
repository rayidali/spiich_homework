# Reproducing the research study

The experimental database can run on ordinary PostgreSQL with pgvector. A private Neon account, the hosted Daybook demo and Vercel access are not required. The existing application continues to use its own Compose configuration and `spiich_postgres_data` volume.

**Current execution status: complete.** `holdout-v1` contains **1,620 route episodes** (60 held-out questions × nine routes × three repeats), and `verifiers-v1` contains **240 held-out reviewer outcomes**. Independent audits passed [41 main checks](../evidence/research-holdout-final-check.json) and [31 reviewer checks](../evidence/research-verifier-holdout-final-check.json). The frozen executable source remains `fec9f71ad1426c8525d63c353d2f4f83892bdf24a8a5249e0383194f3c2fed08`, published in commit `0fe267b03b7baa0a2ff43c58165301b74261afa9`; the development-selected reviewer threshold remains 0.8. The final scoped data fingerprint matches the initial one. Both studies, cleanup and provider-free analyses are complete; final publication and submission packaging remain pending. [Main manifest](../evidence/research-runs/holdout-v1/manifest.json), [verifier freeze](../evidence/research-verifiers/verifiers-v1/verifier-freeze.json).

The same held-out run resumed after its preserved 777-episode interruption. Separate operational recovery passed full CI 41171119383 and 120 targeted tests; a single admitted provider probe succeeded, then its cohort closed permanently. All failed outcomes and reservations remain. Inference source and scoring were unchanged; the static-config dispatcher still has an unmeasured pre-tool scheduling gap. See the [operational record](TRANSPORT_INCIDENT.md). Do not restart completed runs, repeat recovery or overwrite their artifacts.

The [decision supplement](../evidence/research-runs/holdout-v1/decisions/report.md) identifies only H2, lexical document access over broad tools, as a candidate for further experiment: +46.7 percentage points [35.0, 60.0] on documents/scenarios. R3 leads the broad benchmark at 70.6%, but targeted gains remain inconclusive; R0 leads the predefined common-capability subgroup at 91.7%, versus R3's 75.0%. Neither reviewer clears its criterion. The [complete narrative](../reports/research-study.md) and [16-page PDF](../evidence/research-runs/holdout-v1/study-report.pdf) retain uncertainty, synthetic-data limits and the unchanged production boundary. These results support a separate document-access experiment, not automatic deployment or an unmeasured combined route.

The user authorized full continuation with **$6.40 additional Gemini usage, $0.10 additional Jev usage and at most 7,000 additional provider requests**, within the original cumulative $10/$4 ceilings. The user reported about $8 of Gemini credit after a top-up; balance and billing tier have not been independently verified. The parent-preserving study allowance is installed, and the replacement managed index is verified with 39 active authorized documents, zero pending and zero failed; existing vectors were retained. See [funded resumption](../evidence/research-funded-resumption.json), [store-access evidence](../evidence/research-current-key-index-access.json) and [ready-index receipt](../evidence/research-funded-index-ready.json). No automatic refill is authorized.

Final [cost reconciliation](../evidence/research-final-costs/cost-reconciliation.md) covers 5,271 records: approximately $6.050602768 counted across the whole research ledger, including unknown-cost reservations. Additional use is $5.23873405 Gemini / $0.033304824 Jev, within the authorized allowances. The 841-record baseline and every failed/unknown reservation remain intact. These are tracked estimates, not invoices or a verified remaining balance. The new exporter passed 41 local synthetic tests, TypeScript and formatting; cloud CI for that external reporting tool remains pending.

Historical development pilot V2 remains stopped at **101/108 episodes** after its original **500 requests per day per project/model free-tier quota** failure. Its full data fingerprint was unchanged, but the run is incomplete and cannot select an architecture. The [validity notice](../evidence/research-runs/pilot-v2/validity-notice.json), [dispatch/quota record](../evidence/dispatch-pilot-v2.json), [HTML report](../evidence/research-runs/pilot-v2/report.html) and [PDF](../evidence/research-runs/pilot-v2/study-report.pdf) preserve diagnostic evidence, not a final ranking. Do not resume V2 under amended source.

The frozen source passed **511 isolated tests, 35 actual Wren Python tests, nine PDF exporter tests, TypeScript/production build and formatting**. [Full CI 41155033249](https://github.com/rayidali/spiich_homework/actions/runs/41155033249) passed application verification, application Compose and native research integration; live-AI was skipped. [Local verification](../evidence/research-local-v4.json) and [CI evidence](../evidence/research-ci-v4.json) establish engineering checks, not final model accuracy or independent human review.

Use a fresh checkout or clean source copy for a new reproduction. The ignored `.tools/research/` directory contains database credentials, provider index identifiers, accumulated usage and resume state from one run. Do not copy someone else's private state into a new run or overwrite an active study's state to switch databases.

## 1. Install the local dependencies

Requirements are Node.js 22.12 or newer, Docker Compose and Python 3.11 or newer for route R6. Run from the repository root:

```sh
npm ci
python3 -m venv .tools/research/wren/venv
.tools/research/wren/venv/bin/python -m pip install --require-hashes -r research/wren/requirements.txt
.tools/research/wren/venv/bin/python research/wren/test_bridge.py
docker compose -f compose.research.yaml up -d --wait
```

The separate [research Compose file](../../compose.research.yaml) exposes PostgreSQL only at `127.0.0.1:5433` and persists it in `daybook_research_data`. It pins the supported `pgvector/pgvector:0.8.7-pg18` version tag. This is a version tag, not an immutable image digest; record the pulled image digest when reproducing infrastructure exactly. The tag is listed in the [official pgvector Docker instructions](https://github.com/pgvector/pgvector#docker).

This Compose file starts the research database. Node.js runs the study commands below; it does not start the Daybook application or publish a service. The local password in the Compose file is for this loopback-only synthetic environment.

## 2. Configure the research environment

Create a private, gitignored `.env` in the fresh checkout with these values. Supply provider keys locally before the model/indexing steps:

```dotenv
RESEARCH_DB_TRANSPORT=postgres
RESEARCH_OWNER_URL=postgresql://daybook_research_owner:daybook_research_local_only@127.0.0.1:5433/daybook_research
RESEARCH_TRANSPORT=fetch
GEMINI_API_KEY=replace-locally
TYPESAFE_API_KEY=replace-locally
```

`RESEARCH_DB_TRANSPORT` selects database transport. `postgres` uses the installed `pg` driver and a PostgreSQL URL; the default `neon-http` still permits only Neon hosts. There is no automatic host guessing or HTTP fallback to arbitrary addresses. The optional third `ResearchDatabase` constructor argument can explicitly select either transport.

`RESEARCH_TRANSPORT` separately controls provider HTTP. In a normal local environment, `fetch` calls providers directly. The `queue` option exists for the original restricted execution environment and needs an external approved request dispatcher; it is not needed for this reproduction.

The commands below use `--env-file=.env` so every CLI, including database-only checks, receives these settings. Never pass the owner URL or provider keys in model prompts, checked-in result files or command output.

### Existing session: audited funded allowance

The current session's earlier one-cent, one-request key check is complete. Its policy, required marker, recovery journal and all 841 usage records at the transition are preserved. The additional study policy uses authorization reason `user_authorized_study_resumption` and binds that immutable baseline, its tracked costs, the parent policy and the credential that passed the key check. It does not claim that billing activation or a quota reset was independently observed.

The reviewed provisioning API is:

```ts
const budget = new StudyBudget('.tools/research/usage.json');
const policy = await budget.installStudyAllowance({
  authorizationReference: '<private reference to the actual user instruction>',
  credentialFingerprint: credentialFingerprint(currentKey),
  additionalAllowanceUsd: { gemini: 6.4, jev: 0.1 },
  maximumAdditionalAttempts: 7000,
});
```

This offline transition has already been installed in the current session. It requires the successful consumed key-check receipt and the same credential fingerprint, acquires the budget lock and refuses an active runner. It writes separate `usage.json.study-policy.json` and `usage.json.study-policy-required.json` artifacts; it does not overwrite the parent policy, marker, recovery journal or historical usage. Every subsequent reservation uses both the additional allowance and original cumulative caps, including unknown-use reservations. Every Gemini request must match the bound key and allowed model. Control requests count toward the 7,000-attempt limit too.

The policy survives restarts. Partial writes, missing/corrupt state, changed history and mismatched keys fail closed; deleting both child files falls back to the consumed parent policy's block. Pending/failed recovery and the consecutive-unknown-usage circuit still block. See [the recovery and continuation guide](QUOTA_RECOVERY.md) for schemas and limits. Do not repeat installation, delete safeguards or change ledger paths to obtain more budget. A fresh independent reproduction needs its own authorized caps and private state; do not fabricate this existing session's key-check history to use the continuation API.

## 3. Provision the isolated fixture and check the database

```sh
node --env-file=.env --import tsx scripts/research/setup.ts
node --env-file=.env --import tsx scripts/research/database-check.ts
node --env-file=.env --import tsx scripts/research/security.ts
```

Setup creates the `research` schema, fixture tables, required extensions, a generated reader password and a `daybook_research_reader` role. It saves the reader connection in `.tools/research/database-private.json` with private file permissions. Analytical routes use that reader; setup and indexing use the owner URL. The reader can select only the scoped research views. Its default transactions are read-only, its statement timeout is three seconds, and its views restrict organization and posted-entry visibility.

The database check compares custom and actual Wren results with an independent fixture oracle, checks reader restrictions and compares fingerprints before and after. On a fresh standalone database, `public.journal_entries` does not exist: this is recorded as `NOT_APPLICABLE`, with `passed: null` and SQLSTATE `42P01`, rather than credited as a permission denial. Research base-table, write and schema restrictions still have to pass. On a database with the demo table, its reader-denial check remains applicable. Setup/check metadata identifies native PostgreSQL or Neon HTTP transport without inferring physical server isolation from the URL.

The security suite checks deterministic boundaries and records unsupported checks explicitly. It is not a claim that all natural-language prompt attacks were tested against every live model.

## 4. Build both document indexes

These steps make provider requests and consume the configured provider allowance. The vector index uses all 40 synthetic documents; analytical readers see 39 documents belonging to the permitted organization. The managed File Search store contains only those 39 permitted documents.

```sh
node --env-file=.env --import tsx scripts/research/index.ts vectors
node --env-file=.env --import tsx scripts/research/index.ts files
node --env-file=.env --import tsx scripts/research/fixture-check.ts
```

The fixture check compares complete stored ledger and document contents with the source fixture and verifies the authorized embeddings have the expected dimensions. Run it after vector indexing; missing embeddings correctly produce an incomplete result before indexing. An embedding's presence does not prove its semantic quality.

Indexing resumes from `.tools/research/index-state.json`. Keep that file with its matching database and provider store. If source fixture content changes, use a new study version and run state; setup intentionally does not overwrite existing fixture rows. Re-indexing or changing documents during a measured run changes the experimental condition.

For this funded continuation, a read-only request with the verified current key returned HTTP 403 for the old File Search store. The old private index state was archived, the 40 stored vectors were retained, and a new managed store was verified with the same **39 active authorized documents, zero pending and zero failed**. No corpus expansion occurred. [Read-only index receipt](../evidence/research-funded-index-ready.json). Old index provenance and costs remain preserved; the replacement index state is bound in the completed held-out manifest and must remain preserved. A successful generation probe alone does not establish index access.

## 5. Run the controlled comparison

Inspect the protocol in [PLAN.md](../PLAN.md), the route definitions and the current budget limits before launching live runs. The budget ledger is `.tools/research/usage.json`; it reserves cost before each request and keeps failures visible. Estimates are not provider invoices, and the existence of a free tier does not guarantee a request is free.

The following commands use distinct run IDs. The smoke and pilot sets contain only development questions. The verifier development step selects and freezes its threshold before held-out evaluation:

```sh
node --env-file=.env --import tsx scripts/research/run.ts smoke local-smoke-v1
node --env-file=.env --import tsx scripts/research/verifiers.ts development local-verifiers-v1
node --env-file=.env --import tsx scripts/research/run.ts pilot local-pilot-v1
node --env-file=.env --import tsx scripts/research/run.ts development local-development-v1
node --env-file=.env --import tsx scripts/research/freeze.ts
node --env-file=.env --import tsx scripts/research/run.ts holdout local-holdout-v1
node --env-file=.env --import tsx scripts/research/verifiers.ts holdout local-verifiers-v1
```

By default the runner selects R0–R8. `RESEARCH_ROUTES=R0,R1` can restrict an exploratory run; label such a run as a subset rather than a completed nine-route comparison. Routes R3, R4–R8 and the verifier suite require their corresponding indexes/providers. A subset's results do not establish the missing routes' quality.

The freeze command binds the preserved development outcomes and selected threshold to the complete executable source and reference-case hashes. Run it after all development amendments; both held-out runners reject missing or stale bindings. Generation request submission is paced at least 4,200 ms apart following the observed free-tier quota, without automatic retry. Queue expiry counts against request deadlines. The dispatcher uses 4,500 ms coordinator/configuration-preparation spacing. These are harness gates, not measurements of actual network starts; external tool scheduling can alter those gaps. Google applies request/minute, token/minute and request/day quotas per project; the actual account limits must be inspected in AI Studio, and a paid tier is not assumed ([official rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits), checked 2026-10-30). Pacing addresses minute-level request pressure, not every possible quota.

For the existing session, the funded continuation and both held-out runs are complete. Preserve the old V2 failures, unknown-use reservations and index provenance. The replacement managed index is verified, and `smoke-v3` remains preserved with its validity notice for asymmetric date-scope evidence. The shared scope correction was verified in **54 fixed `smoke-v4` attempts** before the final source/settings and preserved verifier calibration were frozen. `holdout-v1` completed 1,620 episodes, and the `verifiers-v1` held-out split completed 240 outcomes. Use `common-capabilities-amendment-v4.json` for the corrected source; retain earlier amendments with their original versions. Preserve completed development/held-out outcomes and the original threshold. The fresh-reproduction sequence above is not an instruction to repeat completed setup, indexing, measurements or freeze steps in this session.

Both route and verifier runners persist the triggering outcome and stop on local budget exhaustion, an open provider circuit, unsafe budget/policy/recovery state, a key mismatch or an unpriced model. The resulting run stays **incomplete**, with unattempted cases disclosed; the harness does not manufacture a completed matrix of zero-call errors. Ordinary provider HTTP errors and model-output failures remain measured outcomes. Repair or recovery must be explicit, preserve the original outcome and obey source/configuration resume checks. Neither a user-reported credit balance nor the installed dollar allowance guarantees provider capacity or access to a particular project resource.

V2 also exposed an inferred completion-file race in the optional queued transport: a failed runner read was later followed by a complete HTTP-200/exit-0 footer. Post-pilot development added a complete-footer marker and partial-arrival tests, normalized R0's output tags within its existing call, and clarified draft-versus-historical-fact instructions. Subsequent development snapshots and `smoke-v4` exercised the final corrections before held-out freezing. They did not change the preserved V2 outputs. [Race evidence](../evidence/queue-completion-race-pilot-v2.json).

The historical funded-allowance checkpoint passed **453 isolated tests, the production build and formatting** before live development smoke; see [earlier local verification](../evidence/research-local-funded.json). The 511-test final-source verification at the top of this document supersedes that count. These are engineering checks, not live model accuracy or a completed held-out comparison.

Do not tune prompts, thresholds, fixture data or executable research source after inspecting held-out results. A resumed run checks its source/configuration/data manifest and preserves previously completed or interrupted episodes. Use the same command and run ID to resume unchanged work. A changed implementation requires a new run ID and a clear experimental version, not editing old result rows.

Results are written under `docs/evidence/research-runs/<run-id>/`, including episodes, manifests, before/after fingerprints and report artifacts. Verifier artifacts are under `docs/evidence/research-verifiers/<run-id>/`. Keep incomplete runs and failures when comparing methods; do not present completed-only scores as overall reliability.

## 6. Produce the final analyses and printable report

Run these postprocessors **after the final held-out runs finish**, using their unchanged frozen source. They make no provider requests. Replace run IDs consistently for a fresh reproduction. The v4 amendment applies to the recorded Daybook source; a different implementation needs its own reviewed source binding while retaining the original subgroup definition.

```sh
node --import tsx scripts/analyze-research.ts docs/evidence/research-runs/holdout-v1 --usage docs/evidence/research-runs/holdout-v1/usage.json
node --import tsx scripts/analyze-common-capabilities.ts docs/evidence/research-runs/holdout-v1 docs/research/common-capabilities-amendment-v4.json
node --import tsx scripts/analyze-weight-sensitivity.ts docs/evidence/research-runs/holdout-v1
```

Only after reviewer evaluation, make its evaluator-only label projection. This is never included in model input. The decision analyzer verifies it against the frozen full reference hash and the actual visible-input hashes, rather than trusting manually assigned labels:

```sh
node --import tsx --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { reviewCases } from './research/reference.ts';
const labels = reviewCases.filter(c => c.split === 'holdout').map(c => ({
  caseId: c.id, sourceGroupId: c.sourceGroupId, split: c.split, expected: c.expected,
}));
writeFileSync('.tools/research/holdout-reviewer-labels.json', JSON.stringify(labels, null, 2) + '\n');
JS
node --import tsx scripts/analyze-study-decisions.ts docs/evidence/research-runs/holdout-v1 --freeze docs/evidence/research-verifiers/verifiers-v1/verifier-freeze.json --reviewers docs/evidence/research-verifiers/verifiers-v1 --reviewer-labels .tools/research/holdout-reviewer-labels.json
```

The decision supplement checks complete coverage, source/protocol/threshold/fingerprint bindings, subgroup provenance and overriding validity notices. Its targeted effects, reviewer tradeoffs and complexity tables supplement the primary score. They do not create a production winner from an incomplete run. All intervals remain exploratory and unadjusted, with small synthetic samples.

The local reporting environment contains ReportLab and PyMuPDF. The exporter generates standalone vector figures from explicit input JSON files, verifies the supplementary primary/reviewer bindings, and checks PDF text bounds:

```sh
.tools/report-render/bin/python scripts/export-research-report.py \
  --main-results docs/evidence/research-runs/holdout-v1/results.json \
  --verifier-results docs/evidence/research-verifiers/verifiers-v1/holdout-results.json \
  --verifier-split holdout \
  --supplement docs/evidence/research-runs/holdout-v1/supplemental/retrieval-and-failures.json \
  --common docs/evidence/research-runs/holdout-v1/common-capabilities/common-capabilities.json \
  --sensitivity docs/evidence/research-runs/holdout-v1/sensitivity/sensitivity.json \
  --decisions docs/evidence/research-runs/holdout-v1/decisions/decisions.json \
  --output docs/evidence/research-runs/holdout-v1/study-report.pdf \
  --render-dir .tools/research/final-pdf-review
```

On another machine, create the separate reporting environment with the tested primary dependency versions:

```sh
python3 -m venv .tools/report-render
.tools/report-render/bin/python -m pip install -r scripts/report-requirements.txt
```

Use Python 3.10 or later; transitive package resolution and platform rendering can vary. The private local environment is excluded from the submission. Inspect the rendered pages and reconcile the narrative with the actual held-out evidence. Passing bounds checks is not an independent human scientific review. Missing human clarity scores stay unavailable, and no chosen weighting may replace the preregistered task-success result.

### Reconcile the complete research ledger

The recorded session's [final export](../evidence/research-final-costs/cost-reconciliation.md) and [provenance](../evidence/research-final-costs/analysis-provenance.json) are complete. Preserve them; the command below documents their reproduction and intentionally refuses to overwrite the existing directory. Use a different destination only for a separately justified audit snapshot.

Main-run `usage.json` and reviewer `holdout-usage.json` cover their own episode IDs. Neither is the total cost of developing and running the study. After **both runs finish and the runner, dispatcher and budget locks are removed normally**, export a new, provider-free snapshot:

```sh
node --import tsx scripts/reconcile-research-costs.ts \
  --ledger .tools/research/usage.json \
  --output docs/evidence/research-final-costs \
  --baseline-count 841 \
  --main-run holdout-v1 \
  --reviewer-run verifiers-v1
```

The output directory must not already exist. The exporter refuses active or stale locks, unfinished queue requests, malformed ledger records, duplicate IDs, and unknown or overlapping episode classifications. It checks that the source bytes remain unchanged during export. Do not delete locks to obtain a snapshot; finish the existing operational cleanup. A directory without its final `analysis-provenance.json` is an incomplete export. A quiescent ledger alone does not prove that the experimental matrix completed; retain the separate coverage and integrity audits.

The artifacts are:

- `all-study-usage.json`: only the 12 `UsageRecord` fields: `id`, `episode`, `provider`, `kind`, `model`, `at`, `reserveUsd`, `estimatedUsd`, `status`, `inputTokens`, `outputTokens`, `durationMs`. It excludes extra fields such as credentials, requests, provider responses and policies.
- `cost-reconciliation.json` and `.md`: exact decimal totals by provider; the first **841 records** versus the additional-allowance suffix; main and reviewer holdout; reviewer development; pilots/smokes/development; indexing/preflight; and four separate recovery categories. The JSON detail table also crosses those partitions with request kind and observed HTTP outcome.
- `analysis-provenance.json`: hashes of the private source bytes, sanitized export, sanitized baseline prefix, report, analyzer and any explicit classification list. Private source paths and configuration contents are not exported.

The four recovery prefixes are `recovery-probe:`, `transport-recovery-probe:`, `prelaunch-continuation-probe:` and `operator-probe:`. Their reservations and measured estimates are operational overhead, not route performance or benchmark successes. A record counts a reservation; a local rejection can create one without a provider request.

For each record, **counted cost = stored estimate when present, otherwise the full retained reservation**. A stored zero stays a known zero. Missing usage stays unknown even after HTTP 200: successful embeddings without token metadata are one example. Report the estimate subtotal and unknown-reservation subtotal separately. The table of all original reservations is another view, not an extra charge to add to counted cost. These are paid-equivalent tracking estimates, not a provider invoice, verified account balance, or the cost of unrecorded production/external services.

Decimal addition preserves the exact serialized ledger values; it cannot reverse rounding already introduced when earlier code used JavaScript numbers. The exporter neither changes historical rows nor retroactively reprices them. All partition counts and money totals must reconcile exactly. A fresh reproduction has its own baseline boundary; do not copy 841 if its ledger differs.

An unfamiliar setup/development identifier stops export rather than silently falling into a convenient category. After inspecting only its operational metadata, supply `--classifications path/to/classifications.json`, containing an array such as `[{"episode":"reviewed-setup-id","phase":"indexing_preflight"}]`. The only permitted extra phases are `indexing_preflight` and `development_pilots_smokes`. Entries must exist in the ledger, remain unique, and cannot replace built-in classifications or relabel reserved holdout/recovery prefixes. The exact list is included and hashed in provenance. Do not use this mechanism to hide unknown benchmark or recovery records.

## Native transport guarantees and verification limits

Each native operation opens a bounded connection and closes it in `finally`. Connections have a five-second timeout and queries a fifteen-second client timeout; the restricted reader's shorter server timeout remains intact. Batches use one connection with `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, sequential parameterized queries, and `COMMIT`, with rollback attempted on failure. Owner provisioning can explicitly request a read-write batch. Per-client parsers retain exact numeric/bigint strings and date strings without changing global PostgreSQL parser behavior. Driver errors expose only a safe SQLSTATE category.

The route-level tool budget applies independently of transport. A native query or cleanup can finish after the episode deadline; stage checks reject a late answer, but this is not hard real-time cancellation at the exact deadline. Native and queued-HTTP transport latencies are different experimental environments and should not be mixed into one performance claim.

Fifteen mocked-driver tests cover opt-in/default behavior, exact values, transaction sequencing, error classification, rollback and cleanup; the existing core tests retain the HTTP default. These tests validate the adapter contract. The original restricted local session could not start Docker, but cloud CI subsequently exercised the native path successfully.

The [`research-native` CI job](../../.github/workflows/ci.yml) provisions the separate pgvector container, installs and tests the real pinned Wren engine, checks complete fixture source contents before indexing, executes Wren/custom SQL through the restricted reader, and exercises deterministic security boundaries. It receives no provider keys and does not create embeddings, managed indexes or model answers. Its source-content check explicitly leaves embedding completeness unassessed. Six additional check-report tests distinguish absence, actual denial, readable tables, unrelated errors and changed fingerprints.

CI uploads only newly generated, sanitized evidence under `research-native-evidence`: source commit and fixture checks, the pulled database image digest, Wren test output, setup counts, database checks and security results. It excludes private reader state, owner credentials and provider state. The job passed for the final offline research source `05a9fe3` in [CI 41142335257](https://github.com/rayidali/spiich_homework/actions/runs/41142335257); [recorded CI evidence](../evidence/research-ci-v3.json) identifies that revision. This establishes the committed native integration checks, not live provider accuracy or successful quota recovery.

Stop the research container while retaining its fixture with:

```sh
docker compose -f compose.research.yaml down
```

Avoid deleting the research volume during ordinary resume. The application volume and local `.tools/postgres` data directory are unrelated to this reproduction.
