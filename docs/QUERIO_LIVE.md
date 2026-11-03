# Test Querio with the live Daybook records

**Connected and verified November 3, 2026.** Open [Querio](https://app.querio.ai), start a **new chat**, and select **Daybook LIVE — all records** (`daybook-live`). The old connection is now named **TEST ONLY — synthetic benchmark**. Its earlier conversations still concern fictional test books.

**Use New Explore → Select datasource beneath the prompt → select only Daybook LIVE — all records.** Querio preserves datasource selection in an existing Explore. Adding a connection or renaming the old one does not switch that conversation. [Querio's selection instructions](https://docs.querio.ai/guides/ask-questions).

The user's later cash answer of $9,850 and missing Office supplies category came from the old fixture: both saved cash queries explicitly named `daybook-eval-20261103`. A fresh live SQL read confirmed that Office supplies exists. Workspace `memory/MEMORY.md` now tells the analyst to use `daybook-live` for ordinary Daybook questions, identify the source and avoid substituting fixture figures. Exact readback was verified. This is guidance, not a changed app default, a switch of an existing conversation, or proof of model compliance. The user's notebook was preserved. [Diagnosis receipt](evidence/querio-datasource-mismatch.json).

## What Querio can see

The connection reads the same PostgreSQL database as the hosted Daybook application. It includes every existing application table: posted entries **and drafts**, their debit/credit lines, accounts, currencies, organizations, recurring templates, alerts, AI proposals, correction history and operational tables. No application records are filtered out by a curated reporting view.

The separate `research` schema is also available. Its documents and ledger rows are **fictional experiment fixtures**, not uploaded contracts or live business records. The two `research.scoped_*` views are filtered copies of those same research tables. Accounting context tells Querio to keep this archive separate from live answers.

Querio received a catalogue of all **16 base tables and two views, with 184 columns**, plus written guidance explaining joins, account signs, exact amounts, exchange rates, dates, reversals, drafts and the meaning of each table. It can write its own read-only SQL and calculations. The connection uses a dedicated reader; the database owner password was not supplied. Write permissions are denied on all base tables. New tables created by the current owner in these two schemas inherit reader access, although Querio's catalogue may need refreshing after schema changes.

## A concrete starting point

Open the saved notebook **START HERE — Daybook LIVE**. It contains executable queries for a record-count summary and all Figma transactions, with posting status shown. The notebook displays its last execution; rerun it for current records.

During verification, **Querio's own query engine** retrieved the November 3 Figma subscription for **$180**, marked **DRAFT**, alongside six older posted entries. A draft is a prepared entry awaiting review, so it is visible in Transactions but is not evidence that payment happened. The supplied context tells the analyst to show matching pending records separately instead of hiding them behind an empty posted-only result.

You can now ask your own questions against this live datasource. New database records are available to new queries; previous answers and saved output do not automatically update.

## What was verified

- Connection, complete catalogue, table permissions and exact context-file readback.
- Actual SQL execution inside Querio, with visible summary and Figma tables; four saved notebook cells.
- Unchanged counts and full-row fingerprints for all 16 base tables before and after setup.
- Closure of both temporary execution environments; the datasource and saved notebook remain available.

The first notebook attempt used an unavailable `marimo` import. It was replaced with Querio's own Markdown/DataFrame display, then all four cells completed without errors or warnings. This was a connection and execution check, **not a new AI-answer accuracy study**: no model prompt was dispatched. The web interface was not visually inspected. Daybook's own chat and deployment are unchanged. [Sanitized setup receipt](evidence/querio-live-connection.json).
