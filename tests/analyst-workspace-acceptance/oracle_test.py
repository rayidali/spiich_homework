"""Reference-material checks only: no inference, database or application imports."""
import copy
import json
import unittest
from decimal import Decimal
from pathlib import Path

from oracle import calculate, validate

ROOT = Path(__file__).parent
BOOK = json.loads((ROOT / "fixture.json").read_text())


def get_entry(book, key):
    return next(e for e in book["entries"] if e["key"] == key)


def value(book, name):
    return calculate(book)["facts"][name]["value"]


class ReferenceIntegrity(unittest.TestCase):
    def test_hand_checked_accounting_anchors(self):
        # Independently authored dollar totals; not read back from expected.json.
        self.assertEqual(validate(BOOK), [])
        self.assertEqual(value(BOOK, "cash.total"), "23427.65")
        self.assertEqual(value(BOOK, "spend.total"), "16030.35")
        self.assertEqual(value(BOOK, "spend.supplies"), "875.00")
        self.assertEqual(value(BOOK, "spend.contractors"), "4800.00")
        self.assertEqual(value(BOOK, "supplies.all_history_total"), "995.00")
        self.assertEqual(value(BOOK, "travel.native"), {"EUR": "300.00", "USD": "80.00"})
        self.assertEqual(value(BOOK, "travel.base"), "430.00")
        self.assertEqual(value(BOOK, "expenses.trailing_median"), "2890.00")
        # The monthly expense vector is specified separately from the ledger rows.
        manual_months = ["1260", "1535", "2140", "0", "1280", "1220", "0", "0", "2890", "5705.35", "0"]
        actual_months = value(BOOK, "rent.monthly_shares")
        self.assertEqual([Decimal(r["expenses"]) for r in actual_months], list(map(Decimal, manual_months)))
        bridge = value(BOOK, "october.profit_cash_bridge")
        self.assertEqual(bridge, {"revenue": "4200.00", "expenses": "5705.35", "profit": "-1505.35", "cash_change": "-1047.35", "card_liability_increase": "458.00"})
        self.assertEqual(Decimal(bridge["profit"]) + Decimal(bridge["card_liability_increase"]), Decimal(bridge["cash_change"]))

    def test_draft_posted_and_future_date_changes_are_detectable(self):
        changed = copy.deepcopy(BOOK)
        get_entry(changed, "draft-rent")["status"] = "POSTED"
        self.assertEqual(value(changed, "cash.total"), "22427.65")
        self.assertEqual(value(changed, "spend.total"), "17030.35")
        changed = copy.deepcopy(BOOK)
        get_entry(changed, "future-rent")["date"] = "2026-11-03"
        self.assertEqual(value(changed, "cash.total"), "23027.65")
        self.assertEqual(value(changed, "spend.total"), "16430.35")

    def test_refund_sign_changes_are_detectable(self):
        changed = copy.deepcopy(BOOK)
        for line in get_entry(changed, "supplies-refund-feb")["lines"]:
            line["debit"], line["credit"] = line["credit"], line["debit"]
            line["base_debit"], line["base_credit"] = line["base_credit"], line["base_debit"]
        self.assertEqual(validate(changed), [])
        self.assertEqual(value(changed, "spend.supplies"), "1025.00")
        self.assertEqual(value(changed, "spend.total"), "16180.35")
        self.assertEqual(value(changed, "cash.total"), "23277.65")

    def test_other_business_cannot_change_primary_results(self):
        changed = copy.deepcopy(BOOK)
        other = get_entry(changed, "other-supplies")
        for line in other["lines"]:
            for side in ["debit", "credit"]:
                if Decimal(line[side]):
                    line[side] = line["base_" + side] = "999999.00"
        self.assertEqual(validate(changed), [])
        self.assertEqual(calculate(changed), calculate(BOOK))
        other["organization_id"] = BOOK["organization_id"]
        self.assertTrue(any("Cross-organization" in issue for issue in validate(changed)))

    def test_native_fx_and_balance_corruption_are_rejected(self):
        changed = copy.deepcopy(BOOK)
        get_entry(changed, "travel-jun")["lines"][0]["exchange_rate"] = "1.20"
        self.assertIn("Stored FX mismatch: travel-jun", validate(changed))
        changed = copy.deepcopy(BOOK)
        get_entry(changed, "rent-01")["lines"][0]["base_debit"] = "1000.01"
        self.assertIn("Unbalanced entry: rent-01", validate(changed))

    def test_reversal_link_and_net_history_matter(self):
        changed = copy.deepcopy(BOOK)
        reverse = get_entry(changed, "software-error-reversal")
        for line in reverse["lines"]:
            for side in ["debit", "credit"]:
                if Decimal(line[side]):
                    line[side] = line["base_" + side] = "80.00"
        self.assertIn("Inexact reversal: software-error-reversal", validate(changed))
        self.assertEqual(value(changed, "spend.total"), "16040.35")
        self.assertEqual(value(changed, "cash.total"), "23417.65")

    def test_zero_ratios_and_chart_reference_values(self):
        rows = value(BOOK, "rent.monthly_shares")
        undefined = [r["month"] for r in rows if r["rent_pct"] is None]
        self.assertEqual(undefined, ["2026-04", "2026-07", "2026-08", "2026-11"])
        self.assertEqual(value(BOOK, "rent.mean_monthly_share")["defined_months"], 7)
        self.assertNotEqual(value(BOOK, "rent.annual_share"), value(BOOK, "rent.mean_monthly_share")["percent"])
        concentration = value(BOOK, "vendors.top_three")
        self.assertEqual([r["vendor"] for r in concentration], ["Hudson Properties", "Alloy Partners", "Stationers"])
        self.assertEqual([r["expense"] for r in concentration], ["8500.00", "4800.00", "875.00"])
        self.assertEqual(value(BOOK, "alerts.history"), {"OPEN": 3, "DISMISSED": 1, "RESOLVED": 1})
        self.assertEqual(len(value(BOOK, "supplies.all_history")), 10)


if __name__ == "__main__":
    unittest.main()
