#!/usr/bin/env python3
"""Export the current reviewer architecture brief; no network or provider calls.
Run with the optional report environment: .tools/report-render/bin/python scripts/export-submission-architecture.py
This creates a new handoff document and never changes historical study reports.
"""
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Flowable

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/reports/submission-architecture.pdf'
INK = colors.HexColor('#20352e')
GREEN = colors.HexColor('#286648')
MUTED = colors.HexColor('#5b6963')
PALE = colors.HexColor('#edf3ef')
LINE = colors.HexColor('#d8e1db')
WIDTH = 528
styles = {
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=24, leading=28, textColor=INK, spaceAfter=12),
    'sub': ParagraphStyle('sub', fontName='Helvetica', fontSize=11, leading=15, textColor=MUTED, spaceAfter=12),
    'h': ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=13, leading=17, textColor=GREEN, spaceBefore=12, spaceAfter=6),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=14, textColor=INK, spaceAfter=8),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.5, leading=11.5, textColor=MUTED, spaceAfter=6),
    'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=9, leading=12, textColor=INK),
}
story = []
def p(text, kind='body'):
    story.append(Paragraph(text, styles[kind]))
def h(text):
    p(text, 'h')
def table(rows, widths):
    data = [[Paragraph(escape(str(v)), styles['cell']) for v in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND', (0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),0.4,LINE)]))
    story.append(t)

class Architecture(Flowable):
    def __init__(self):
        super().__init__()
        self.width = WIDTH
        self.height = 190
    def draw(self):
        c=self.canv
        def box(x,y,w,title,detail):
            c.setFillColor(PALE);c.setStrokeColor(LINE);c.roundRect(x,y,w,45,5,fill=1,stroke=1)
            c.setFillColor(INK);c.setFont('Helvetica-Bold',10);c.drawCentredString(x+w/2,y+27,title)
            c.setFillColor(MUTED);c.setFont('Helvetica',8.2);c.drawCentredString(x+w/2,y+12,detail)
        def arrow(x1,y1,x2,y2):
            c.setStrokeColor(GREEN);c.setLineWidth(1.2);c.line(x1,y1,x2,y2)
            if y1==y2:
                c.line(x2,y2,x2-4,y2+3);c.line(x2,y2,x2-4,y2-3)
            else:
                c.line(x2,y2,x2-3,y2+4);c.line(x2,y2,x2+3,y2+4)
        box(0,140,154,'React interface','Forms, Ask, reports, notebook')
        box(187,140,154,'Express REST API','Validation and orchestration')
        box(374,140,154,'PostgreSQL','Ledger and durable work')
        arrow(154,162,187,162);arrow(341,162,374,162)
        box(187,70,154,'Gemini analyst','Interpret question; propose SQL')
        box(374,70,154,'Read boundary','AST policy, views, reader role')
        arrow(264,140,264,115);arrow(341,92,374,92)
        box(187,0,341,'Recheck results, then publish a notebook','Saved exact tables and charts; no generated HTML execution')
        arrow(451,70,451,45)
        c.setFillColor(MUTED);c.setFont('Helvetica',8.5)
        c.drawString(0,100,'AI proposes.')
        c.drawString(0,86,'Code controls execution.')
        c.drawString(0,72,'PostgreSQL calculates.')
        c.drawString(0,58,'The user reviews writes.')

p('Daybook', 'title')
p('Reviewer architecture brief · November 4, 2026', 'sub')
p('A full-stack double-entry accounting application with a flexible Gemini analyst. <b>Review setup: Docker Compose plus your own Gemini key.</b> Querio and TypeSafe/Jev are optional comparison integrations, not prerequisites.')
story.append(Architecture())
h('Three general analyst tools we wrote')
table([['Tool','Responsibility'],['inspect_schema','Explain allowed views, columns, business date and accounting definitions.'],['query_sql','Parse and check generated read-only SQL, execute within scoped permissions, retain exact results.'],['publish_notebook','Recheck selected queries together; build tables/charts from saved columns and inspect final numeric support.']],[125,403])
h('The useful distinction')
p('The model can formulate a new calculation instead of selecting one prewritten metric. That flexibility does not grant ledger-write access. A permitted query can still misunderstand dates, an account or a denominator; inspectable evidence and semantic evaluation remain necessary.')
p('Product code: React/TypeScript + Express + PostgreSQL, explicit SQL via pg, Zod validation, decimal.js, pgsql-parser and the pinned AI SDK/Google adapter. No ORM. Backend modules are organized by capability rather than a uniform controller/service/repository hierarchy.','small')
story.append(PageBreak())

p('The accounting engine comes first', 'title')
p('One transaction has one header and multiple debit/credit lines. Reports read that same journal.', 'sub')
table([['Core rule','Implementation and example'],['Exact money','PostgreSQL NUMERIC and decimal strings/decimal.js. A $500 supplies/card purchase debits Supplies $500 and credits Card liability $500.'],['Balanced posting','A posted entry has 2-100 lines. Deferred PostgreSQL constraint triggers check equal base debits/credits at commit, even when the API is bypassed.'],['Preserved history','Drafts may change. Posted headers/lines cannot be edited by the runtime role. Corrections create exact linked reversals using the original rates.'],['Safe review and retries','Revision checks reject stale approval. Idempotency keys prevent duplicate logical creates. Row locks coordinate concurrent edits/posting.'],['Currency and reports','USD base; saved per-line FX and native balances. Reports use posted entries, net reversals/refunds and consistent read snapshots. No automatic spot-rate revaluation.']],[116,412])
h('Background work and AI suggestions')
p('<b>Recurrence:</b> calendar-anchored weekly/monthly/yearly templates generate drafts. Occurrence uniqueness and transactional date advancement prevent duplicates. <b>Anomalies:</b> posting commits a durable analysis job; leased workers apply duplicate, amount and category rules. The amount rule needs four comparable positive samples and compares against a median. The rent amounts are seeded examples, not detector constants.')
p('<b>Categorization:</b> fixed amount/payment facts plus an allowed category become a proposal. Only a reviewed, posted account correction becomes a reusable teaching example. Reversed, superseded or forgotten examples lose eligibility. This is retrieval of examples, not model retraining. Gemini is the measured default; Jev remains optional.')
h('Where data is stored')
p('Docker uses the named PostgreSQL volume spiich_postgres_data. Node development can use .tools/postgres. The hosted app uses Neon; these databases do not auto-sync. The latest hosted catalog had 15 application tables plus two historical research tables, eight analyst views plus two research views. The native analyst cannot read the research or operational tables.')
p('Key files: db/migrations/001_ledger.sql; server/ledger.ts; server/reports.ts; server/recurring.ts; server/anomalies.ts; server/categorization-memory.ts. Migration009 defines the organization-scoped analytics views and restricted analyst role.','small')
story.append(PageBreak())

p('Run, inspect, and assess', 'title')
p('Full instructions: docs/SUBMISSION_GUIDE.md. Original brief: docs/ORIGINAL_ASSIGNMENT.md.', 'sub')
table([['Step','Action'],['1. Configure','Copy .env.example to .env. Set your GEMINI_API_KEY; keep AI_PROVIDER=gemini, CATEGORY_PROVIDER=gemini and NATIVE_ANALYST_ENABLED=true.'],['2. Start','Run docker compose up --build, then open http://localhost:3001. Database startup, migrations and demo seed are automatic.'],['3. Inspect','Open Ask > Daybook. Ask for monthly rent as a percentage of expenses. Inspect the notebook table, chart, period and query.'],['4. Stop','docker compose down preserves the data volume. Recreate the app after changing .env. Do not delete the volume if retaining entries.']],[116,412])
h('Model and execution scope')
p('The native analyst is pinned to gemini-3.8-flash; whole-entry/category defaults use gemini-3.5-flash-lite. Your API project needs model access and quota. Model names are saved application configuration, not a promise of access for every key. Manual accounting requires no AI key. The native SQL path has a 3.5-second statement timeout, 12-second batch deadline, 200-row/40-column return limits and honest truncation.')
h('What verification establishes')
p('The prior released source passed 3,366 normal tests and 60 browser workflows, with real PostgreSQL and Compose/persistence checks; overlapping counts are not added. Those engineering checks do not make paid model calls. Three hosted model turns passed separate Decimal-based review. A full development cohort scored 7/8 matched turns versus Querio 6/8; later targeted tests and hosted checks are separate versions, not a new pooled accuracy score.')
h('Limits worth keeping visible')
p('Read-only SQL protects write access, not arbitrary interpretation. Final-number support does not prove account/date/currency meaning. Native responses observed in the hosted checks took 94-321 seconds. The product has no bank reconciliation, document-upload workflow, application-user authentication, full FX revaluation or proved million-user capacity. RAG/File Search/pgvector/Wren/reviewer studies remain isolated historical experiments.')
p('<b>Public demo:</b> https://daybook-ledger-delta.vercel.app/analyst?tab=daybook. Production access is public by owner request; generated/preview URLs remain protected. This is a shared fictional workspace with write/AI actions. Use Docker for isolated review with your own key. Hosted backend source remains 60435f2 within UI release10778; the submission default-tab edit is separate.','small')
p('Further reading: analyst-workspace-comparison.pdf; category-learning-explained.pdf; docs/MEETING_NOTES_KNOWLEDGE_BASE.md. Source-bound receipts preserve original failures. This brief is an engineering explanation, not an independent accounting certification.','small')

def footer(c, doc):
    c.saveState();c.setStrokeColor(LINE);c.line(42,35,570,35);c.setFont('Helvetica',8);c.setFillColor(MUTED)
    c.drawString(42,22,'DAYBOOK  /  SPIICH REVIEWER HANDOFF  /  2026-11-04')
    c.drawRightString(570,22,f'{doc.page}');c.restoreState()

SimpleDocTemplate(str(OUTPUT),pagesize=letter,rightMargin=42,leftMargin=42,topMargin=36,bottomMargin=48,title='Daybook — reviewer architecture',author='Rayid Ali').build(story,onFirstPage=footer,onLaterPages=footer)
print(OUTPUT.relative_to(ROOT))
