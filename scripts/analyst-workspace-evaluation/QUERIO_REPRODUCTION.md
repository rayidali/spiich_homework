# Reproducing the paired Querio capture

`querio-runner.ts` runs the real Daybook Querio service and HTTP client against an already configured, isolated acceptance datasource. Importing it makes no network requests. Its offline tests use a fake transport; calling `runQuerioComparison` with real settings can consume provider credits.

This is a portable adaptation of the private controller used for the recorded comparison, not the exact historical executable. [The provenance file](querio-runner-provenance.json) records both sets of hashes and every adaptation. Historical results remain attached to their original source. A fresh run is a new cohort; it cannot replace an earlier failure or inherit its approval.

## What stays fixed

The runner reads A01, A05, A06, A07, A11 and A18 directly from the frozen [acceptance specification](../../tests/analyst-workspace-acceptance/cases.json): six conversations, eight turns and two requested charts. Only question text reaches the assistant. Expected facts, rubrics and oracle answers do not.

Both routes receive the same `shared-context.md` and the suffix:

```text
Fixed evaluation business date: 2026-11-03. Treat this as today in the organization's timezone.
```

Querio also receives instructions selecting its fixture datasource, requiring saved notebook evidence and explaining that Python variables may not survive a reopened session. Models, provider tools and those provider-specific instructions differ, so this compares two products. It does not isolate the causal effect of an architecture or model.

## Required setup

1. Run the [fixture loader and independent oracle](README.md) against a fresh disposable database. Never seed or reset during an assistant run. Preserve the second business as a tenant-isolation control. The verifier must check all 118 lines, all migration hashes, all 38 reference facts and identical before/after fingerprints.
2. Configure your own Querio workspace and the datasource slug `daybook-acceptance-20261104`. Expose exactly eight `querio_fixture` views: `organization`, `currencies`, `accounts`, `entries`, `lines`, `ledger`, `recurring` and `alerts`. Their columns and accounting values match the `analytics` views in migration009. For an external reader, fix the primary organization in the views themselves; do not let a caller-controlled session setting select a different business. Use a separate SELECT-only login with no write, schema-create or temporary-table privileges. Do not give Querio an owner/auditor credential or the live application datasource.
3. Verify that the actual saved datasource points to those views, and upload the frozen shared context with the date suffix above. Verify the saved catalog and context by reading them back. Database and datasource provisioning are operator prerequisites; this runner does not provision or purchase services. Querio's hosted service must be able to reach the isolated database. An ordinary localhost database is not automatically reachable from Querio.
4. Use a checkout with passing tests and record its exact commit. Supply a newly reviewed permit, chosen model and a current conservative estimate of included-credit headroom. A historical balance or the presence of an API key is not approval or billing evidence.

The existing local verifier is `verifyDatabase(ownerUrl, databaseName, 'verify')`; its verification transaction is read-only and its host/name guards remain intact. The separately pinned Neon verifier is `verifyPinnedRemoteDatabase(auditUrl, expectedHostname)`. It requires database `daybook_analyst_acceptance_20261104`, the restricted auditor role and the exact hostname supplied independently by the operator. Both return the audit shape the runner accepts. A callback must perform a fresh verification on every invocation; never return a saved receipt or made-up fingerprint. The remote verifier's credential is used locally for auditing and is never sent to Querio.

## Run offline tests

```sh
npx vitest run tests/querio-comparison-runner.test.ts
```

The tests exercise the real service with a fake HTTP transport: all eight turns, follow-up notebooks, one submission per message, history deduplication, missing-usage stops, unknown setup/submit outcomes, credit reservations, cancellation and persisted leases. These tests spend no credits and do not establish model accuracy.

## Explicit live invocation

Keep credentials in the environment or a local ignored `.env`, never in a permit, command argument, screenshot or commit. The runner defaults to `createQuerioClient(settings)` using normal fetch. It accepts an injected `request` for offline tests or a separately reviewed transport; no personal auth, curl or spool helpers are needed on a network-capable host.

An example private launcher at `.tools/reproduce-querio.ts` is:

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createQuerioClient } from '../server/querio-client';
import {
  runQuerioComparison,
  type QuerioComparisonPermit,
} from '../scripts/analyst-workspace-evaluation/querio-runner';
import { verifyPinnedRemoteDatabase } from '../scripts/analyst-workspace-evaluation/database';

const permit = JSON.parse(readFileSync('.tools/querio-permit.json', 'utf8')) as QuerioComparisonPermit;
const key = process.env.QUERIO_API_KEY;
const auditUrl = process.env.ANALYST_FIXTURE_AUDIT_URL;
const expectedHostname = process.env.ANALYST_FIXTURE_EXPECTED_HOSTNAME;
if (!key || !auditUrl || !expectedHostname) throw new Error('MISSING_LOCAL_CONFIGURATION');
const settings = {
  key,
  workspaceId: permit.workspaceId,
  datasource: permit.datasource,
  model: permit.modelId,
};
const result = await runQuerioComparison({
  outputDirectory: resolve('.tools/querio-reproduction-01'),
  settings,
  permit,
  request: createQuerioClient(settings),
  verifyFixture: () => verifyPinnedRemoteDatabase(auditUrl, expectedHostname),
});
console.log({
  completedTurns: result.completedTurns,
  observedResponses: result.observedResponses,
  haltReason: result.haltReason,
});
```

Create a private permit with these fields. The template is intentionally unapproved and cannot dispatch:

```json
{
  "approved": false,
  "approvalReference": "YOUR_FRESH_REVIEW_REFERENCE",
  "scopeId": "YOUR_UNIQUE_COHORT_ID",
  "sourceCommit": "YOUR_EXACT_40_CHARACTER_COMMIT",
  "datasource": "daybook-acceptance-20261104",
  "workspaceId": "YOUR_WORKSPACE_ID",
  "modelId": "YOUR_REVIEWED_MODEL_ID",
  "businessDate": "2026-11-03",
  "includedCreditHeadroom": 120,
  "totalTurnReservation": 120,
  "perTurnReservation": 15,
  "stopAtObservedResponses": 12
}
```

After reviewing and authorizing that new cohort, invoke the private launcher with `node --import tsx .tools/reproduce-querio.ts`. Use one process and a new output directory. The module records exact source/reference/context hashes; it does not independently prove that an operator-supplied commit matches a dirty checkout. Freeze and inspect the checkout before running.

## Spending, failure and evidence

Each submitted turn reserves 15 included credits, up to 120 across this subset. The runner requests Stop at 12 observed assistant responses in a turn. **This is not an upstream spending cap:** cancellation can race additional model work. Observed assistant entries and token counters are retained, but do not prove billed credits or dollars. A fresh caller-supplied headroom estimate must be an integer of at least120; the historical run's reported headroom is not reused.

Missing final history, an uncertain paid submission, or unconfirmed setup-resource closure stops the cohort. An empty history after a submitted answer is unresolved usage, not verified zero cost. No paid message is automatically resubmitted. A single-use claim keyed by the unique `scopeId` and an exclusive output directory prevent replay of that cohort, including replay into a different folder or with reordered permit keys. This strengthens the historical controller, whose claim was keyed by the exact JSON serialization. Preserve claims, partial outputs, reservations and failures after a crash. Inspect and close any known remote resources before separately authorizing another cohort.

The private output contains source bindings, original questions, request/response/failure captures, each saved answer and notebook, observed usage, reservations and closure receipts. It deliberately contains no authentication headers, but still includes provider resource IDs and financial fixture outputs; do not publish it blindly. The filesystem store uses leases and atomic file replacement for a single controller process. It is research persistence, not the production PostgreSQL conversation store or a multi-process database.

The before/after audit must show unchanged accounting data. A completed answer is not automatically correct. Review factual claims against the independent oracle, semantic interpretation against the declared rubric, and actual chart delivery in the application. Keep failed, partial and unsupported outputs in the denominator. Compare fresh runs under their own source/model/context bindings, without pooling historical cohorts or claiming universal accuracy.
