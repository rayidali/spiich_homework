"""Real Wren planning tests; these do not claim PostgreSQL execution coverage."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest

from bridge import Planner, PolicyError, checked_ast, column_units, row_scope


class WrenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.planner = Planner()

    def test_calculated_columns_expand_through_actual_engine(self):
        result = self.planner.plan("SELECT SUM(net_debit) AS amount FROM ledger WHERE account_type = 'EXPENSE'")
        sql = result["plannedSql"]
        self.assertIn("research.scoped_ledger", sql)
        self.assertIn("base_debit -", sql)
        self.assertIn("base_credit", sql)
        self.assertEqual(result["engineVersion"], "0.8.2")
        self.assertIn("LIMIT 100", sql)

    def test_month_and_vendor_groups(self):
        result = self.planner.plan("SELECT DATE_TRUNC('month', date) AS month, vendor, SUM(net_credit) AS revenue FROM ledger WHERE account_type = 'REVENUE' GROUP BY DATE_TRUNC('month', date), vendor ORDER BY month LIMIT 20")
        self.assertIn("date_trunc", result["plannedSql"])
        self.assertIn("GROUP BY", result["plannedSql"])
        self.assertIn("LIMIT 20", result["plannedSql"])

    def test_count_distinct_entries_does_not_double_count_lines(self):
        result = self.planner.plan("SELECT COUNT(DISTINCT entry_id) AS count FROM ledger")
        self.assertIn("DISTINCT", result["plannedSql"])

    def test_cash_flag_and_asof_cutoff(self):
        result = self.planner.plan("SELECT COALESCE(SUM(net_debit), 0) AS cash FROM ledger WHERE is_cash = TRUE AND date <= DATE '2026-10-01'")
        self.assertIn("is_cash", result["plannedSql"])
        self.assertIn("2026-10-01", result["plannedSql"])

    def test_cte_is_bounded_and_governed(self):
        result = self.planner.plan("WITH expenses AS (SELECT vendor, SUM(net_debit) AS amount FROM ledger WHERE account_type = 'EXPENSE' GROUP BY vendor) SELECT vendor, amount FROM expenses ORDER BY amount DESC LIMIT 5")
        self.assertIn("research.scoped_ledger", result["plannedSql"])
        self.assertIn("LIMIT 5", result["plannedSql"])

    def test_conditional_aggregate(self):
        result = self.planner.plan("SELECT SUM(CASE WHEN account_type = 'EXPENSE' THEN net_debit ELSE 0 END) AS expenses FROM ledger")
        self.assertIn("CASE", result["plannedSql"])

    def test_unknown_column_does_not_fall_back_to_custom_query(self):
        with self.assertRaises(Exception):
            self.planner.plan("SELECT hidden_salary FROM ledger")

    def test_attacks_rejected_before_engine(self):
        attacks = [
            "DELETE FROM ledger", "UPDATE ledger SET debit=0", "DROP TABLE ledger",
            "SELECT 1 FROM ledger; DELETE FROM ledger",
            "COPY ledger TO '/tmp/ledger.csv'",
            "SELECT pg_sleep(99) FROM ledger",
            "SELECT pg_read_file('/etc/passwd') FROM ledger",
            "SELECT pg_catalog.pg_read_file('/etc/passwd') FROM ledger",
            "SELECT dblink('host=evil','SELECT 1') FROM ledger",
            "SELECT set_config('role','owner',false) FROM ledger",
            "SELECT CURRENT_USER FROM ledger",
            "SELECT current_setting('research.organization_id') FROM ledger",
            "SELECT lo_get(1) FROM ledger",
            "SELECT SUM(base_debit) FROM another_tenant",
            "SELECT SUM(base_debit) FROM research.scoped_ledger",
            "SELECT SUM(base_debit) FROM public.ledger",
            "SELECT tablename FROM pg_tables",
            "SELECT COUNT(*) FROM read_csv('/etc/passwd')",
            "SELECT COUNT(*) FROM generate_series(1,1000000000000)",
            "SELECT * FROM ledger",
            "SELECT SUM(base_debit) FROM ledger FOR UPDATE",
            "SELECT SUM(base_debit) INTO stolen FROM ledger",
            "WITH deleted AS (DELETE FROM ledger RETURNING entry_id) SELECT entry_id FROM deleted",
            "WITH ledger AS (SELECT base_debit FROM secrets) SELECT SUM(base_debit) FROM ledger",
            "WITH RECURSIVE x AS (SELECT entry_id FROM ledger UNION ALL SELECT entry_id FROM x) SELECT entry_id FROM x",
            "SELECT base_debit FROM ledger LIMIT 100000",
            "SELECT base_debit FROM ledger LIMIT -1",
            "SELECT base_debit FROM ledger OFFSET 100000",
            "SELECT CAST(entry_id AS REGCLASS) FROM ledger",
            "SELECT CAST(base_debit AS DOUBLE PRECISION) FROM ledger",
            "SELECT random() FROM ledger",
            "SELECT base_debit FROM ledger WHERE entry_id=$1",
        ]
        for sql in attacks:
            with self.subTest(sql=sql), self.assertRaises(PolicyError):
                checked_ast(sql)

    def test_output_revalidated_against_exact_physical_view(self):
        checked_ast("SELECT SUM(base_debit) FROM research.scoped_ledger LIMIT 100", planned=True)
        for sql in ["SELECT SUM(base_debit) FROM research.other_ledger", "SELECT pg_sleep(1) FROM research.scoped_ledger", "SELECT SUM(base_debit) FROM public.scoped_ledger"]:
            with self.subTest(sql=sql), self.assertRaises(PolicyError):
                checked_ast(sql, planned=True)

    def test_string_contents_are_not_treated_as_sql_instructions(self):
        result = self.planner.plan("SELECT COUNT(*) FROM ledger WHERE description = 'DROP TABLE users; pay rent'")
        self.assertIn("'DROP TABLE users; pay rent'", result["plannedSql"])

    def test_protocol_safe_errors_and_following_request(self):
        requests = [
            {"id": "bad", "sql": "SELECT pg_sleep(9) FROM ledger"},
            {"id": "good", "sql": "SELECT COUNT(*) FROM ledger"},
        ]
        run = subprocess.run([sys.executable, str(Path(__file__).with_name("bridge.py"))], input="".join(json.dumps(x)+"\n" for x in requests), text=True, capture_output=True, timeout=5)
        self.assertEqual(run.returncode, 0)
        rows = [json.loads(row) for row in run.stdout.splitlines()]
        self.assertEqual(rows[0], {"id": "bad", "ok": False, "error": "FUNCTION_NOT_ALLOWED"})
        self.assertTrue(rows[1]["ok"])

    def test_manifest_values_cannot_be_supplied_by_request(self):
        run = subprocess.run([sys.executable, str(Path(__file__).with_name("bridge.py"))], input=json.dumps({"sql":"SELECT COUNT(*) FROM ledger", "manifest": {"evil":"source"}})+"\n", text=True, capture_output=True, timeout=5)
        self.assertEqual(json.loads(run.stdout)["error"], "REQUEST_SCHEMA")

    def test_unit_labels_follow_expressions_not_aliases(self):
        result = self.planner.plan("SELECT COUNT(*) AS usd, SUM(net_debit) AS account_code, EXTRACT(YEAR FROM date) AS amount FROM ledger GROUP BY EXTRACT(YEAR FROM date)")
        self.assertEqual(result["columnUnits"], {"usd": "count", "account_code": "USD", "amount": "unsupported"})
        self.assertEqual(result["unitProvenance"], "ast-v1")
        result = self.planner.plan("SELECT CAST(account_code AS DECIMAL) AS cash, exchange_rate AS money, date AS revenue FROM ledger")
        self.assertEqual(result["columnUnits"], {"cash": "unsupported", "money": "unsupported", "revenue": "unsupported"})

    def test_names_are_taken_from_actual_expanded_projection(self):
        result = self.planner.plan("SELECT COUNT(*) FROM ledger")
        self.assertEqual(result["columnUnits"], {"count(*)": "count"})
        result = self.planner.plan("SELECT SUM(net_debit) AS CashAmount FROM ledger")
        self.assertIn('AS "CashAmount"', result["plannedSql"])
        self.assertEqual(result["columnUnits"], {"CashAmount": "USD"})

    def test_units_for_aggregates_and_decimal_casts(self):
        expressions = ["SUM(net_debit)", "AVG(base_debit)", "MIN(base_credit)", "MAX(net_credit)", "ABS(SUM(net_debit))", "ROUND(SUM(net_debit), 2)", "CAST(SUM(base_debit) AS TEXT)", "COALESCE(SUM(net_debit), 0)"]
        for expression in expressions:
            with self.subTest(expression=expression):
                result = self.planner.plan(f"SELECT {expression} AS amount FROM ledger")
                self.assertEqual(result["columnUnits"]["amount"], "USD")

    def test_arithmetic_requires_compatible_units(self):
        expressions = {
            "SUM(base_debit) - SUM(base_credit)": "USD",
            "SUM(net_debit) + 0": "USD",
            "SUM(net_debit) * 2": "USD",
            "SUM(net_debit) / 2": "USD",
            "SUM(net_debit) / NULLIF(SUM(net_credit), 0)": "count",
            "COUNT(*) + SUM(net_debit)": "unsupported",
            "SUM(net_debit) * SUM(net_credit)": "unsupported",
            "SUM(exchange_rate)": "unsupported",
        }
        for expression, expected in expressions.items():
            with self.subTest(expression=expression):
                result = self.planner.plan(f"SELECT {expression} AS amount FROM ledger")
                self.assertEqual(result["columnUnits"]["amount"], expected)

    def test_case_only_preserves_common_amount_units(self):
        expressions = {
            "SUM(CASE WHEN is_cash THEN net_debit ELSE 0 END)": "USD",
            "SUM(CASE WHEN is_cash THEN net_debit END)": "USD",
            "SUM(CASE WHEN is_cash THEN base_debit ELSE base_credit END)": "USD",
            "SUM(CASE WHEN is_cash THEN net_debit ELSE 100 END)": "unsupported",
            "SUM(CASE WHEN is_cash THEN net_debit ELSE exchange_rate END)": "unsupported",
        }
        for expression, expected in expressions.items():
            with self.subTest(expression=expression):
                result = self.planner.plan(f"SELECT {expression} AS amount FROM ledger")
                self.assertEqual(result["columnUnits"]["amount"], expected)

    def test_native_amount_requires_fixed_currency_and_projection(self):
        result = self.planner.plan("SELECT currency AS denomination, SUM(debit-credit) AS amount FROM ledger WHERE currency='EUR' AND account_code='1010' GROUP BY currency")
        self.assertEqual(result["columnUnits"], {"denomination": "unsupported", "amount": "native"})
        self.assertEqual(result["nativeCurrency"], "EUR")
        self.assertEqual(result["currencyColumn"], "denomination")
        result = self.planner.plan("SELECT currency, debit AS amount FROM ledger WHERE 'JPY'=currency")
        self.assertEqual(result["columnUnits"]["amount"], "native")
        self.assertEqual(result["nativeCurrency"], "JPY")

    def test_native_units_are_withheld_for_missing_or_ambiguous_currency(self):
        queries = [
            "SELECT SUM(debit) AS amount FROM ledger WHERE currency='EUR'",
            "SELECT currency, SUM(debit) AS amount FROM ledger GROUP BY currency",
            "SELECT currency, SUM(debit) AS amount FROM ledger WHERE currency='EUR' OR currency='USD' GROUP BY currency",
            "SELECT currency, SUM(debit) AS amount FROM ledger WHERE NOT currency='USD' GROUP BY currency",
            "SELECT currency, SUM(debit) AS amount FROM ledger WHERE currency='EUR' AND currency='USD' GROUP BY currency",
        ]
        for query in queries:
            with self.subTest(query=query):
                result = self.planner.plan(query)
                self.assertEqual(result["columnUnits"]["amount"], "unsupported")
                self.assertNotIn("nativeCurrency", result)

    def test_complex_lineage_does_not_invent_money_units(self):
        queries = [
            "WITH x AS (SELECT account_code AS base_debit FROM ledger) SELECT SUM(CAST(base_debit AS DECIMAL)) AS amount FROM x",
            "SELECT SUM(x.base_debit) AS amount FROM (SELECT base_debit FROM ledger) AS x",
            "SELECT SUM(a.base_debit) AS amount FROM ledger AS a JOIN ledger AS b ON a.entry_id=b.entry_id",
        ]
        for query in queries:
            with self.subTest(query=query):
                result = self.planner.plan(query)
                self.assertEqual(result["columnUnits"]["amount"], "unsupported")
        result = self.planner.plan("WITH x AS (SELECT account_code FROM ledger) SELECT COUNT(*) AS amount FROM x")
        self.assertEqual(result["columnUnits"]["amount"], "count")

    def test_union_withholds_unit_proof(self):
        result = self.planner.plan("SELECT base_debit AS amount FROM ledger UNION ALL SELECT exchange_rate AS amount FROM ledger")
        self.assertEqual(result["columnUnits"], {})

    def test_unit_metadata_fails_closed_for_alias_collisions_and_table_renaming(self):
        # These metadata checks happen before a native engine might reject the SQL.
        # They test conservatism even if a future engine accepts these shapes.
        result = column_units(checked_ast("SELECT base_debit AS amount, exchange_rate AS amount FROM ledger"))
        self.assertEqual(result["columnUnits"]["amount"], "unsupported")
        result = column_units(checked_ast("SELECT base_debit AS cash FROM ledger AS x(base_debit)"))
        self.assertEqual(result["columnUnits"]["cash"], "unsupported")
        result = column_units(checked_ast("SELECT currency AS same, SUM(debit) AS same FROM ledger WHERE currency='EUR' GROUP BY currency"))
        self.assertNotIn("nativeCurrency", result)
        self.assertEqual(result["columnUnits"], {"same": "unsupported"})

    def test_scope_proves_explicit_unbounded_history(self):
        result = self.planner.plan("SELECT SUM(net_debit) AS amount FROM ledger WHERE is_cash = TRUE")
        self.assertEqual(result["rowScope"], {"provenance": "ast-scope-v1", "supported": True, "from": None, "toExclusive": None})

    def test_scope_normalizes_inclusive_and_reversed_date_bounds(self):
        cases = [
            ("date >= DATE '2026-01-01' AND date <= '2026-01-31'", "2026-01-01", "2026-02-01"),
            ("'2026-01-01' <= date AND '2026-02-01' > date", "2026-01-01", "2026-02-01"),
            ("date > '2026-01-01' AND date < '2026-02-01'", "2026-01-02", "2026-02-01"),
            ("date BETWEEN '2026-01-01' AND DATE '2026-01-31'", "2026-01-01", "2026-02-01"),
            ("CAST(date AS DATE) = '2026-01-15'", "2026-01-15", "2026-01-16"),
            ("date >= '2026-01-01' AND date >= '2026-01-15' AND date < '2026-03-01' AND date < '2026-02-01'", "2026-01-15", "2026-02-01"),
        ]
        for where, start, end in cases:
            with self.subTest(where=where):
                result = self.planner.plan(f"SELECT SUM(base_debit) AS amount FROM ledger WHERE {where}")
                self.assertEqual(result["rowScope"], {"provenance": "ast-scope-v1", "supported": True, "from": start, "toExclusive": end})

    def test_scope_retains_one_sided_asof_bounds(self):
        result = self.planner.plan("SELECT SUM(net_debit) AS amount FROM ledger WHERE is_cash = TRUE AND date <= DATE '2026-09-30'")
        self.assertEqual(result["rowScope"]["from"], None)
        self.assertEqual(result["rowScope"]["toExclusive"], "2026-10-01")

    def test_scope_returns_month_projection_and_actual_vendor_column(self):
        result = self.planner.plan("SELECT DATE_TRUNC('month', date) AS period, vendor AS customer, SUM(net_credit) AS revenue FROM ledger WHERE date >= '2026-07-15' AND date < '2026-10-01' AND account_type='REVENUE' GROUP BY DATE_TRUNC('month', date), vendor")
        self.assertEqual(result["rowScope"], {"provenance": "ast-scope-v1", "supported": True, "from": "2026-07-15", "toExclusive": "2026-10-01", "periodColumn": {"name": "period", "kind": "month"}, "identityColumns": {"vendor": "customer"}})

    def test_scope_resolves_unambiguous_group_aliases_and_positions(self):
        for group in ["period, vendor", "1, 2"]:
            with self.subTest(group=group):
                result = self.planner.plan(f"SELECT DATE_TRUNC('month', date) AS period, vendor, SUM(net_credit) AS amount FROM ledger GROUP BY {group}")
                self.assertTrue(result["rowScope"]["supported"])
                self.assertEqual(result["rowScope"]["periodColumn"], {"name": "period", "kind": "month"})

    def test_scope_direct_rows_preserve_entry_and_account_identity(self):
        result = self.planner.plan("SELECT date AS day, entry_id AS transaction, account_name AS vendor, account_code, base_debit AS amount FROM ledger WHERE 'Acme'=vendor AND account_code='6100' AND date='2026-09-01'")
        scope = result["rowScope"]
        self.assertEqual(scope["periodColumn"], {"name": "day", "kind": "date"})
        self.assertEqual(scope["identityColumns"], {"entryId": "transaction", "accountName": "vendor", "accountCode": "account_code"})
        self.assertEqual(scope["fixedIdentity"], {"vendor": "Acme", "accountCode": "6100"})

    def test_scope_fixed_native_currency_group_is_supported(self):
        result = self.planner.plan("SELECT currency, SUM(debit-credit) AS amount FROM ledger WHERE currency='EUR' AND account_code='1010' GROUP BY currency")
        self.assertTrue(result["rowScope"]["supported"])
        self.assertEqual(result["rowScope"]["fixedIdentity"], {"accountCode": "1010"})
        self.assertEqual(result["columnUnits"]["amount"], "native")

    def test_scope_does_not_infer_date_filters_from_literal_text(self):
        scope = self.planner.plan("SELECT COUNT(*) AS n FROM ledger WHERE description='date >= 2026-01-01 OR vendor=Acme'")["rowScope"]
        self.assertTrue(scope["supported"])
        self.assertIsNone(scope["from"])
        self.assertNotIn("fixedIdentity", scope)

    def test_scope_rejects_ambiguous_or_invalid_date_lineage(self):
        predicates = [
            "date >= '2026-01-01' OR vendor='Acme'", "NOT date < '2026-01-01'",
            "EXTRACT(YEAR FROM date)=2026", "CAST(date AS TIMESTAMP) >= '2026-01-01'",
            "date >= '2026-02-01' AND date < '2026-01-01'", "date = '2026-02-30'",
            "date = '20260101'", "date <= '9999-12-31'", "date = date",
            "date != '2026-01-01'", "account_code='1000' AND account_code='1010'",
        ]
        for predicate in predicates:
            with self.subTest(predicate=predicate):
                scope = row_scope(checked_ast(f"SELECT SUM(base_debit) AS amount FROM ledger WHERE {predicate}"))
                self.assertEqual(scope, {"provenance": "ast-scope-v1", "supported": False})

    def test_scope_rejects_conditional_and_complex_aggregate_lineage(self):
        queries = [
            "SELECT SUM(CASE WHEN date >= '2026-01-01' THEN net_debit ELSE 0 END) AS amount FROM ledger",
            "SELECT SUM(net_debit) FILTER(WHERE account_code='1000') AS amount FROM ledger",
            "WITH x AS (SELECT date, base_debit FROM ledger) SELECT SUM(base_debit) FROM x",
            "SELECT SUM(a.base_debit) FROM ledger a JOIN ledger b ON a.entry_id=b.entry_id",
            "SELECT base_debit FROM ledger UNION ALL SELECT base_credit FROM ledger",
            "SELECT SUM(base_debit) AS amount FROM ledger GROUP BY vendor HAVING SUM(base_debit)>10",
        ]
        for query in queries:
            with self.subTest(query=query):
                self.assertFalse(row_scope(checked_ast(query))["supported"])

    def test_scope_rejects_hidden_or_unsupported_group_buckets(self):
        queries = [
            "SELECT SUM(net_debit) AS amount FROM ledger GROUP BY DATE_TRUNC('month', date)",
            "SELECT SUM(net_debit) AS amount FROM ledger GROUP BY vendor",
            "SELECT currency, SUM(net_debit) AS amount FROM ledger GROUP BY currency",
            "SELECT EXTRACT(YEAR FROM date) AS year, SUM(net_debit) AS amount FROM ledger GROUP BY EXTRACT(YEAR FROM date)",
            "SELECT DATE_TRUNC('month', date) AS month, net_debit AS amount FROM ledger",
            "SELECT DATE_TRUNC('month', date) AS vendor, SUM(net_debit) AS amount FROM ledger GROUP BY vendor",
            "SELECT DATE_TRUNC('month', date, 'America/New_York') AS month, SUM(net_debit) AS amount FROM ledger GROUP BY 1",
            "SELECT date, date AS day, base_debit FROM ledger",
        ]
        for query in queries:
            with self.subTest(query=query):
                self.assertFalse(row_scope(checked_ast(query))["supported"])

    def test_scope_aliases_cannot_forge_period_or_vendor_identity(self):
        scope = row_scope(checked_ast("SELECT date AS day, entry_id, description AS month, account_name AS customer, base_debit AS amount FROM ledger"))
        self.assertTrue(scope["supported"])
        self.assertEqual(scope["periodColumn"], {"name": "day", "kind": "date"})
        self.assertEqual(scope["identityColumns"], {"entryId": "entry_id", "accountName": "customer"})
        scope = row_scope(checked_ast("SELECT CAST(vendor AS DATE) AS date, base_debit FROM ledger"))
        self.assertNotIn("periodColumn", scope)
        self.assertNotIn("identityColumns", scope)
        for query in ["SELECT date AS same, vendor AS same, base_debit FROM ledger", "SELECT base_debit AS cash FROM ledger AS x(base_debit)"]:
            self.assertFalse(row_scope(checked_ast(query))["supported"])

    def test_scope_raw_cash_lines_cannot_prove_a_cumulative_balance(self):
        for projection in ["net_debit AS amount", "date, net_debit AS amount", "entry_id, net_debit AS amount"]:
            with self.subTest(projection=projection):
                result = self.planner.plan(f"SELECT {projection} FROM ledger WHERE is_cash=TRUE AND date<=DATE '2026-09-30'")
                self.assertEqual(result["rowScope"], {"provenance": "ast-scope-v1", "supported": False})
                self.assertEqual(result["columnUnits"]["amount"], "USD")
        raw = self.planner.plan("SELECT date, entry_id, net_debit AS amount FROM ledger WHERE is_cash=TRUE AND date<=DATE '2026-09-30'")
        self.assertEqual(raw["rowScope"]["periodColumn"], {"name": "date", "kind": "date"})
        self.assertEqual(raw["rowScope"]["identityColumns"], {"entryId": "entry_id"})
        summed = self.planner.plan("SELECT SUM(net_debit) AS amount FROM ledger WHERE is_cash=TRUE AND date<=DATE '2026-09-30'")
        self.assertTrue(summed["rowScope"]["supported"])
        self.assertNotIn("periodColumn", summed["rowScope"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
