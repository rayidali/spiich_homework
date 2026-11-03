"""Independent oracle arithmetic; deliberately imports no application code."""
import json
from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction
from pathlib import Path

ROWS = [
    ("01", 0, 0, 0, 0), ("02", 100, 50, 50, 1000),
    ("03", 100, 100, 200, 800), ("04", 100, 0, 0, 500),
    ("05", 200, 100, 100, 1000), ("06", 100, -200, 0, 0),
    ("07", 0, 0, 0, 0), ("08", 100, -100, 0, 200),
    ("09", 100, 50, 150, 600), ("10", 200, 100, 200, 1000),
    ("11", 100, -50, 0, 400), ("12", 100, 50, 50, 500),
]


def exact(value):
    with localcontext() as context:
        context.prec = 50
        display = (Decimal(value.numerator) / Decimal(value.denominator)).quantize(
            Decimal(".01"), rounding=ROUND_HALF_UP
        )
    return {"numerator": str(value.numerator), "denominator": str(value.denominator), "display": str(display)}


monthly = []
cumulative = 0
for month, rent, software, marketing, revenue in ROWS:
    expense = rent + software + marketing
    cumulative += expense
    monthly.append({
        "month": f"2025-{month}", "rent": rent, "software": software,
        "marketing": marketing, "revenue": revenue, "expenses": expense,
        "profit": revenue - expense,
        "rentSharePercent": None if expense == 0 else exact(Fraction(rent, expense) * 100),
        "cumulativeExpenses": cumulative,
    })

totals = {key: sum(row[key] for row in monthly) for key in ["rent", "software", "marketing", "revenue", "expenses", "profit"]}
shares = [Fraction(row["rent"], row["expenses"]) * 100 for row in monthly if row["expenses"] != 0]
ordered = sorted(row["expenses"] for row in monthly)
quarters = []
for start in (0, 3, 6, 9):
    part = monthly[start:start + 3]
    quarter = {"quarter": f"2025-Q{start // 3 + 1}"}
    for key in ["rent", "software", "marketing", "revenue", "expenses"]:
        quarter[key] = sum(row[key] for row in part)
    quarter["marketingShareRevenuePercent"] = exact(Fraction(quarter["marketing"], quarter["revenue"]) * 100)
    quarters.append(quarter)

report = {
    "status": "independently_computed_oracles_not_product_execution",
    "method": "Python fractions.Fraction and decimal ROUND_HALF_UP; no application imports",
    "clock": "2026-11-03T12:00:00-05:00",
    "monthly2025": monthly, "totals2025": totals,
    "annualRentSharePercent": exact(Fraction(totals["rent"], totals["expenses"]) * 100),
    "meanDefinedMonthlyRentSharePercent": exact(sum(shares) / len(shares)),
    "definedMonthlyShares": len(shares),
    "medianMonthlyExpenses": exact(Fraction(ordered[5] + ordered[6], 2)),
    "quarters": quarters,
    "trailingThreeMonthExpenses": [
        {"month": monthly[i]["month"], "average": exact(Fraction(sum(row["expenses"] for row in monthly[i-2:i+1]), 3))}
        for i in range(2, 12)
    ],
    "topThreeExpenseMonths": [{"month": row["month"], "expenses": row["expenses"]} for row in sorted(monthly, key=lambda row: (-row["expenses"], row["month"]))[:3]],
    "rankedExpenseQuarters": sorted(quarters, key=lambda row: (-row["expenses"], row["quarter"])),
    "profitMarginPercent": exact(Fraction(totals["profit"], totals["revenue"]) * 100),
    "q1ToQ4ExpenseGrowthPercent": exact(Fraction(750 - 600, 600) * 100),
    "octoberAlphaMarketingShareAllExpensesPercent": exact(Fraction(120, 500) * 100),
    "annualAlphaShareMarketingPercent": exact(Fraction(370, 750) * 100),
    "annualSoftwareShareExpensesPercent": exact(Fraction(100, 2050) * 100),
    "annualSoftwareShareRevenuePercent": exact(Fraction(100, 6000) * 100),
    "octoberMarketingByCounterparty": [
        {"counterparty": "Alpha", "amount": 120, "sharePercent": exact(Fraction(120, 200) * 100)},
        {"counterparty": "Beta", "amount": 80, "sharePercent": exact(Fraction(80, 200) * 100)},
    ],
    "yearToDate2026": {
        "monthly": [
            {"month": "2026-01", "rent": 100, "software": 100, "expenses": 200, "revenue": 400, "rentSharePercent": exact(Fraction(1, 2) * 100)},
            {"month": "2026-10", "rent": 200, "software": 100, "expenses": 300, "revenue": 900, "rentSharePercent": exact(Fraction(2, 3) * 100)},
            {"month": "2026-11", "rent": 50, "software": 50, "expenses": 100, "revenue": 200, "rentSharePercent": exact(Fraction(1, 2) * 100)},
        ],
        "otherElapsedMonths": "all zero; rent share undefined",
        "expenses": 600, "rent": 350, "revenue": 1500,
        "rentSharePercent": exact(Fraction(350, 600) * 100),
    },
}

assert totals == {"rent": 1200, "software": 100, "marketing": 750, "revenue": 6000, "expenses": 2050, "profit": 3950}
assert len(shares) == 9
assert report["annualRentSharePercent"]["display"] == "58.54"
assert report["meanDefinedMonthlyRentSharePercent"]["display"] == "49.81"
assert report["medianMonthlyExpenses"]["display"] == "150.00"
Path(__file__).with_name("acceptance-oracles.json").write_text(json.dumps(report, indent=2) + "\n")
print("Independent oracles computed; no product/provider/database calls.")
