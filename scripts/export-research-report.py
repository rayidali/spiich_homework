#!/usr/bin/env python3
"""Export measured study artifacts without executing models or changing frozen source.

Run with .tools/report-render/bin/python (ReportLab 5.1.0). Explicit input paths
prevent silently mixing experimental runs. Verifier split must be declared,
because its original result schema does not contain that field.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.graphics.shapes import Circle, Drawing, Line, Rect, String
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak,
)

PAGE_W, PAGE_H = A4
MARGIN = 44
WIDTH = PAGE_W - 2 * MARGIN
INK = colors.HexColor('#182e3b')
BLUE = colors.HexColor('#286a83')
GOLD = colors.HexColor('#bd842a')
RED = colors.HexColor('#a34b43')
PALE = colors.HexColor('#edf2f3')
GRAY = colors.HexColor('#627580')
GRID = colors.HexColor('#d5dde1')
ROUTES = [f'R{i}' for i in range(9)]
FAMILIES = ['financial', 'analytics', 'documents', 'scenario', 'entry', 'adversarial']
VERSION = 'daybook-pdf-report-v2'


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def percent(value, places=1):
    return f'{100 * value:.{places}f}%' if number(value) else 'N/A'


def decimal(value, places=2):
    return f'{value:.{places}f}' if number(value) else 'N/A'


def usd(value):
    return f'${value:.4f}' if number(value) else 'N/A'


def seconds(value):
    return f'{value / 1000:.2f}s' if number(value) else 'N/A'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_input(path, role):
    path = Path(path)
    content = path.read_bytes()
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError(f'{role} must contain a JSON object')
    return value, {'role': role, 'filename': path.name, 'sha256': sha(content)}


def read_analysis(path, role, main_hash, verifier_hash=None):
    """Require the analyzer's explicit binding to the exact primary snapshot."""
    value, metadata = read_input(path, role)
    provenance, provenance_metadata = read_input(Path(path).with_name('analysis-provenance.json'), role + ' provenance')
    if provenance.get('primaryReportSha256') != main_hash or provenance.get('runId') != value.get('runId'):
        raise ValueError(f'{role} primary snapshot binding differs')
    if verifier_hash is not None and value.get('reviewers', {}).get('available'):
        if provenance.get('verifierResultsSha256') != verifier_hash:
            raise ValueError(f'{role} verifier snapshot binding differs')
    return value, [metadata, provenance_metadata]


def validate_secondary(main, common=None, sensitivity=None, decisions=None):
    for role, value in [('Common-capability', common), ('Weight-sensitivity', sensitivity), ('Decision', decisions)]:
        if value is None:
            continue
        if value.get('runId') != main.get('runId') or value.get('split') != main.get('split'):
            raise ValueError(f'{role} snapshot differs')
        if role != 'Decision' and sorted(row.get('route') for row in value.get('routes', [])) != ROUTES:
            raise ValueError(f'{role} route set differs')
    if decisions is not None:
        if not isinstance(decisions.get('eligibility'), dict) or not isinstance(decisions.get('components'), list):
            raise ValueError('Decision eligibility and components are required')
        for row in decisions['components']:
            if row.get('route') not in ROUTES or row.get('control') not in ROUTES:
                raise ValueError('Unknown decision route')
            for key in ['targetedEffect', 'overallEffect', 'entryEffect', 'adversarialEffect']:
                effect = row.get(key)
                if effect is not None:
                    for measure in ['estimate', 'low', 'high']:
                        v = effect.get(measure)
                        if v is not None and (not number(v) or not -1 <= v <= 1):
                            raise ValueError('Invalid decision effect')
    if sensitivity is not None:
        weights = sensitivity.get('weights', [])
        if len(weights) != 5 or len({w.get('id') for w in weights}) != 5:
            raise ValueError('Weight-sensitivity requires five distinct prespecified columns')
        for weight in weights:
            values = [weight.get(key) for key in ['factual', 'completion', 'grounding', 'uncertainty']]
            if any(not number(v) or v < 0 for v in values) or sum(values) != 90:
                raise ValueError('Weight-sensitivity weights must total 90')
        for row in sensitivity['routes']:
            columns = row.get('columns', [])
            if sorted(c.get('id') for c in columns) != sorted(w['id'] for w in weights):
                raise ValueError('Weight-sensitivity columns differ from specification')
            for column in columns:
                v = column.get('familyMacro90')
                if v is not None and (not number(v) or not 0 <= v <= 90):
                    raise ValueError('Invalid secondary score')


def validate_inputs(main, verifier, verifier_split, supplement=None):
    if main.get('split') not in ['development', 'holdout']:
        raise ValueError('Main report must declare development or holdout')
    if verifier_split not in ['development', 'holdout']:
        raise ValueError('Verifier split must be explicit')
    if verifier.get('split') not in [None, verifier_split]:
        raise ValueError('Verifier split does not match requested label')
    routes = main.get('routes', [])
    if sorted(route.get('route') for route in routes) != ROUTES:
        raise ValueError('Main report must contain exactly the nine declared routes')
    for route in routes:
        if not isinstance(route.get('episodes'), int) or route['episodes'] < 0:
            raise ValueError('Invalid observed episode count')
        if route.get('plannedEpisodes', -1) < route['episodes']:
            raise ValueError('Observed episodes exceed the declared plan')
        for name in ['microSuccessRate', 'macroSuccessRate', 'observedFamilyMacro', 'errorRate']:
            value = route.get(name)
            if value is not None and (not number(value) or not 0 <= value <= 1):
                raise ValueError(f'Invalid rate: {name}')
    if main.get('complete') and any(row['episodes'] != row['plannedEpisodes'] for row in routes):
        raise ValueError('Complete label contradicts recorded episode denominators')
    if not isinstance(verifier.get('methods'), list):
        raise ValueError('Verifier methods are missing')
    if supplement is not None:
        if (supplement.get('runId') != main.get('runId') or supplement.get('split') != main['split']
                or supplement.get('measuredEpisodes') != sum(row['episodes'] for row in routes)):
            raise ValueError('Supplement snapshot differs from main report; regenerate it or omit it')
        if any('completeEpisodes' not in timing.get('providerHttpSum', {})
               for row in supplement.get('routes', []) for timing in row.get('latency', {}).values()):
            raise ValueError('Legacy HTTP timing coverage is unverified; regenerate the supplement with per-call usage')


def report_status(main):
    completeness = 'COMPLETE' if main.get('complete') else 'INCOMPLETE'
    return f'{main["split"].upper()} | {completeness}'


def validate_validity_notice(notice, main, original_hash=None):
    if notice is None:
        return
    if not isinstance(notice, dict) or notice.get('runId') != main.get('runId'):
        raise ValueError('Validity notice belongs to a different run')
    if not isinstance(notice.get('eligibleForSelection'), bool) or not isinstance(notice.get('issues'), list):
        raise ValueError('Invalid study validity notice')
    if original_hash and notice.get('originalResultsSha256') != original_hash:
        raise ValueError('Validity notice does not match the original results hash')
    if any(not isinstance(item, dict) or not isinstance(item.get('detail'), str) for item in notice['issues']):
        raise ValueError('Invalid validity issue detail')


def find_validity_notice(main_path, explicit_path=None):
    candidate = Path(explicit_path) if explicit_path else Path(main_path).parent / 'validity-notice.json'
    if explicit_path or candidate.exists():
        notice, provenance = read_input(candidate, 'validity notice')
        return notice, provenance, str(candidate)
    return None, None, None


def label(drawing, x, y, text, size=8, fill=INK, anchor='start', bold=False):
    drawing.add(String(x, y, str(text), fontName='Helvetica-Bold' if bold else 'Helvetica',
                       fontSize=size, fillColor=fill, textAnchor=anchor))


def title(drawing, text):
    label(drawing, 0, drawing.height - 14, text, 11, bold=True)


def rate_grid(drawing, x, y0, y1, width):
    for i in range(5):
        position = x + width * i / 4
        drawing.add(Line(position, y0, position, y1, strokeColor=GRID, strokeWidth=.5))
        label(drawing, position, y0 - 13, f'{i * 25}%', 7, GRAY, 'middle')


def success_chart(routes):
    d = Drawing(WIDTH, 295)
    title(d, 'Figure 1. All-family task success and recorded 95% interval')
    x, width = 70, WIDTH - 145
    rate_grid(d, x, 25, 263, width)
    for index, row in enumerate(routes):
        y = 250 - index * 26
        label(d, 0, y - 3, row['route'], 9, bold=True)
        value = row.get('macroSuccessRate')
        if number(value):
            d.add(Rect(x, y - 5, width * value, 10, fillColor=BLUE, strokeColor=None))
            interval = row.get('confidence') or {}
            low, high = interval.get('low'), interval.get('high')
            if number(low) and number(high):
                d.add(Line(x + width * low, y, x + width * high, y, strokeColor=INK, strokeWidth=1))
                for bound in [low, high]:
                    d.add(Line(x + width * bound, y - 5, x + width * bound, y + 5, strokeColor=INK))
            annotation = percent(value) + ('' if number(low) else ' / no CI')
        else:
            annotation = 'N/A'
        label(d, WIDTH - 1, y - 3, annotation, 7.5, anchor='end')
    return d


def family_heatmap(routes):
    d = Drawing(WIDTH, 272)
    title(d, 'Figure 2. Structured task success within each task family')
    x, cell_w, cell_h = 61, (WIDTH - 62) / 6, 23
    for j, family in enumerate(FAMILIES):
        label(d, x + cell_w * (j + .5), 235, family, 7, anchor='middle')
    for i, row in enumerate(routes):
        y = 209 - i * cell_h
        label(d, 0, y + 8, row['route'], 9, bold=True)
        by_family = {item['family']: item for item in row.get('families', [])}
        for j, family in enumerate(FAMILIES):
            item = by_family.get(family, {})
            value = item.get('rate')
            fill = PALE if not number(value) else colors.Color(.94 - .73 * value, .96 - .49 * value, .97 - .39 * value)
            d.add(Rect(x + j * cell_w, y, cell_w - 2, cell_h - 2, fillColor=fill, strokeColor=None))
            text_color = colors.white if number(value) and value > .7 else INK
            label(d, x + (j + .5) * cell_w - 1, y + 11, percent(value, 0), 8, text_color, 'middle')
            label(d, x + (j + .5) * cell_w - 1, y + 3, f'n={item.get("episodes", 0)}', 6.2, text_color, 'middle')
    return d


def cost_scatter(routes):
    d = Drawing(WIDTH, 284)
    title(d, 'Figure 3. Cost per recorded episode versus task success')
    x0, y0, w, h = 58, 43, WIDTH - 84, 196
    values = [r.get('cost', {}).get('budgetUsdPerEpisode') for r in routes]
    maximum = max([v for v in values if number(v)] + [.001]) * 1.18
    for i in range(5):
        x, y = x0 + w * i / 4, y0 + h * i / 4
        d.add(Line(x, y0, x, y0 + h, strokeColor=GRID, strokeWidth=.5))
        d.add(Line(x0, y, x0 + w, y, strokeColor=GRID, strokeWidth=.5))
        label(d, x, y0 - 13, usd(maximum * i / 4), 7, GRAY, 'middle')
        label(d, x0 - 7, y - 2, f'{i * 25}%', 7, GRAY, 'end')
    points = []
    for row in routes:
        cost, quality = row.get('cost', {}).get('budgetUsdPerEpisode'), row.get('microSuccessRate')
        if not number(cost) or not number(quality):
            continue
        x, y = x0 + w * cost / maximum, y0 + h * quality
        d.add(Circle(x, y, 3.2, fillColor=BLUE if not row.get('disqualified') else RED, strokeColor=colors.white))
        points.append((row['route'], x, y))
    for route, x, y, lx, ly in scatter_labels(points, (x0, y0, x0 + w, y0 + h)):
        if abs(lx - x) + abs(ly - y) > 18:
            d.add(Line(x, y, lx + 5, ly - 1, strokeColor=GRAY, strokeWidth=.35))
        label(d, lx, ly, route, 7)
    label(d, x0 + w / 2, 8, 'USD / episode: reported usage estimate + unknown-usage reservations', 7, GRAY, 'middle')
    label(d, x0, 250, 'Y: observed micro success, including failed attempts', 7.5, GRAY)
    return d


def scatter_labels(points, bounds):
    """Separate clustered route labels without shifting their measured points."""
    occupied, output = [], []
    left, bottom, right, top = bounds
    for name, x, y in points:
        placed = None
        for distance in [7, 19, 31, 43, 55, 67]:
            for dx, dy in [(6, distance), (-20, distance), (6, -distance), (-20, -distance), (distance, 7), (-distance - 14, 7)]:
                lx, ly = x + dx, y + dy
                box = (lx - 2, ly - 2, lx + 15, ly + 8)
                if box[0] < left or box[1] < bottom or box[2] > right or box[3] > top:
                    continue
                if any(box[0] < b[2] and box[2] > b[0] and box[1] < b[3] and box[3] > b[1] for b in occupied):
                    continue
                if any(box[0] - 3 < px < box[2] + 3 and box[1] - 3 < py < box[3] + 3 for _, px, py in points):
                    continue
                placed = (lx, ly, box)
                break
            if placed:
                break
        if placed is None:
            raise ValueError('Unable to place scientific plot labels without overlap')
        lx, ly, box = placed
        occupied.append(box)
        output.append((name, x, y, lx, ly))
    return output


def latency_chart(routes):
    d = Drawing(WIDTH, 284)
    title(d, 'Figure 4. Harness wall latency: median and 95th percentile')
    x, width = 70, WIDTH - 145
    maximum = max([row.get('p95Ms') or 0 for row in routes] + [1000]) / 1000 * 1.05
    for i in range(5):
        position = x + width * i / 4
        d.add(Line(position, 27, position, 245, strokeColor=GRID, strokeWidth=.5))
        label(d, position, 14, f'{maximum * i / 4:.1f}s', 7, GRAY, 'middle')
    for i, row in enumerate(routes):
        y = 230 - i * 24
        label(d, 0, y - 1, row['route'], 9, bold=True)
        for field, offset, color in [('p50Ms', 2, BLUE), ('p95Ms', -6, GOLD)]:
            value = row.get(field)
            if number(value):
                d.add(Rect(x, y + offset, width * value / 1000 / maximum, 6, fillColor=color, strokeColor=None))
        label(d, WIDTH - 1, y, seconds(row.get('p50Ms')) + ' / ' + seconds(row.get('p95Ms')), 7, anchor='end')
    label(d, 70, 253, 'Blue: p50    Gold: p95    Pacing / local dispatch included', 7.5, GRAY)
    return d


def reviewer_chart(verifier):
    d = Drawing(WIDTH, 265)
    title(d, 'Figure 5. Conditional reviewer errors on completed decisions')
    x, width = 112, WIDTH - 180
    rate_grid(d, x, 35, 224, width)
    for i, row in enumerate(verifier.get('methods', [])):
        y = 202 - i * 59
        label(d, 0, y - 2, row['method'], 9, bold=True)
        scores = row.get('conditionalSemantic', {})
        for key, offset, color in [('falseAcceptanceRate', 1, RED), ('falseRejectionRate', -15, BLUE)]:
            value = scores.get(key)
            if number(value):
                d.add(Rect(x, y + offset, width * value, 11, fillColor=color, strokeColor=None))
            label(d, WIDTH - 1, y + offset + 1, percent(value), 8, anchor='end')
    label(d, x, 11, 'Red: flawed answer accepted    Blue: correct answer rejected', 7.5, GRAY)
    return d


def effect_text(effect):
    if not effect or not number(effect.get('estimate')):
        return 'N/A'
    point = f'{100 * effect["estimate"]:+.1f} pp'
    if not number(effect.get('low')) or not number(effect.get('high')):
        return point + '; interval N/A'
    return point + f' [{100 * effect["low"]:+.1f}, {100 * effect["high"]:+.1f}]'


def targeted_chart(decisions):
    rows = decisions.get('components', [])
    height = max(210, 76 + len(rows) * 30)
    d = Drawing(WIDTH, height)
    title(d, 'Targeted component effects: paired structured success')
    left, width = 110, WIDTH - 160
    def x(v):
        return left + (v + 1) * width / 2
    for value in [-1, -.5, 0, .5, 1]:
        d.add(Line(x(value), 35, x(value), height - 45, strokeColor=GRID, strokeWidth=.5))
        label(d, x(value), 22, f'{100 * value:.0f} pp', 7, GRAY, anchor='middle')
    d.add(Line(x(.05), 35, x(.05), height - 45, strokeColor=GOLD, strokeWidth=1))
    for i, row in enumerate(rows):
        y = height - 58 - i * 30
        label(d, 0, y - 2, f'{row["hypothesis"]}: {row["route"]} - {row["control"]}', 8, bold=True)
        effect = row.get('targetedEffect') or {}
        if number(effect.get('estimate')):
            if number(effect.get('low')) and number(effect.get('high')):
                d.add(Line(x(effect['low']), y, x(effect['high']), y, strokeColor=BLUE, strokeWidth=1.3))
            else:
                label(d, WIDTH - 1, y - 2, 'CI N/A', 7, GRAY, anchor='end')
            d.add(Circle(x(effect['estimate']), y, 3, fillColor=BLUE, strokeColor=None))
        else:
            label(d, x(0), y - 2, 'N/A', 8, GRAY)
    label(d, left, 8, 'Gold: +5 pp practical target. Intervals: unadjusted 95%.', 7, GRAY)
    return d


def build_pdf(main, verifier, verifier_split, output, inputs, supplement=None, command=None, validity_notice=None,
              common=None, sensitivity=None, decisions=None):
    validate_inputs(main, verifier, verifier_split, supplement)
    validate_secondary(main, common, sensitivity, decisions)
    main_hash = next((item['sha256'] for item in inputs if item.get('role') == 'main results'), None)
    validate_validity_notice(validity_notice, main, main_hash)
    known_defects = validity_notice is not None and validity_notice.get('eligibleForSelection') is False
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    routes = sorted(main['routes'], key=lambda row: row['route'])
    observed = sum(row['episodes'] for row in routes)
    planned = sum(row['plannedEpisodes'] for row in routes)
    status = report_status(main)
    bundle_hash = sha(json.dumps(inputs, sort_keys=True).encode())
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle('CoverTitle', fontName='Helvetica-Bold', fontSize=29, leading=34, textColor=INK, spaceAfter=20))
    styles.add(ParagraphStyle('StudyBody', fontName='Helvetica', fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=9))
    styles.add(ParagraphStyle('StudySmall', parent=styles['StudyBody'], fontSize=8, leading=11, spaceAfter=7))
    styles.add(ParagraphStyle('StudyCaption', parent=styles['StudySmall'], textColor=GRAY, spaceAfter=12))
    styles.add(ParagraphStyle('StudyCell', parent=styles['StudySmall'], fontSize=7.4, leading=9.5, spaceAfter=0))
    styles.add(ParagraphStyle('StudyHeading', fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=INK, spaceBefore=10, spaceAfter=12))

    def p(text, style='StudyBody'):
        return Paragraph(escape(str(text)), styles[style])

    def heading(text):
        return p(text, 'StudyHeading')

    def table(headers, rows, widths):
        values = [[p(cell, 'StudyCell') for cell in headers]] + [[p(cell, 'StudyCell') for cell in row] for row in rows]
        t = Table(values, colWidths=widths, repeatRows=1, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), PALE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LINEBELOW', (0, 0), (-1, 0), .7, GRAY),
            ('LINEBELOW', (0, 1), (-1, -1), .35, GRID),
            ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        return t

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(GRAY)
        canvas.setFont('Helvetica', 8)
        canvas.drawString(MARGIN, PAGE_H - 27, 'DAYBOOK / AI SYSTEMS STUDY')
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 27, status)
        canvas.setStrokeColor(GRID)
        canvas.line(MARGIN, PAGE_H - 34, PAGE_W - MARGIN, PAGE_H - 34)
        if known_defects:
            canvas.setFillColor(RED)
            canvas.setFont('Helvetica-Bold', 7)
            canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 44, 'KNOWN STUDY DEFECTS / NOT FOR SELECTION')
            canvas.setFillColor(GRAY)
            canvas.setFont('Helvetica', 8)
        canvas.drawString(MARGIN, 24, f'Input bundle SHA-256: {bundle_hash[:16]} | {VERSION}')
        canvas.drawRightString(PAGE_W - MARGIN, 24, f'Page {doc.page}')
        canvas.restoreState()

    story = [Spacer(1, 22), p('AI-assisted accounting:\ncontrolled architecture comparison', 'CoverTitle'),
             p(status, 'StudyHeading'),
             p(f'Run: {main.get("runId", "unspecified")} | Dataset: {main.get("datasetVersion", "unspecified")}'),
             p(f'Measured snapshot generated {main.get("generatedAt", "not recorded")}. The PDF summarizes saved results only; exporting does not run models.'),
             table(['Scope', 'Measured state'], [
                 ['Main episodes', f'{observed} recorded / {planned} planned; {planned - observed} missing'],
                 ['Main split', main['split']],
                 ['Repeats per question', main.get('expectedRepeats', 'Not recorded')],
                 ['Verifier snapshot', f'{verifier_split}; {"complete" if verifier.get("complete") else "incomplete"}; {verifier.get("cases", 0)} planned candidates per method'],
                 ['Snapshot integrity', main.get('snapshotIntegrity', {}).get('status', 'unverified')],
                 ['Human readability score', 'Not evaluated. No total score out of 100 is computed.'],
             ], [150, WIDTH - 150]), Spacer(1, 18),
             heading('How to read this report'),
             p('This compares nine configurations of one accounting assistant. The ledger remains the source of financial numbers; retrieval supplies documentary context. Optional reviewers inspect candidates but do not replace deterministic accounting checks.'),
             p('Structured task success requires the declared behavior, facts, scope, evidence and assumptions. It is a machine-checkable proxy, not proof that every sentence is accurate. The automated rubric has a maximum of 90; the remaining 10 points require human clarity review.'),
             p('No winning architecture is selected here. Incomplete or development-only observations cannot establish a held-out improvement. Missing measurements remain N/A, and failed attempts remain in end-to-end denominators.'),
             PageBreak()]

    if known_defects:
        # Numerical results remain untouched. Completion is coverage, not validity.
        story[3:3] = [p('KNOWN STUDY DEFECTS / NOT FOR SELECTION', 'StudyHeading'),
                      p('The original scores below are preserved for diagnosis. Complete data coverage does not make this run suitable for architecture selection. See the validity notice on the next page.')]
        story += [heading('Known study defects - original results retained'),
                  p(validity_notice.get('classification', 'Known study defects')),
                  p(f'Notice recorded: {validity_notice.get("recordedAt", "not recorded")}', 'StudySmall')]
        for issue in validity_notice['issues']:
            story += [heading(issue.get('code', 'Study issue').replace('_', ' ')), p(issue['detail'])]
        story += [p(validity_notice.get('interpretation', 'This run is not eligible for architecture selection.')),
                  p(f'Original results SHA-256: {validity_notice.get("originalResultsSha256", "not recorded")}', 'StudySmall'),
                  p('This exporter neither repairs prior answers nor rescales prior scores. A later development version must be reported separately. No improvement claim may be attributed to a defective comparison simply because its dataset remained unchanged.'), PageBreak()]

    descriptions = [
        ['R0', 'Fixed financial tools', 'No document retrieval', 'Code checks'],
        ['R1', 'Broader analytical tools', 'No document retrieval', 'Code checks'],
        ['R2', 'Same broader tools', 'Lexical documents', 'Code checks'],
        ['R3', 'Same broader tools', 'Managed citation selection', 'Code checks'],
        ['R4', 'Same broader tools', 'Embeddings + pgvector + lexical', 'Code checks'],
        ['R5', 'Same broader tools', 'R4 + Jev reranking', 'Code checks'],
        ['R6', 'Wren semantic SQL engine', 'Same custom hybrid', 'Code checks'],
        ['R7', 'Same broader tools', 'Same custom hybrid', 'Code + LLM critic'],
        ['R8', 'Same broader tools', 'Same custom hybrid', 'Code + Jev verifier'],
    ]
    story += [heading('Methods and experimental controls'), table(['Route', 'Query capability', 'Evidence retrieval', 'Answer review'], descriptions, [36, 145, 196, WIDTH - 377]), Spacer(1, 12),
              p('The shared synthetic ledger, document corpus, question groups and scoring reference are frozen. Candidate providers receive permitted questions and evidence, not hidden gold answers. Sources and queries are restricted to the authorized workspace; journal proposals are never automatically posted.'),
              p('The study uses a common generator across routes; R0 reproduces the current tool architecture under that study model. R7 uses a separate critic context with the same model weights. Separate calls do not make generator and reviewer errors statistically independent.'),
              p('R3 incurs an additional managed generation/search request. Its citations select authorized original documents; generated summaries are discarded. Opaque internal chunks and rankings prevent a clean algorithm-only retrieval comparison. R6 measures the restricted Wren engine integration, not the complete Wren product.'),
              p('Failed requests are retained. Provider calls have bounded execution deadlines and no automatic retry. Pacing and local queue dispatch contribute to harness wall latency. Costs are paid-equivalent usage estimates plus reservations for unknown usage, not invoices or evidence that a free-tier request was charged.'),
              p('Per-family outcomes and scenario-group bootstrap intervals preserve paraphrase/repeat clusters. Intervals are omitted when too few independent groups are available. Conditional reviewer metrics exclude provider failures; operational metrics block on failures and show that distinction.'),
              PageBreak(), heading('Nine-route measured comparison'),
              p(f'This {main["split"]} snapshot contains {observed}/{planned} planned episodes. Rows remain in predeclared route order. Provider errors and blocked answers remain in task-success denominators; missing episodes are disclosed rather than replaced.'),
              p('The all-family macro score gives equal weight to each of the six task families and stays N/A until every family has observations. The separate observed micro rate is useful for inspecting a partial run, but may change as later families are evaluated.')]
    summary_rows = [[r['route'], f'{r["episodes"]}/{r["plannedEpisodes"]}', percent(r.get('microSuccessRate')),
                     percent(r.get('macroSuccessRate')), percent(r.get('errorRate')), decimal(r.get('automatedScore90')),
                     usd(r.get('cost', {}).get('budgetUsdPerEpisode'))] for r in routes]
    story += [table(['Route', 'n / planned', 'Micro success', 'All-family macro', 'Errors', 'Score / 90', 'Cost / episode'], summary_rows, [36, 64, 71, 87, 54, 60, WIDTH - 372]),
              p('Micro success uses all recorded episodes. All-family macro is N/A until every task family is represented. Recorded-error rate includes transport/provider failures, not every blocked answer.', 'StudyCaption'), PageBreak()]

    story += [heading('Task success across families'), success_chart(routes),
              p('Bars require all-family coverage. Whiskers reproduce the saved 95% scenario-group bootstrap interval; no interval is manufactured for a sparse pilot. N/A does not mean zero.', 'StudyCaption'),
              family_heatmap(routes), p('Each cell shows measured success and its episode denominator. Missing cells are N/A. Families have equal weight in the all-family macro score, despite possible unequal recorded counts during a partial run.', 'StudyCaption'), PageBreak(),
              heading('Cost and latency tradeoffs'), cost_scatter(routes),
              p('The scatter uses observed micro success so partial data remain visible. It is descriptive, not a Pareto winner selection. Red marks indicate a recorded hard-gate disqualification. Missing cost or outcome values are omitted.', 'StudyCaption'),
              latency_chart(routes), p('Wall time includes provider calls, retrieval, validation, rate pacing and local dispatch delays. It does not establish production serving latency or million-user capacity.', 'StudyCaption'), PageBreak()]

    if supplement and any(row.get('latency') for row in supplement.get('routes', [])):
        story += [heading('Latency denominators and provider service time'),
                  p('Complete HTTP totals require measured service durations for every recorded provider attempt in an episode. Partial known subtotals are shown separately. Pacing and queue waits remain in wall time. These measurements are neither single-model latency nor production request latency. Non-error outcomes include blocks.')]
        timing_rows = []
        for route in supplement.get('routes', []):
            for key, scope in [('allAttempts', 'All'), ('nonError', 'Non-error')]:
                item = route.get('latency', {}).get(key, {})
                wall = item.get('wall', {})
                service = item.get('providerHttpSum', {})
                partial = item.get('providerPartialHttpSum', {})
                timing_rows.append([route['route'], scope, str(item.get('episodes', 0)),
                                    seconds(wall.get('p50Ms')) + ' / ' + seconds(wall.get('p95Ms')),
                                    seconds(service.get('p50Ms')) + ' / ' + seconds(service.get('p95Ms')),
                                    f'{service.get("completeEpisodes", 0)}/{service.get("partialEpisodes", 0)}/{service.get("unknownEpisodes", 0) + service.get("unverifiedEpisodes", 0)}/{service.get("noCallEpisodes", 0)}',
                                    seconds(partial.get('p50Ms')) + ' / ' + seconds(partial.get('p95Ms'))])
        story += [table(['Route', 'Scope', 'n', 'Wall p50 / p95', 'Complete HTTP p50 / p95', 'HTTP C/P/U/N', 'Partial subtotal p50 / p95'],
                        timing_rows, [32, 48, 25, 98, 108, 80, WIDTH - 391]),
                  p('C/P/U/N = complete / partial / unknown-or-unverified / no recorded calls. Complete-total percentiles exclude incomplete and no-call episodes. Partial-subtotal percentiles include only episodes with some measured calls and some missing timings. Missing durations never become zero. Legacy episode aggregates are unverified without per-call records; a timeout aggregate of 0 is not instantaneous HTTP execution.', 'StudyCaption'), PageBreak()]

    story += [heading('Paired comparisons and cost accounting')]
    comparisons = []
    for item in main.get('comparisons', []):
        if item.get('kind') != 'declared':
            continue
        effect = item.get('effect') or {}
        interval = f'{percent(effect.get("low"))} to {percent(effect.get("high"))}' if number(effect.get('low')) else 'N/A'
        comparisons.append([item.get('hypothesis', ''), f'{item.get("route")} - {item.get("control")}',
                            percent(effect.get('estimate')), interval, str(effect.get('pairedEpisodes', 0)),
                            f'{effect.get("unpairedTreatment", 0)} / {effect.get("unpairedControl", 0)}'])
    story += [table(['Test', 'Comparison', 'Paired effect', 'Recorded 95% CI', 'Pairs', 'Unpaired T / C'], comparisons, [42, 84, 74, 130, 45, WIDTH - 375]),
              p('Effects are absolute percentage-point differences, macro-averaged over represented paired families. Positive favors the treatment. Sparse/incomplete comparisons do not cover every planned family; missing pairs and intervals are explicit. These multiple exploratory comparisons are not corrected into a single confirmatory significance claim.', 'StudyCaption')]
    costs = [[r['route'], usd(r.get('cost', {}).get('reportedUsageEquivalentUsd')),
              usd(r.get('cost', {}).get('unknownUsageReservationUsd')), str(r.get('cost', {}).get('unknownUsageCalls', 0)),
              usd(r.get('cost', {}).get('budgetUsdPerSuccess'))] for r in routes]
    story += [table(['Route', 'Reported estimate', 'Unknown reservation', 'Unknown calls', 'Budget / success'], costs, [40, 117, 125, 91, WIDTH - 373]),
              p(f'Setup/indexing budget: {usd(main.get("setup", {}).get("budgetChargedUsd"))}. Unassigned run usage: {usd(main.get("unassignedRunUsage", {}).get("budgetChargedUsd"))}. A cost per success is N/A when there are no successes. Reservations retain uncertainty instead of declaring failed requests free.', 'StudyCaption'), PageBreak()]

    story += [heading(f'Validator stress study - {verifier_split.upper()}'),
              p(f'{verifier.get("correctCases", 0)} correct and {verifier.get("flawedCases", 0)} deliberately flawed candidate answers. Jev threshold: {verifier.get("threshold", "N/A")}. Snapshot: {"COMPLETE" if verifier.get("complete") else "INCOMPLETE"}.'),
              reviewer_chart(verifier)]
    review_rows = []
    for method in verifier.get('methods', []):
        conditional = method.get('conditionalSemantic', {})
        operational = method.get('operationalFailClosed', {})
        combined = method.get('combinedWithDeterministic', {})
        review_rows.append([method['method'], f'{method.get("measuredCases", 0)}/{method.get("plannedCases", 0)}',
                            str(method.get('errors', 0)), f'{percent(conditional.get("falseAcceptanceRate"))} / {percent(conditional.get("falseRejectionRate"))}',
                            f'{percent(operational.get("falseAcceptanceRate"))} / {percent(operational.get("falseRejectionRate"))}',
                            f'{percent(combined.get("falseAcceptanceRate"))} / {percent(combined.get("falseRejectionRate"))}'])
    story += [table(['Reviewer', 'n / plan', 'Errors', 'Conditional FA / FR', 'Operational FA / FR', 'With code FA / FR'], review_rows, [70, 53, 42, 115, 115, WIDTH - 395]),
              p('FA: flawed answer accepted. FR: correct answer rejected. Conditional denominators include completed reviewer judgments only. Operational metrics include provider failures as blocked outcomes; that is not proof that the reviewer detected the flaw. The combined column adds the deterministic checker.'),
              p('Threshold selection uses development labels only, with a predeclared additional false-rejection constraint. Development results include threshold tuning and are not an unbiased held-out estimate. Maximum Jev hazard score is not a calibrated probability that the whole answer is wrong; no overall Brier score or human-judged truth score is invented.'),
              p('These stress cases have 50% flawed prevalence and repeat source templates. They evaluate supplied candidate/evidence pairs, not production fraud prevalence, exhaustive search completeness, or independent human adjudication.'), PageBreak()]

    if supplement:
        story += [heading('Supplemental retrieval and failure analysis'),
                  p('Conditional retrieval metrics include only document-applicable episodes with recorded completed retrieval. Unknown error stages and planner-skipped searches are counted separately; they are not silently scored as empty retrieval.')]
        retrieval_rows = []
        for row in supplement.get('routes', []):
            retrieval_rows.append([row['route'], f'{row.get("completedRetrievals", 0)}/{row.get("documentApplicable", 0)}',
                                   percent(row.get('conditionalSelectedDocumentRecallAt6')), percent(row.get('conditionalRecallAt6')),
                                   decimal(row.get('conditionalMrrAt6'), 3), decimal(row.get('conditionalNdcgAt6'), 3),
                                   percent(row.get('endToEndRequiredDocumentAvailability'))])
        story += [table(['Route', 'Complete / eligible', 'Selected coverage', 'Recall@6', 'MRR@6', 'nDCG@6', 'E2E docs'], retrieval_rows,
                        [36, 78, 89, 69, 65, 65, WIDTH - 402]),
                  p('R3 managed citation selection has observable selected-document coverage; its raw search ranking metrics remain N/A. End-to-end document availability includes errors and blocks in the denominator, but does not imply answer correctness. Relevance uses exact required document/version IDs with binary gains.', 'StudyCaption')]
        failures = sorted(supplement.get('failures', []), key=lambda item: (-item['episodes'], item['category']))[:15]
        story += [heading('Most frequent observed conditions'), table(['Condition', 'Episodes'], [[x['category'], x['episodes']] for x in failures], [WIDTH - 70, 70]),
                  p('Conditions overlap and are not proven root causes. Key/schema/scope mismatch is not automatically an arithmetic error. Full per-episode records remain in the supplemental JSON.', 'StudyCaption'), PageBreak()]

    if common is not None:
        story += [heading('Shared capabilities: a secondary comparison'),
                  p(f'{len(common.get("selectedQuestionIds", []))} questions in {len(common.get("selectedGroupIds", []))} scenario groups. Eligibility: {"complete measurement" if common.get("eligibleForConclusion") else "diagnostic / ineligible"}.'),
                  p('Membership was defined from available tools before held-out results. This subset does not replace the six-family primary score; whole-benchmark hard gates still apply.')]
        common_rows = [[r['route'], f'{r.get("episodes", 0)}/{r.get("fullSplitPlannedEpisodes", 0)}',
                        percent(r.get('microSuccessRate')), percent(r.get('observedFamilyMacro')),
                        r.get('errors', 0), 'Disqualified' if r.get('disqualified') else 'No observed violation']
                       for r in common['routes']]
        story += [table(['Route', 'Observed / planned', 'Micro success', 'Observed-family macro', 'Errors', 'Hard gate'], common_rows,
                        [34, 82, 77, 101, 40, WIDTH - 334]),
                  p('The held-out subgroup has only six scenario groups and covers financial and entry tasks. Paired intervals and exact membership are in the accompanying common-capability analysis. No additional winner is chosen from this subgroup.', 'StudyCaption'), PageBreak()]

    if sensitivity is not None:
        story += [heading('Sensitivity to fixed rubric weights'),
                  p('All five columns are automated scores out of 90, equally averaged across task families. The human clarity dimension remains unavailable. These weights were declared during development; no favorable column is selected as the result.')]
        weights = sensitivity['weights']
        sensitivity_rows = []
        for row in sensitivity['routes']:
            columns = {c['id']: c for c in row['columns']}
            ranks = 'N/A' if row.get('minimumRank') is None else f'{row["minimumRank"]} to {row["maximumRank"]}'
            sensitivity_rows.append([row['route']] + [decimal(columns[w['id']].get('familyMacro90')) for w in weights] + [ranks])
        story += [table(['Route'] + [w['label'] for w in weights] + ['Rank range'], sensitivity_rows,
                        [34] + [(WIDTH - 88) / 5] * 5 + [54]),
                  table(['Weighting', 'Factual', 'Completion', 'Grounding', 'Uncertainty'],
                        [[w['label']] + [w[k] for k in ['factual', 'completion', 'grounding', 'uncertainty']] for w in weights],
                        [WIDTH - 260, 65, 65, 65, 65]),
                  p('Errors retain their zero rubric components; missing observations remain missing. Rank ranges are unavailable when the analysis is ineligible. Stable ranks do not establish prose faithfulness or statistical superiority.', 'StudyCaption'), PageBreak()]

    if decisions is not None:
        story += [heading('Predeclared component decision criteria'),
                  p('These targeted comparisons supplement the primary six-family result. Financial and analytics tasks assess broader tools and Wren; document and scenario tasks assess retrieval and reranking. The practical target is +5 percentage points. Uncertain tradeoffs remain inconclusive.'),
                  p('Interpretation eligibility: ' + ('verified' if decisions['eligibility'].get('eligible') else 'ineligible / diagnostic')),
                  targeted_chart(decisions),
                  p('Each point is a treatment-minus-control difference in structured success. Scenario-group resampling keeps paraphrases and repeats together. Missing intervals are labeled CI N/A, not drawn as zero-width certainty. The few groups and multiple comparisons limit precision; the figure is not a significance claim.', 'StudyCaption'), PageBreak()]
        rows = [[r['hypothesis'], f'{r["route"]} / {r["control"]}', ', '.join(r.get('targetFamilies', [])),
                 effect_text(r.get('targetedEffect')), r.get('status', 'unavailable').replace('_', ' ')]
                for r in decisions['components']]
        story += [heading('Component assessments'), table(['Test', 'Route / control', 'Target families', 'Effect [interval]', 'Assessment'], rows,
                                                          [35, 62, 104, 140, WIDTH - 341]),
                  p('A candidate for further experiment is not a production recommendation. No combination of components is assumed to inherit individually measured benefits. Source integrity, hard gates, provider errors, useful task completion, latency and cost still constrain the decision.', 'StudyCaption')]
        reviewers = decisions.get('reviewers', {})
        if reviewers.get('available'):
            story += [heading('Reviewer tradeoffs against deterministic checks')]
            rows = [[r['method'], effect_text(r.get('operationalFalseAcceptanceDifference')),
                     effect_text(r.get('additionalCorrectWithholding')),
                     effect_text(r.get('conditionalPairedFalseAcceptanceDifference')),
                     r.get('status', 'unavailable').replace('_', ' ')] for r in reviewers.get('comparisons', [])]
            story += [table(['Method', 'Flawed acceptance difference', 'Added correct withholding', 'Conditional flawed acceptance', 'Assessment'], rows,
                            [47, 110, 110, 110, WIDTH - 377]),
                      p('The point criterion requires less operational acceptance of flawed candidates and no more than +5 pp additional withholding of correct candidates. Conditional comparisons retain completed paired judgments only. Provider errors are withholding, not evidence that a flaw was detected.', 'StudyCaption')]
        story += [PageBreak()]
        if decisions.get('complexity'):
            story += [heading('What each configuration adds'),
                      table(['Route', 'Components', 'Operational obligations'],
                            [[r['route'], r['components'], r['obligations']] for r in decisions['complexity']],
                            [34, 211, WIDTH - 245]),
                      p('These are implementation responsibilities, not an invented complexity score. The simpler existing product remains the default when comparative benefit is below target or unresolved.', 'StudyCaption')]
            fronts = decisions.get('pareto', {})
            rows = []
            for key, label_text in [('overall', 'All six families'), ('financialAndAnalytics', 'Financial + analytics'),
                                    ('documentsAndScenario', 'Documents + scenario')]:
                front = fronts.get(key, {})
                eligible_rows = [r for r in front.get('rows', []) if r.get('comparable')]
                undominated = [r['route'] for r in eligible_rows if not r.get('dominatedBy')]
                rows.append([label_text, ', '.join(undominated) if eligible_rows else 'N/A'])
            story += [table(['Observed tradeoff view', 'Not dominated on measured point estimates'], rows, [180, WIDTH - 180]),
                      p('Dominance compares overall and targeted success, execution-error rate, p95 harness latency and tracked cost per successful task. It ignores interval uncertainty and does not establish statistical superiority or a production winner.', 'StudyCaption'), PageBreak()]

    story += [heading('Limitations and interpretation')]
    limitations = list(dict.fromkeys(main.get('limitations', []) + verifier.get('limitations', [])))
    for index, limitation in enumerate(limitations, 1):
        story.append(p(f'{index}. {limitation}', 'StudySmall'))
    story += [PageBreak(), heading('Provenance and reproduction'),
              p('All figures are vector graphics generated from the explicit saved JSON inputs. The exporter performs no provider requests, database queries, deployments or score recomputation. Source result values are retained; missing measurements remain N/A.'),
              p(f'Exporter: {VERSION}. ReportLab: {reportlab.Version}. Input bundle SHA-256: {bundle_hash}', 'StudySmall')]
    for item in inputs:
        story += [p(f'{item["role"]}: {item["filename"]}', 'StudySmall'), p(f'SHA-256: {item["sha256"]}', 'StudySmall')]
    story += [p('The accompanying provenance JSON binds these inputs, the exporter source, validation results and output PDF hash. Footer hashes identify this snapshot on every page.'),
              p(f'Original result source revision: {main.get("sourceRevision") or "not recorded"}. The working-tree/source manifest in the run directory identifies actual experimental code; a published ancestor alone is not sufficient.', 'StudySmall')]
    if command:
        story += [heading('Reproduce this export'), p(command, 'StudySmall')]
    story += [p('Renderer references: ReportLab Platypus and Graphics user guides (docs.reportlab.com/reportlab/userguide/ch5_platypus/ and ch11_graphics/). Scientific interpretation and experimental limitations come from the input study artifacts.', 'StudyCaption')]
    document = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=MARGIN, leftMargin=MARGIN,
                                 topMargin=52, bottomMargin=43, title='Daybook AI architecture comparison',
                                 author='Daybook research evaluation', subject=status)
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return {'exporter': VERSION, 'status': status,
            'selectionStatus': 'KNOWN STUDY DEFECTS / NOT FOR SELECTION' if known_defects else 'No validity notice supplied; selection eligibility is not inferred by this exporter',
            'observedEpisodes': observed, 'plannedEpisodes': planned,
            'inputs': inputs, 'inputBundleHash': bundle_hash, 'reportlabVersion': reportlab.Version}


def validate_pdf(path, render_dir=None):
    """Local visual artifacts plus machine checks; never claim a human page review."""
    try:
        import fitz
    except ImportError:
        return {'available': False, 'reason': 'PyMuPDF unavailable; PDF rendering not verified'}
    doc = fitz.open(path)
    bounds_failures, empty_pages = [], []
    if render_dir:
        Path(render_dir).mkdir(parents=True, exist_ok=True)
    for index, page in enumerate(doc):
        if not page.get_text().strip():
            empty_pages.append(index + 1)
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line.get('spans', []):
                    x0, y0, x1, y1 = span['bbox']
                    if min(x0, y0) < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                        bounds_failures.append({'page': index + 1, 'bounds': list(span['bbox'])})
        if render_dir:
            page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3), alpha=False).save(str(Path(render_dir) / f'page-{index + 1:02}.png'))
    result = {'available': True, 'pages': len(doc), 'emptyPages': empty_pages,
              'textOutsidePage': bounds_failures, 'rendered': bool(render_dir),
              'visualReview': 'Rendering and text bounds checks only; inspection must be recorded separately.'}
    doc.close()
    if empty_pages or bounds_failures:
        raise ValueError(f'PDF bounds validation failed: {result}')
    return result


def main_cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--main-results', required=True)
    parser.add_argument('--verifier-results', required=True)
    parser.add_argument('--verifier-split', required=True, choices=['development', 'holdout'])
    parser.add_argument('--supplement')
    parser.add_argument('--common', help='Common-capability JSON with adjacent analysis-provenance.json')
    parser.add_argument('--sensitivity', help='Weight-sensitivity JSON with adjacent analysis-provenance.json')
    parser.add_argument('--decisions', help='Decision-supplement JSON with adjacent analysis-provenance.json')
    parser.add_argument('--validity-notice', help='Defaults to validity-notice.json beside the main results')
    parser.add_argument('--output', required=True)
    parser.add_argument('--render-dir')
    args = parser.parse_args()
    main, main_provenance = read_input(args.main_results, 'main results')
    verifier, verifier_provenance = read_input(args.verifier_results, 'verifier results')
    inputs = [main_provenance, verifier_provenance]
    validity_notice, validity_provenance, validity_path = find_validity_notice(args.main_results, args.validity_notice)
    if validity_provenance:
        inputs.append(validity_provenance)
    supplement = None
    if args.supplement:
        supplement, provenance = read_input(args.supplement, 'retrieval supplement')
        inputs.append(provenance)
    common = sensitivity = decisions = None
    if args.common:
        common, provenance = read_analysis(args.common, 'common-capability analysis', main_provenance['sha256'])
        inputs.extend(provenance)
    if args.sensitivity:
        sensitivity, provenance = read_analysis(args.sensitivity, 'weight-sensitivity analysis', main_provenance['sha256'])
        inputs.extend(provenance)
    if args.decisions:
        decisions, provenance = read_analysis(args.decisions, 'decision analysis', main_provenance['sha256'], verifier_provenance['sha256'])
        inputs.extend(provenance)
    import shlex
    command = '.tools/report-render/bin/python scripts/export-research-report.py ' + ' '.join(
        shlex.quote(value) for value in ['--main-results', args.main_results, '--verifier-results', args.verifier_results,
                                       '--verifier-split', args.verifier_split, '--output', args.output]
        + (['--supplement', args.supplement] if args.supplement else [])
        + (['--common', args.common] if args.common else [])
        + (['--sensitivity', args.sensitivity] if args.sensitivity else [])
        + (['--decisions', args.decisions] if args.decisions else [])
        + (['--validity-notice', validity_path] if validity_path else [])
    )
    provenance = build_pdf(main, verifier, args.verifier_split, args.output, inputs, supplement, command, validity_notice,
                           common, sensitivity, decisions)
    provenance['exporterSourceHash'] = sha(Path(__file__).read_bytes())
    provenance['validation'] = validate_pdf(args.output, args.render_dir)
    provenance['pdfHash'] = sha(Path(args.output).read_bytes())
    Path(str(args.output) + '.provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'output': args.output, 'status': provenance['status'], 'selectionStatus': provenance['selectionStatus'], 'validation': provenance['validation']}))


if __name__ == '__main__':
    main_cli()
