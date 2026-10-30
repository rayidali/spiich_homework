#!/usr/bin/env python3
"""Render the Daybook architecture report as an independent, vector PDF.

Optional exporter dependency: reportlab==5.1.0 (not an application dependency).
Install it in a Python environment, then run:
    python scripts/export-architecture-report.py
Local development environment:
    .tools/report-render/bin/python scripts/export-architecture-report.py
This is a native ReportLab rendering, not a browser print of the HTML report.
Content is a concise companion to docs/reports/architecture-review.html.
"""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/reports/architecture-review.pdf"
W, H = landscape(A4)
M = 36
CW = W - M * 2
INK = colors.HexColor("#20352e")
MUTED = colors.HexColor("#596b62")
PAPER = colors.HexColor("#fbfaf6")
LINE = colors.HexColor("#d6ddd4")
GREEN = colors.HexColor("#286648")
PALE = colors.HexColor("#eaf1e8")
CLAY = colors.HexColor("#9e4e32")
SAND = colors.HexColor("#f5e9db")
AMBER = colors.HexColor("#825c19")
BLUE = colors.HexColor("#365e83")
WHITE = colors.white
CHECKS = []


def p(text, x, top, width, size=10.5, leading=None, color=INK,
      font="Helvetica", max_height=None):
    """Paragraph at a top-based position, with measured content bounds."""
    style = ParagraphStyle(
        "body", fontName=font, fontSize=size, leading=leading or size * 1.38,
        textColor=color, alignment=TA_LEFT, spaceAfter=0,
        allowWidows=0, allowOrphans=0,
    )
    para = Paragraph(text, style)
    _, height = para.wrap(width, 1000)
    if x < 0 or x + width > W + .1 or top < 0:
        raise ValueError(f"Text box extends beyond page: {text[:80]}")
    if max_height is not None and height > max_height + 0.1:
        raise ValueError(f"Text exceeds box ({height:.1f}>{max_height}): {text[:80]}")
    if top + height > H - 40:
        raise ValueError(f"Text enters footer: {text[:80]}")
    para.drawOn(C, x, H - top - height)
    CHECKS.append((PAGE, text[:45], round(top + height, 1)))
    return height


def rect(x, top, width, height, fill=WHITE, stroke=LINE, radius=0):
    if x < 0 or x + width > W + .1 or top < 0:
        raise ValueError("Box extends beyond page")
    if top + height > H - 38:
        raise ValueError("Box enters footer")
    C.setFillColor(fill)
    C.setStrokeColor(stroke)
    C.setLineWidth(0.7)
    C.roundRect(x, H - top - height, width, height, radius, fill=1, stroke=1)


def line(x1, top1, x2, top2, color=GREEN, dashed=False, width=1.3):
    C.setStrokeColor(color)
    C.setLineWidth(width)
    C.setDash(3, 3) if dashed else C.setDash()
    C.line(x1, H - top1, x2, H - top2)
    C.setDash()


def arrow(x1, top1, x2, top2, color=GREEN, dashed=False):
    from math import atan2, cos, sin
    line(x1, top1, x2, top2, color, dashed)
    angle = atan2(top2 - top1, x2 - x1)
    back_x, back_y = x2 - 5 * cos(angle), top2 - 5 * sin(angle)
    path = C.beginPath()
    path.moveTo(x2, H - top2)
    path.lineTo(back_x + 2.5 * sin(angle), H - back_y + 2.5 * cos(angle))
    path.lineTo(back_x - 2.5 * sin(angle), H - back_y - 2.5 * cos(angle))
    path.close()
    C.setFillColor(color)
    C.drawPath(path, fill=1, stroke=0)


def tag(label, x, top, color=GREEN, fill=PALE):
    width = C.stringWidth(label.upper(), "Helvetica-Bold", 7.4) + 13
    rect(x, top, width, 17, fill, color)
    p(escape(label.upper()), x + 6, top + 3.1, width - 10,
      size=7.4, font="Helvetica-Bold", max_height=11)
    return width


def card(x, top, width, height, title, body, fill=WHITE, title_size=14, body_size=10.1):
    rect(x, top, width, height, fill)
    h = p(title, x + 14, top + 13, width - 28,
          size=title_size, font="Helvetica-Bold", max_height=height - 25)
    p(body, x + 14, top + 21 + h, width - 28, size=body_size,
      color=MUTED, max_height=height - h - 25)


def callout(text, top, height=43, fill=PALE, color=GREEN, x=M, width=CW, size=10.5):
    rect(x, top, width, height, fill, fill)
    line(x, top, x, top + height, color, width=2.4)
    p(text, x + 13, top + 10, width - 26, size=size, max_height=height - 18)


def start(number, eyebrow, title, intro, title_size=29):
    global PAGE
    PAGE = number
    C.setFillColor(PAPER)
    C.rect(0, 0, W, H, fill=1, stroke=0)
    C.setStrokeColor(CLAY)
    C.setLineWidth(1.4)
    C.roundRect(M, H - 39, 10, 13, 1, fill=0, stroke=1)
    line(M + 3, 26, M + 3, 39, CLAY, width=2)
    p("Daybook", M + 17, 26, 100, size=10.3, font="Helvetica-Bold")
    p(eyebrow.upper(), M + 170, 28, CW - 170, size=8, color=MUTED)
    p(title, M, 61, CW, size=title_size, leading=title_size * 1.08,
      font="Times-Roman", max_height=75)
    if intro:
        p(intro, M, 108, CW, size=12, color=MUTED, max_height=44)


def finish(label, note="DAYBOOK / Architecture explained"):
    line(M, H - 31, W - M, H - 31, LINE, width=.6)
    C.setFillColor(MUTED)
    C.setFont("Helvetica", 7)
    C.drawString(M, 18, note)
    C.drawRightString(W - M, 18, f"{PAGE:02d} / 08  ·  {label}")
    C.showPage()


def table(rows, widths, top, font_size=9, row_heights=None):
    style = ParagraphStyle("cell", fontName="Helvetica", fontSize=font_size,
                           leading=font_size * 1.32, textColor=INK)
    items = [[Paragraph(cell, style) for cell in row] for row in rows]
    if row_heights:
        for row_index, row in enumerate(items):
            for column_index, cell in enumerate(row):
                _, cell_height = cell.wrap(widths[column_index] - 16, 1000)
                if cell_height > row_heights[row_index] - 16 + .1:
                    raise ValueError(f"Table cell overflows on page {PAGE}, "
                                     f"row {row_index}, column {column_index}")
    t = Table(items, colWidths=widths, rowHeights=row_heights, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("LINEBELOW", (0, 0), (-1, 0), 1, INK),
        ("LINEBELOW", (0, 1), (-1, -1), .5, LINE),
    ]))
    _, height = t.wrap(CW, 1000)
    if top + height > H - 45:
        raise ValueError(f"Table enters footer on page {PAGE}")
    t.drawOn(C, M, H - top - height)
    CHECKS.append((PAGE, "table", round(top + height, 1)))
    return height


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
C = canvas.Canvas(str(OUTPUT), pagesize=(W, H), pageCompression=1)
C.setTitle("Daybook — Architecture, explained")
C.setAuthor("Daybook engineering notes")
C.setSubject("Research lessons, current evidence, proposed architecture and delivery plan")
PAGE = 0

# 1: Product lessons.
start(1, "Planning snapshot / 29 October 2026",
      "A reliable ledger.<br/>A helpful assistant.", "", title_size=34)
p("What we learned from Spiich, Midday and Actual—and how those lessons shape "
  "a focused, explainable accounting product.", M, 149, CW - 80, size=13, color=MUTED)
gap, node_w = 20, (CW - 60) / 4
nodes = [
    ("You describe the work", "“Paid $2,400 rent from checking.”", WHITE),
    ("AI interprets it", "Suggest accounts; ask when facts are missing.", SAND),
    ("Application controls it", "Review, validate, and permit the operation.", WHITE),
    ("Database protects it", "Balance, exact values and preserved history.", PALE),
]
for i, (title, body, fill) in enumerate(nodes):
    x = M + i * (node_w + gap)
    card(x, 201, node_w, 80, title, body, fill, title_size=12)
    if i < 3:
        arrow(x + node_w + 3, 241, x + node_w + gap - 3, 241)
width = (CW - 28) / 3
lessons = [
    ("Spiich / useful work", "Connect ordinary language to a business record and "
     "a permitted action. Its connection to the assignment is our inference."),
    ("Midday / factual tools", "Use authored financial queries and supporting "
     "records. Its founders announced a Ramp transition and product wind-down."),
    ("Actual / visible rules", "Make repeated category decisions inspectable and "
     "editable. Its SQLite budget model differs from our PostgreSQL journal."),
]
for i, (title, body) in enumerate(lessons):
    card(M + i * (width + 14), 303, width, 119, title, body, title_size=13)
callout("<b>Recommendation:</b> complete a Gemini baseline on the existing ledger, "
        "simplify the main tasks, and let measured failures decide whether another "
        "component earns its place.", 443, 51)
p("Planning snapshot before the Gemini/interface implementation. See CHECKPOINT.md for current status. "
  "Examples are illustrative; sources are on page 8.",
  M, 514, CW, size=9.2, color=MUTED)
finish("The main idea")

# 2: State and evidence.
start(2, "Start from the application we have", "Built, proposed, and still to verify.",
      "Code existing and behavior being proved in the real environment are different claims.")
tag("Built / implemented", M, 145)
tag("Proposed / next choice", M + 144, 145, CLAY, SAND)
tag("Verify / evidence needed", M + 310, 145, AMBER, colors.HexColor("#fff5db"))
rows = [
    ["<b>AREA</b>", "<b>BUILT TODAY</b>", "<b>PROPOSED NEXT</b>", "<b>STILL TO VERIFY</b>"],
    ["<b>Ledger + reports</b>", "Exact PostgreSQL journal, balanced posting, reversals and four SQL reports.",
     "Preserve the engine; explain results clearly.", "Relevant regressions after changes."],
    ["<b>AI entry + chat</b>", "OpenAI adapter, proposals, clarification and four query families.",
     "Gemini adapter; stronger evaluation.", "No key configured; no live model tests."],
    ["<b>Categorization</b>", "Text retrieval of history and confirmed corrections.",
     "Explicit rules; optional semantic retrieval.", "Whether suggestions improve."],
    ["<b>Background work</b>", "Recurring drafts, statistical alerts, durable jobs and retries.",
     "Retain bounded processing.", "Final environment behavior."],
    ["<b>Interface</b>", "All assignment workflows and Daybook redesign.",
     "Simpler record / review / understand flow.", "Revised flows; physical phone."],
    ["<b>Docker + delivery</b>", "Compose files, config check, archive and documentation.",
     "Clean startup and persistence checks.", "Actual Docker build/start pending."],
]
table(rows, [112, 252, 203, CW - 567], 179, font_size=9,
      row_heights=[29, 40, 40, 40, 40, 40, 40])
stats = [
    ("29", "Database / app tests", "Real PostgreSQL"),
    ("8", "Provider-contract tests", "Controlled responses; not live accuracy"),
    ("8", "Browser workflows", "Production bundle; not physical devices"),
]
for i, (number, title, detail) in enumerate(stats):
    x = M + i * (CW / 3)
    p(number, x, 464, 70, size=29, font="Times-Roman", color=GREEN)
    p(title, x + 54, 466, CW / 3 - 58, size=10, font="Helvetica-Bold")
    p(detail, x + 54, 482, CW / 3 - 58, size=8.6, color=MUTED)
p("Saved historical baseline. Report creation did not rerun these suites. Authentication, "
  "million-user capacity, failover and disaster recovery are not production claims.",
  M, 521, CW, size=8.8, color=MUTED)
finish("Honest status", "Source: CHECKPOINT.md / docs/VERIFICATION.md")

# 3: Explicit responsibility diagram with manual bypass.
start(3, "System design / planning snapshot", "Keep authority where it can be enforced.",
      "AI proposes an interpretation. The user confirms it. Server code and PostgreSQL enforce posting.")
xs = [M, 195, 354, 513, 672]
box_w, y, box_h = 134, 179, 76
parts = [
    ("React interface", "Manual forms<br/>and assistant", WHITE),
    ("Interpret / clarify", "Current: OpenAI<br/>Proposed: Gemini", SAND),
    ("User review", "Accounts, amount,<br/>date and confirmation", WHITE),
    ("Server checks", "Validity, reviewed<br/>revision, retry identity", WHITE),
    ("PostgreSQL", "Atomic posting + job<br/>Exact balanced journal", PALE),
]
for i, (title, body, fill) in enumerate(parts):
    card(xs[i], y, box_w, box_h, title, body, fill, title_size=11.5)
    if i < 4:
        arrow(xs[i] + box_w + 3, y + 38, xs[i + 1] - 4, y + 38)
# Manual form bypasses model interpretation.
line(xs[0] + 67, y, xs[0] + 67, 156)
line(xs[0] + 67, 156, xs[2] + 67, 156)
arrow(xs[2] + 67, 156, xs[2] + 67, y - 3)
p("Manual entry bypasses the model", 167, 141, 245, size=8.8, color=GREEN)
card(M, 293, 233, 76, "Approved report functions",
     "SQL reads posted history; application returns values and evidence.", title_size=12)
line(M + 233, 327, xs[4] + 67, 327)
arrow(xs[4] + 67, 327, xs[4] + 67, 258)
p("Read-only query path", 382, 312, 180, size=9, color=MUTED)
card(300, 372, 280, 70, "Anomaly processing",
     "Stored jobs run after commit and create review alerts.", title_size=11.5)
line(xs[4] + 67, 331, xs[4] + 67, 402, dashed=True)
arrow(xs[4] + 67, 402, 584, 402, dashed=True)
card(M, 372, 233, 70, "Recurring scheduler",
     "An independent timer creates drafts for review.", title_size=11.5)
p("Background modules share the API process today.<br/>These boxes are not deployed microservices.",
  300, 341, 400, size=8.5, color=MUTED, max_height=26)
cards = [
    ("Protect the money", "Balance is checked at posting in base currency. Drafts can be incomplete. Corrections use reversals."),
    ("Protect the meaning", "A balanced invoice payment can still double-count revenue. Missing facts require clarification."),
    ("Protect the operation", "Retries must not double-post; stale reviews must fail. Job delivery is at least once."),
]
for i, (title, body) in enumerate(cards):
    card(M + i * (width + 14), 449, width, 80, title, body, title_size=11, body_size=9.5)
p("Production authorization additionally needs authenticated users and enforced organization membership.",
  M, 538, CW, size=8, color=MUTED)
finish("Responsibility boundaries")

# 4: Worked example.
start(4, "Walk through the behavior / illustrative examples",
      "Recording money and answering questions.",
      "A write changes the books. A read explains the books. Keep those paths easy to distinguish.")
half = (CW - 20) / 2
rect(M, 151, half, 371)
rect(M + half + 20, 151, half, 371)
tag("Write path / live AI pending", M + 15, 167)
p("“Paid $2,400 rent from checking<br/>on March 1.”", M + 15, 199, half - 30,
  size=20, font="Times-Roman", max_height=58)
p("<b>1  Interpret.</b> Identify accounts, amount and date; ask for missing context.<br/>"
  "<b>2  Validate.</b> Check the proposed values and accounting rules.<br/>"
  "<b>3  Review.</b> The user sees and confirms the exact entry.<br/>"
  "<b>4  Post.</b> Revalidate the revision; commit lines and analysis job together.<br/>"
  "<b>5  Explain.</b> Show the saved entry and its effect.",
  M + 15, 265, half - 30, size=10, leading=17, max_height=145)
rect(M + 15, 410, half - 30, 60, PALE, PALE)
p("<b>Rent expense</b> &nbsp; Debit $2,400.00<br/>"
  "<b>Checking</b> &nbsp;&nbsp;&nbsp;&nbsp; Credit $2,400.00",
  M + 25, 423, half - 50, size=11, leading=17, max_height=43)
p("USD example: expenses rise by $2,400; checking falls by $2,400. "
  "Posted history remains unchanged.", M + 15, 481, half - 30,
  size=9.5, color=MUTED, max_height=34)
rx = M + half + 35
tag("Read path / live AI pending", rx, 167)
p("“What were my top expenses<br/>last month?”", rx, 199, half - 30,
  size=20, font="Times-Roman", max_height=58)
p("<b>1  Resolve the period.</b> Establish the dates.<br/>"
  "<b>2  Choose an approved function.</b> Expense summary, not generated SQL.<br/>"
  "<b>3  Query the posted journal.</b> Apply organization, date and account filters.<br/>"
  "<b>4  Return facts and evidence.</b> Show dates, currency and supporting entries.",
  rx, 265, half - 30, size=10, leading=17, max_height=140)
callout("<b>Anomaly example:</b> previous rent is $2,400; a new payment is $4,800. "
        "A statistical rule can flag the change. Historical records suffice.",
        405, 70, x=rx, width=half - 30, size=10)
p("Current Daybook composes numeric answers in application code. Alerts are "
  "review hints, not proof of fraud.", rx, 486, half - 30,
  size=9.5, color=MUTED, max_height=33)
p("Good failure demo: omit a payment account or exchange rate and show a clarification.",
  M, 537, CW, size=9, color=MUTED)
finish("Follow one request")

# 5: Components by purpose.
start(5, "Architecture choices / every addition needs a job",
      "These tools solve different problems.",
      "Start with a complete baseline. Add a component when a requirement or repeatable failure explains it.")
tool_w = (CW - 36) / 4
tools = [
    ("PostgreSQL", "BUILT / KEEP", "Authoritative records, exact queries and constraints.", PALE),
    ("Gemini", "PROPOSED BASELINE", "Interpret sentences and choose approved tools. Needs adapter and live checks.", SAND),
    ("Mastra", "CONDITIONAL", "Coordinate models, tools, workflows and traces if our code needs it.", WHITE),
    ("Jev", "CONDITIONAL", "A narrow category decision or check; measure errors, cost and latency.", WHITE),
    ("pgvector", "EXPERIMENT", "Find similar history or corrections. SQL still calculates totals.", WHITE),
    ("Managed file search", "IF DOCUMENTS ADDED", "Index and retrieve uploaded material. Document ingestion is extra scope.", WHITE),
    ("Wren", "BROADER ANALYTICS", "Business definitions and query infrastructure beyond the four query families.", WHITE),
    ("n8n / load balancer", "DIFFERENT LAYERS", "n8n connects workflow steps. A load balancer spreads server requests.", WHITE),
]
for i, (title, status, body, fill) in enumerate(tools):
    x = M + (i % 4) * (tool_w + 12)
    top = 158 + (i // 4) * 130
    rect(x, top, tool_w, 116, fill)
    p(title, x + 12, top + 12, tool_w - 24, size=12, font="Helvetica-Bold")
    p(status, x + 12, top + 33, tool_w - 24, size=7.3, color=CLAY if i else GREEN)
    p(body, x + 12, top + 52, tool_w - 24, size=9.5, color=MUTED, max_height=58)
card(M, 424, half, 82, "Midday: targeted retrieval",
     "Embeddings select relevant tool descriptions. Current receipt matching uses names, "
     "dates, amounts and feedback.", PALE, title_size=12)
card(M + half + 20, 424, half, 82, "Actual: inspectable rules",
     "A confirmed payee-to-category rule can be repeatable. A Daybook rule editor "
     "would be new work; correction retrieval already exists.", SAND, title_size=12)
p("Gemini, Jev, pgvector, Mastra, Wren and managed document search are not integrated. "
  "No provider spend or purchase occurred during this research.", M, 525, CW,
  size=9.2, color=MUTED)
finish("Choose by responsibility")

# 6: A concept wireframe, visibly nonfunctional.
start(6, "Product design / concept sketch, not implemented",
      "Make the next action obvious.",
      "Use everyday tasks as the entrance. Reveal accounting detail when it helps review or understanding.")
rect(M, 155, CW, 254)
rect(M, 155, 130, 254, colors.HexColor("#eeeee4"))
p("<b>Daybook</b>", M + 15, 172, 100, size=13)
for i, title in enumerate(["Home", "Transactions", "Reports", "Settings"]):
    if i == 0:
        rect(M + 10, 205, 110, 27, colors.HexColor("#dce8db"), colors.HexColor("#dce8db"))
    p(title, M + 17, 211 + i * 33, 100, size=10.5,
      font="Helvetica-Bold" if i == 0 else "Helvetica")
p("Visible labels.<br/>Stable locations.", M + 17, 356, 103, size=9.2, color=MUTED)
mx = M + 153
p("Your books, at a glance.", mx, 174, 430, size=23, font="Times-Roman")
tag("2 need review", W - M - 115, 176, AMBER, colors.HexColor("#fff5db"))
p("Cash balance", mx, 215, 160, size=9, color=MUTED)
p("$22,600", mx, 231, 160, size=25, font="Times-Roman")
p("Period profit", mx + 200, 215, 160, size=9, color=MUTED)
p("$12,260", mx + 200, 231, 160, size=25, font="Times-Roman")
rect(mx, 270, CW - 177, 35, PAPER, GREEN)
p("+  Record money in or out…", mx + 12, 280, 450, size=11)
line(mx, 320, W - M - 22, 320, LINE)
p("<b>Rent payment</b><br/><font color='#596b62'>Checking · $2,400 · ready for review</font>",
  mx, 328, 350, size=10, leading=15)
tag("Review entry", W - M - 122, 334)
line(mx, 368, W - M - 22, 368, LINE)
p("Illustrative layout and amounts. This is a sketch, not a live app screen.",
  mx, 381, CW - 177, size=8.6, color=MUTED)
for i, (title, body) in enumerate([
    ("Record", "A short form or sentence; review the full lines before posting. Manual entry stays available."),
    ("Review", "Drafts and alerts lead to evidence. History and schedules stay accessible. Explain reversals clearly."),
    ("Understand", "Reports show period and currency. Ask about the books. Account management remains in Settings."),
]):
    x = M + i * (width + 14)
    p(title, x, 429, width, size=13, font="Helvetica-Bold")
    p(body, x, 451, width, size=10, color=MUTED, max_height=58)
callout("<b>Usability check:</b> a new user can record, confirm and find a payment, "
        "then explain its effect without learning the whole accounting vocabulary.", 516, 32, size=9.3)
finish("Proposed user experience")

# 7: Planning and a deliberately empty comparison.
start(7, "Delivery plan / 12 focused hours plus up to 4 reserve",
      "Finish the baseline. Then test one change.",
      "Estimates for one or two days. Docker access and live-provider failures can change the schedule.")
plan_w = 385
timeline = [
    ("0–0.5h", "Preserve the baseline", "Version control, fixture and provider-call limits."),
    ("0.5–3h", "Add Gemini adapter", "Proposal, clarification and query paths can run."),
    ("3–5h", "Live evaluation", "Check complete entries and evidence; record failures."),
    ("5–7h", "Simplify the UI", "Record, review, find and understand a payment."),
    ("7–9h", "Docker verification", "Healthy startup and persistence after restart."),
    ("9–10h", "Regression checks", "Accounting and affected browser workflows pass."),
    ("10–11h", "Phone + key fixes", "Check keyboard, forms and drawers on a device."),
    ("11–12h", "Rehearse and package", "Demo, evidence, README and fresh archive."),
]
for i, (hour, title, outcome) in enumerate(timeline):
    top = 156 + i * 37
    p(hour, M, top + 3, 70, size=13, font="Times-Roman")
    p(title, M + 77, top, plan_w - 77, size=10.3, font="Helvetica-Bold")
    p(outcome, M + 77, top + 15, plan_w - 77, size=8.7, color=MUTED)
    line(M, top + 32, M + plan_w - 12, top + 32, LINE, width=.5)
callout("<b>Hours 12–16:</b> finish core verification first. If it is complete, "
        "compare one retrieval change. Framework migration is not a prerequisite.",
        465, 62, x=M, width=plan_w - 12, fill=SAND, color=CLAY, size=10)
ex = M + plan_w + 16
ew = CW - plan_w - 16
tag("Proposed experiment / results pending", ex, 157, CLAY, SAND)
card(ex, 188, (ew - 15) / 2, 82, "A / baseline",
     "Gemini + current text retrieval.", title_size=12)
card(ex + (ew + 15) / 2, 188, (ew - 15) / 2, 82, "B / challenger",
     "Same setup; add semantic retrieval only.", title_size=12)
rect(ex, 283, ew, 47, PALE, PALE)
p("<b>Same cases, model, ledger, dates and checks.</b><br/>"
  "40 cases: 20 development + 20 held out.", ex + 12, 293, ew - 24,
  size=10, max_height=33)
p("Repeat held-out cases three times per candidate within explicit call/token "
  "limits. Keep the held-out set separate from tuning.", ex, 343, ew,
  size=9.7, color=MUTED)
for i, label in enumerate(["Exact task success", "Clarification and evidence", "Latency and cost"]):
    top = 390 + i * 25
    p(label, ex, top, ew - 104, size=9.4)
    p("Not run", ex + ew - 98, top, 98, size=9.4, color=CLAY)
    line(ex, top + 19, ex + ew, top + 19, LINE, width=.5)
p("<b>Acceptance requirement:</b> no unconfirmed postings, invalid accepted money "
  "or cross-organization evidence observed in the proposed suite. Small tests "
  "do not prove zero production risk.", ex, 474, ew,
  size=9.4, color=MUTED, max_height=62)
finish("Proposed finish and evaluation",
       "Cutline: correctness / live AI / usable UI / Docker / demo before optional infrastructure")

# 8: Scaling with source links.
start(8, "Growth and evidence / not a capacity claim",
      "Design a path to growth. Measure the need.",
      "A million registered users does not specify active usage, peak posting rates, report size or model cost.")
scale_cards = [
    ("Today / assignment", "One modular API process, PostgreSQL, exact accounting, bounded jobs and shared posting rules."),
    ("Before production", "Authentication, permissions, backups and restore drills, monitoring, rate limits and benchmarks."),
    ("When justified", "Separate workers, API replicas behind a load balancer, controlled connections and report summaries."),
]
for i, (title, body) in enumerate(scale_cards):
    card(M + i * (width + 14), 158, width, 102, title, body,
         PALE if i == 0 else WHITE, title_size=12)
p("<b>Accuracy has layers.</b> Database checks protect structure; tests and review "
  "protect meaning; source records support explanations.", M, 280, CW, size=11)
p("No live provider accuracy, million-user capacity, failover or physical-device "
  "success is claimed by this report.", M, 314, CW, size=10, color=MUTED)
p("Follow the evidence", M, 350, CW, size=15, font="Helvetica-Bold")
refs = [
    ("Project records", "CHECKPOINT.md, docs/ARCHITECTURE.md, docs/PLAN.md and docs/VERIFICATION.md in the submission."),
    ("Spiich", '<a href="https://spiich.ai/help/getting-started/what-is-spiich" color="#286648">Product description</a> and '
     '<a href="https://spiich.ai/careers/founding-ai-engineer" color="#286648">engineering role</a>. Hiring relevance is an inference.'),
    ("Midday", '<a href="https://midday.ai/updates/joining-ramp/" color="#286648">Ramp transition</a>; '
     '<a href="https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/api/src/chat/tools.ts" color="#286648">tool selection</a> and '
     '<a href="https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/queries/transaction-matching.ts" color="#286648">matching code</a>.'),
    ("Actual", '<a href="https://actualbudget.org/docs/budgeting/rules/" color="#286648">Rules</a>, '
     '<a href="https://actualbudget.org/docs/contributing/project-details/architecture/" color="#286648">local architecture</a> and '
     '<a href="https://actualbudget.org/docs/budgeting/multi-currency/" color="#286648">currency limitations</a>.'),
    ("Gemini", '<a href="https://ai.google.dev/gemini-api/docs/function-calling" color="#286648">Function calling</a> and '
     '<a href="https://ai.google.dev/gemini-api/docs/structured-output" color="#286648">structured-output limits</a>. Application validation remains necessary.'),
    ("Optional components", '<a href="https://mastra.ai/docs" color="#286648">Mastra</a>, '
     '<a href="https://docs.typesafe.ai/models" color="#286648">Jev</a>, '
     '<a href="https://github.com/pgvector/pgvector" color="#286648">pgvector</a> and '
     '<a href="https://github.com/Canner/WrenAI" color="#286648">Wren</a>. Candidates, not adopted dependencies.'),
]
for i, (title, body) in enumerate(refs):
    col = i // 3
    row = i % 3
    x = M + col * (half + 20)
    top = 380 + row * 43
    p(f"<b>{title}.</b> {body}", x, top, half, size=9.1, max_height=38)
p("Research checked 29 October 2026. Upstream products were not run or audited in full. "
  "This PDF is a native vector companion to the interactive HTML report.",
  M, 523, CW, size=8.5, color=MUTED)
finish("Growth, limits and sources")

C.save()
if PAGE != 8:
    raise AssertionError(f"Expected 8 pages, got {PAGE}")
print(f"Created {OUTPUT.relative_to(ROOT)}: 8 landscape A4 pages; "
      f"{len(CHECKS)} text/table bounds checks passed.")
