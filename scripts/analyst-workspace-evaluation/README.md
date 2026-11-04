# Analyst comparison fixture database

This loader prepares the independently specified [acceptance books](../../tests/analyst-workspace-acceptance/README.md) in a **fresh, disposable local PostgreSQL database**. It makes no AI calls. Its receipt verifies data and reference answers; it is not a chatbot score.

The two businesses, their account IDs, dates, draft/posted states, stored exchange rates, reversal and schedule links, and exact amounts come from the frozen JSON fixture. The standalone Python `Decimal` oracle must pass before a database connection is opened. The loader then checks every stored row and computes all 38 reference facts with separately authored SQL. No application financial calculator or SQL compiler is imported.

## Run locally or in CI

Use an already running disposable PostgreSQL instance with an administrative test role. Create a **new** database whose name starts `daybook_analyst_acceptance_`; the remaining suffix accepts 1–35 lowercase letters, numbers or underscores. For example:

```sh
createdb daybook_analyst_acceptance_ci
export ANALYST_FIXTURE_OWNER_URL='postgresql://postgres:postgres@127.0.0.1:5432/daybook_analyst_acceptance_ci'
MIGRATION_DATABASE_URL="$ANALYST_FIXTURE_OWNER_URL" npm run db:migrate
node --import tsx scripts/analyst-workspace-evaluation/cli.ts seed-check --database-name daybook_analyst_acceptance_ci --output /tmp/analyst-fixture-seeded.json
node --import tsx scripts/analyst-workspace-evaluation/cli.ts verify --database-name daybook_analyst_acceptance_ci --output /tmp/analyst-fixture-verified.json
```

The password above is an example for an isolated test instance. Supply real local test credentials via the environment, never as CLI arguments or committed files. The loader does not read `.env` or reuse `DATABASE_URL`. Check the migration command's environment configuration before running it; migrations are a separate explicit setup operation. The loader itself requires exact migration checksums, including migration008.

`seed-check` refuses existing organizations and existing fixture reader roles. It never resets, truncates, drops or overwrites books. `verify` is repeatable and uses a read-only transaction. A failed CLI command exits nonzero, including an unavailable PostgreSQL server; it does not silently skip in CI. Receipt files use exclusive creation so earlier evidence cannot be overwritten. Each new CI database should use a distinct suffix if its PostgreSQL cluster survives between runs: the dedicated reader role is cluster-wide and intentionally is not dropped automatically.

## Scope and safety

- Only `localhost`, `127.0.0.1`, `[::1]`, or `db:5432` in CI/test mode are accepted. Other hosts, ordinary application database names, URL query options, mismatched explicit names and missing roles are refused before connecting. A local tunnel is not evidence of a safe target; use only the explicitly created disposable database.
- A dedicated `NOLOGIN`, non-administrative reader receives SELECT on the six fixture tables plus currencies. Row-level policies expose **only Acorn Studio**, even when a query omits an organization filter. The unrelated business remains present as a boundary test. Reader verification checks visible IDs table by table and checks absence of write/create/temp permissions. No login credential is generated or granted to a third-party service.
- Each native amount and exchange rate enters PostgreSQL as a decimal string. Generated base columns must exactly match the reference. Entry numbers are preserved, including numbering within each business; the isolated identity sequence is moved above the maximum after successful verification.
- Posting still passes ordinary database triggers and deferred accounting checks. Alert rows are deliberately authored synthetic history. Their associated posting jobs are marked done in this disposable fixture so a worker cannot rewrite them. This is not a test of anomaly detection quality. Do not run the application scheduler/worker against these books: recurring templates are intentionally active source records.
- Full row fingerprints before and after reference verification must match. The receipt identifies fixture/document/oracle hashes and applied migration checksums, without database URLs, passwords or raw connection errors.

The SQL oracle is another independent implementation and can itself contain a bug. Agreement with Python and raw stored-row checks is stronger evidence than copying product calculations, but is not a guarantee. Review the [hand-worked controls and mutation tests](../../tests/analyst-workspace-acceptance/oracle_test.py) as well. Real PostgreSQL execution is required before calling this loader verified; TypeScript or mocked tests alone cannot establish that.

## Future paired assistant runs

Both routes must receive the same business/date/context/questions and the same visible data. This script does not connect Querio, grant network access, provision hosted databases or spend model credits. A separately authorized remote fixture needs an explicit provisioning path; removing the local guard is not part of this loader. Preserve original responses, emitted queries, tool results, actual charts, source version, latency and measured usage. Score numeric facts and usefulness separately according to the frozen acceptance specification; do not infer superiority from infrastructure checks.
