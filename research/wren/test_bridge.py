"""Real Wren planning tests; these do not claim PostgreSQL execution coverage."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest

from bridge import Planner, PolicyError, checked_ast, column_units


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
