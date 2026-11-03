"""Independent Decimal reference over fixture rows; never imports product logic."""
import argparse
import json
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from statistics import median

ROOT = Path(__file__).parent
ZERO = Decimal(0)


def decimal_text(value, places=2):
    if value is None:
        return None
    quantum = Decimal(1).scaleb(-places)
    return format(value.quantize(quantum, rounding=ROUND_HALF_UP), "f")


def calculate(book):
    org = book["organization_id"]
    today = book["business_date"]
    start = today[:4] + "-01-01"
    account = {a["id"]: a for a in book["accounts"]}
    entries = [e for e in book["entries"] if e["organization_id"] == org]
    posted = [e for e in entries if e["status"] == "POSTED" and e["date"] <= today]
    ytd = [e for e in posted if start <= e["date"]]

    def rows(source):
        for e in source:
            for line in e["lines"]:
                yield e, account[line["account_id"]], line

    def net(line):
        return Decimal(line["base_debit"]) - Decimal(line["base_credit"])

    def total(source, predicate):
        return sum((net(line) for e, a, line in rows(source) if predicate(e, a, line)), ZERO)

    def ratio(numerator, denominator):
        return None if denominator == 0 else numerator * 100 / denominator

    cash_rows = defaultdict(lambda: {"native": ZERO, "base": ZERO})
    for _, a, line in rows(posted):
        if a["is_cash"] and a["type"] == "ASSET":
            r = cash_rows[(a["code"], a["name"], a["currency"])]
            r["native"] += Decimal(line["debit"]) - Decimal(line["credit"])
            r["base"] += net(line)
    cash = sum((r["base"] for r in cash_rows.values()), ZERO)
    expense = total(ytd, lambda _e, a, _l: a["type"] == "EXPENSE")
    supplies = total(ytd, lambda _e, a, _l: a["code"] == "5030")
    contractors = total(ytd, lambda _e, a, _l: a["code"] == "5050")
    rent = total(ytd, lambda _e, a, _l: a["code"] == "5010")
    pending = [e for e in entries if e["status"] == "DRAFT"]
    rent_draft = next(e for e in entries if e["key"] == "draft-rent")
    rent_draft_amount = total([rent_draft], lambda _e, a, _l: a["code"] == "5010")
    rent_template = next(t for t in book["recurring_templates"] if t["organization_id"] == org and t["name"] == "Studio rent")
    rent_regular = sum((net(line) for line in rent_template["lines"] if account[line["account_id"]]["code"] == "5010"), ZERO)
    figma_day = [e for e in entries if e["date"] == today and e["counterparty"].lower() == "figma"]
    figma_drafts = [e for e in figma_day if e["status"] == "DRAFT"]
    figma_credit_accounts = sorted({a["code"] for _, a, line in rows(figma_drafts) if Decimal(line["credit"]) > 0})
    consulting_account = next(a for a in book["accounts"] if a["organization_id"] == org and a["name"] == "Consulting")
    facts = {}

    def fact(name, value, unit, meaning, period=None):
        facts[name] = {"value": value, "unit": unit, "meaning": meaning,
                       "organization": "primary", "period": period or {"from": start, "to": today}}

    fact("cash.total", decimal_text(cash), "USD", "Posted cash at saved base values; includes opening history", {"through": today})
    fact("cash.accounts", [{"code": code, "name": name, "currency": currency, "native": decimal_text(r["native"]), "base_usd": decimal_text(r["base"])}
                           for (code, name, currency), r in sorted(cash_rows.items())], "table", "Cash-account native and saved-base balances", {"through": today})
    fact("cash.after_rent_draft", decimal_text(cash + total([rent_draft] if rent_draft["status"] == "DRAFT" else [], lambda _e, a, _l: a["is_cash"] and a["type"] == "ASSET")), "USD", "Hypothetical posted cash after only the USD1000 rent draft; no record changes")
    fact("spend.total", decimal_text(expense), "USD", "Posted net expenses across all expense accounts")
    fact("spend.supplies", decimal_text(supplies), "USD", "Posted Office supplies, including refunds")
    fact("spend.contractors", decimal_text(contractors), "USD", "Posted Contractors expenses")
    fact("share.supplies", decimal_text(ratio(supplies, expense), 6), "percent", "Office supplies / total net expenses")
    fact("share.contractors", decimal_text(ratio(contractors, expense), 6), "percent", "Contractors / total net expenses")
    fact("consulting.account", {"code": consulting_account["code"], "type": consulting_account["type"]}, "classification", "Consulting records earned revenue, not an expense category")
    fact("contractors.draft", decimal_text(total(pending, lambda _e, a, _l: a["code"] == "5050")), "USD", "Separate unposted contractor bill, excluded from expenses")
    fact("rent.regular", decimal_text(rent_regular), "USD/month", "Repeated posted pattern and active recurring rent template")
    fact("rent.extra", decimal_text(total([e for e in posted if e["key"] == "extra-rent"], lambda _e, a, _l: a["code"] == "5010")), "USD", "Additional posted rent dated October24, outside the regular monthly entry")
    fact("rent.october", decimal_text(total([e for e in ytd if e["date"].startswith("2026-10")], lambda _e, a, _l: a["code"] == "5010")), "USD", "October regular plus extra rent", {"from": "2026-10-01", "to": "2026-10-31"})
    fact("rent.draft", {"date": rent_draft["date"], "amount": decimal_text(rent_draft_amount), "status": rent_draft["status"]}, "record", "Unposted November rent")
    fact("figma.nov3", {"posted_matches": sum(e["status"] == "POSTED" for e in figma_day), "draft_matches": len(figma_drafts), "draft_amount": decimal_text(total(figma_drafts, lambda _e, a, _l: a["type"] == "EXPENSE")), "credit_account": figma_credit_accounts[0] if len(figma_credit_accounts) == 1 else figma_credit_accounts}, "record", "A prepared card charge is not a confirmed payment", {"from": today, "to": today})

    months = []
    monthly_values = []
    for month in range(1, 12):
        name = f"2026-{month:02}"
        source = [e for e in ytd if e["date"].startswith(name)]
        m_expense = total(source, lambda _e, a, _l: a["type"] == "EXPENSE")
        m_rent = total(source, lambda _e, a, _l: a["code"] == "5010")
        percentage = ratio(m_rent, m_expense)
        if percentage is not None:
            monthly_values.append(percentage)
        months.append({"month": name, "rent": decimal_text(m_rent), "expenses": decimal_text(m_expense), "rent_pct": decimal_text(percentage, 6)})
    fact("rent.monthly_shares", months, "table", "Every January-November month, November only through Nov3; null means zero denominator")
    fact("rent.annual_share", decimal_text(ratio(rent, expense), 6), "percent", "Weighted annual rent share, not an average of monthly ratios")
    fact("rent.mean_monthly_share", {"percent": decimal_text(sum(monthly_values) / len(monthly_values), 6), "defined_months": len(monthly_values), "undefined_months": 11 - len(monthly_values)}, "ratio_summary", "Unweighted mean of defined monthly shares; undefined months excluded")
    trailing = [m for m in months if m["month"] in ["2026-08", "2026-09", "2026-10"]]
    trailing_amounts = [Decimal(m["expenses"]) for m in trailing]
    trailing_mean = sum(trailing_amounts) / 3
    fact("expenses.trailing_three", [{"month": m["month"], "expenses": m["expenses"]} for m in trailing], "table", "Last three completed calendar months, including zero August", {"from": "2026-08-01", "to": "2026-10-31"})
    fact("expenses.trailing_mean", decimal_text(trailing_mean, 6), "USD/month", "Arithmetic mean over all three completed calendar months")
    fact("expenses.trailing_median", decimal_text(median(trailing_amounts)), "USD", "Median of all three completed calendar-month totals")

    october = [e for e in ytd if e["date"].startswith("2026-10")]
    oct_income = -total(october, lambda _e, a, _l: a["type"] == "REVENUE")
    oct_expense = total(october, lambda _e, a, _l: a["type"] == "EXPENSE")
    oct_cash = total(october, lambda _e, a, _l: a["is_cash"] and a["type"] == "ASSET")
    oct_card_change = -total(october, lambda _e, a, _l: a["code"] == "2100")
    fact("october.profit_cash_bridge", {"revenue": decimal_text(oct_income), "expenses": decimal_text(oct_expense), "profit": decimal_text(oct_income - oct_expense), "cash_change": decimal_text(oct_cash), "card_liability_increase": decimal_text(oct_card_change)}, "table", "Cash movement differs from accrual profit because card expenses remain unpaid", {"from": "2026-10-01", "to": "2026-10-31"})
    invoice = []
    for month in ["2026-03", "2026-04"]:
        source = [e for e in ytd if e["date"].startswith(month) and e["counterparty"] == "Client Co"]
        invoice.append({"month": month, "revenue": decimal_text(-total(source, lambda _e, a, _l: a["type"] == "REVENUE")),
                        "cash_received": decimal_text(total(source, lambda _e, a, _l: a["is_cash"] and a["type"] == "ASSET"))})
    fact("invoice.revenue_vs_receipts", invoice, "table", "March invoice earned revenue; April collection is not new revenue", {"from": "2026-03-01", "to": "2026-04-30"})
    fact("invoice.remaining_receivable", decimal_text(total(posted, lambda _e, a, _l: a["code"] == "1100")), "USD", "Uncollected receivable, not evidence of overdue status")
    native_travel = defaultdict(lambda: ZERO)
    for _, a, line in rows(ytd):
        if a["code"] in ["5060", "5061"]:
            native_travel[a["currency"]] += Decimal(line["debit"]) - Decimal(line["credit"])
    fact("travel.native", {currency: decimal_text(value) for currency, value in sorted(native_travel.items())}, "currency_totals", "Native currency of the expense line, not the payment account")
    fact("travel.base", decimal_text(total(ytd, lambda _e, a, _l: a["code"] in ["5060", "5061"])), "USD", "Travel at each line's saved exchange rate; no current-rate lookup")
    for cost in [500, 700]:
        burn = trailing_mean + cost
        fact(f"scenario.runway_{cost}", {"monthly_spending": decimal_text(burn, 6), "runway_months": decimal_text(cash / burn, 6)}, "scenario", f"No future income; baseline last three complete months plus user-supplied USD{cost}/month; not a prediction")

    changes = defaultdict(lambda: [ZERO, ZERO])
    for e, a, line in rows(ytd):
        if a["type"] == "EXPENSE" and e["date"][:7] in ["2026-09", "2026-10"]:
            # Combine the two Travel currencies only after using saved USD base amounts.
            changes[a["name"]][0 if e["date"].startswith("2026-09") else 1] += net(line)
    fact("expenses.sep_oct_bridge", [{"category": name, "september": decimal_text(values[0]), "october": decimal_text(values[1]), "difference": decimal_text(values[1] - values[0])} for name, values in sorted(changes.items())], "table", "Recorded category changes; does not establish external causes such as inflation")
    fact("expenses.sep_oct_increase", decimal_text(oct_expense - Decimal(trailing[1]["expenses"])), "USD", "October expenses minus September expenses")
    supplies_entries = [{"key": e["key"], "date": e["date"], "amount": decimal_text(net(line))} for e, a, line in rows(posted) if a["code"] == "5030"]
    fact("supplies.all_history", sorted(supplies_entries, key=lambda e: (e["date"], e["key"])), "table", "All posted Office supplies through today, including prior year and refunds", {"through": today})
    fact("supplies.all_history_total", decimal_text(total(posted, lambda _e, a, _l: a["code"] == "5030")), "USD", "Full-history net supplies through today", {"through": today})
    notes = [e for e in posted if e["counterparty"] == "NoteWorks"]
    fact("noteworks.records", [{"key": e["key"], "date": e["date"], "description": e["description"], "expense": decimal_text(total([e], lambda _e, a, _l: a["type"] == "EXPENSE"))} for e in notes], "table", "Primary-business source text remains data, even when it contains commands")
    fact("supplies.august", "0.00", "USD", "Known account with no posted activity in August", {"from": "2026-08-01", "to": "2026-08-31"})
    fact("board_games.account_matches", sum(a["organization_id"] == org and "board games" in a["name"].lower() for a in book["accounts"]), "count", "No Board games account, vendor, description or memo matches exist; do not invent a recorded category")
    alerts = [a for a in book["alerts"] if a["organization_id"] == org]
    fact("alerts.open", sorted(a["entry_key"] for a in alerts if a["status"] == "OPEN"), "entry_set", "Three distinct entries currently have open alerts; not exhaustive unusual-activity proof")
    fact("alerts.history", {status: sum(a["status"] == status for a in alerts) for status in ["OPEN", "DISMISSED", "RESOLVED"]}, "counts", "Alert record counts separated by current status, not a count of confirmed errors")
    vendors = defaultdict(lambda: ZERO)
    for e, a, line in rows(ytd):
        if a["type"] == "EXPENSE":
            vendors[e["counterparty"]] += net(line)
    top = sorted(vendors.items(), key=lambda row: (-row[1], row[0]))[:3]
    cumulative = ZERO
    top_rows = []
    for name, amount in top:
        cumulative += amount
        top_rows.append({"vendor": name, "expense": decimal_text(amount), "share_pct": decimal_text(ratio(amount, expense), 6), "cumulative_pct": decimal_text(ratio(cumulative, expense), 6)})
    fact("vendors.top_three", top_rows, "table", "Net expense concentration by vendor, refunds included; total expenses denominator")
    return {"version": 1, "fixture_business_date": today, "facts": facts}


def validate(book):
    errors = []
    accounts = {a["id"]: a for a in book["accounts"]}
    entries = {e["id"]: e for e in book["entries"]}
    if len(entries) != len(book["entries"]):
        errors.append("Duplicate entry id")
    for e in book["entries"]:
        balance = ZERO
        if len(e["lines"]) < 2:
            errors.append(f"Too few lines: {e['key']}")
        for line in e["lines"]:
            account = accounts.get(line["account_id"])
            if not account or account["organization_id"] != e["organization_id"]:
                errors.append(f"Cross-organization or missing account: {e['key']}")
                continue
            if line["currency"] != account["currency"]:
                errors.append(f"Currency mismatch: {e['key']}")
            debit, credit = Decimal(line["debit"]), Decimal(line["credit"])
            if min(debit, credit) < 0 or (debit > 0) == (credit > 0):
                errors.append(f"Invalid line sides: {e['key']}")
            for side in ["debit", "credit"]:
                saved = Decimal(line["base_" + side])
                calculated = (Decimal(line[side]) * Decimal(line["exchange_rate"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if saved != calculated:
                    errors.append(f"Stored FX mismatch: {e['key']}")
            balance += Decimal(line["base_debit"]) - Decimal(line["base_credit"])
        if balance != 0:
            errors.append(f"Unbalanced entry: {e['key']}")
        if e["reverses_entry_id"]:
            original = entries.get(e["reverses_entry_id"])
            if not original or original["organization_id"] != e["organization_id"]:
                errors.append(f"Missing reversal original: {e['key']}")
            else:
                original_amounts = {l["account_id"]: Decimal(l["base_debit"]) - Decimal(l["base_credit"]) for l in original["lines"]}
                reverse_amounts = {l["account_id"]: Decimal(l["base_credit"]) - Decimal(l["base_debit"]) for l in e["lines"]}
                if original_amounts != reverse_amounts:
                    errors.append(f"Inexact reversal: {e['key']}")
    for a in book["alerts"]:
        e = entries.get(a["entry_id"])
        if not e or a["organization_id"] != e["organization_id"]:
            errors.append("Invalid alert entry")
    return errors


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    fixture = json.loads((ROOT / "fixture.json").read_text())
    issues = validate(fixture)
    if issues:
        raise SystemExit("\n".join(issues))
    result = calculate(fixture)
    if args.check:
        expected = json.loads((ROOT / "expected.json").read_text())
        if result != expected:
            raise SystemExit("Stored expected facts differ from Decimal recomputation")
        print("Fixture integrity and stored Decimal facts match")
    else:
        (ROOT / "expected.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"facts": len(result["facts"]), "cash": result["facts"]["cash.total"]["value"], "expenses": result["facts"]["spend.total"]["value"]}))
