import importlib.util
import tempfile
import unittest
import json
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'scripts' / 'export-research-report.py'
spec = importlib.util.spec_from_file_location('daybook_pdf', SOURCE)
pdf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pdf)


def fixture():
    routes = []
    for i in range(9):
        routes.append({
            'route': f'R{i}', 'label': 'Toy route', 'episodes': 1, 'plannedEpisodes': 2,
            'microSuccessRate': 0, 'macroSuccessRate': None, 'errorRate': 0,
            'automatedScore90': 12, 'p50Ms': 2000, 'p95Ms': 2000,
            'families': [{'family': family, 'episodes': 1 if family == 'financial' else 0,
                          'rate': 0 if family == 'financial' else None} for family in pdf.FAMILIES],
            'cost': {'budgetUsdPerEpisode': .01, 'reportedUsageEquivalentUsd': .005,
                     'unknownUsageReservationUsd': .005, 'unknownUsageCalls': 1,
                     'budgetUsdPerSuccess': None},
        })
    main = {'runId': 'toy-pilot', 'split': 'development', 'complete': False, 'routes': routes,
            'expectedRepeats': 1, 'datasetVersion': 'toy-v1', 'generatedAt': '2026-10-30T00:00:00Z',
            'comparisons': [], 'limitations': ['Synthetic test fixture, not measured provider results.']}
    metrics = {'falseAcceptanceRate': .5, 'falseRejectionRate': 0}
    verifier = {'complete': True, 'cases': 2, 'correctCases': 1, 'flawedCases': 1,
                'threshold': .8, 'methods': [
                    {'method': name, 'measuredCases': 2, 'plannedCases': 2, 'errors': 0,
                     'conditionalSemantic': metrics, 'operationalFailClosed': metrics,
                     'combinedWithDeterministic': metrics} for name in ['deterministic', 'llm', 'jev']]}
    return main, verifier


class ExportTests(unittest.TestCase):
    def test_complete_run_with_known_defects_remains_ineligible_and_keeps_scores(self):
        main, verifier = fixture()
        main['complete'] = True
        for row in main['routes']:
            row['plannedEpisodes'] = row['episodes']
        original = json.dumps(main, sort_keys=True)
        notice = {'runId': 'toy-pilot', 'eligibleForSelection': False,
                  'originalResultsSha256': 'a' * 64, 'issues': [
                      {'code': 'CONTROL_EVIDENCE_ADAPTER', 'detail': 'Baseline evidence omitted; scores retained.'}]}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'flagged.pdf'
            result = pdf.build_pdf(main, verifier, 'development', path, [], validity_notice=notice)
            self.assertEqual(result['status'], 'DEVELOPMENT | COMPLETE')
            self.assertEqual(result['selectionStatus'], 'KNOWN STUDY DEFECTS / NOT FOR SELECTION')
            self.assertEqual(json.dumps(main, sort_keys=True), original)
            self.assertEqual(pdf.validate_pdf(path)['textOutsidePage'], [])
            import fitz
            doc = fitz.open(path)
            for page in doc:
                self.assertIn('KNOWN STUDY DEFECTS / NOT FOR SELECTION', page.get_text())
            self.assertIn('Baseline evidence omitted', '\n'.join(page.get_text() for page in doc))
            doc.close()
            main_path = Path(folder) / 'results.json'
            main_path.write_text(json.dumps(main))
            notice_path = Path(folder) / 'validity-notice.json'
            notice_path.write_text(json.dumps(notice))
            found, metadata, _ = pdf.find_validity_notice(main_path)
            self.assertEqual(found, notice)
            self.assertEqual(metadata['role'], 'validity notice')
            with self.assertRaisesRegex(ValueError, 'original results hash'):
                pdf.validate_validity_notice(notice, main, 'b' * 64)
            notice_path.unlink()
            self.assertIsNone(pdf.find_validity_notice(main_path)[0])

    def test_scatter_labels_do_not_overlap_even_for_identical_points(self):
        points = [(f'R{i}', 250, 150) for i in range(9)]
        labels = pdf.scatter_labels(points, (50, 40, 480, 240))
        boxes = [(x - 2, y - 2, x + 15, y + 8) for _, _, _, x, y in labels]
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                self.assertFalse(a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1])

    def test_sparse_report_preserves_unknown_metrics_and_incomplete_status(self):
        main, verifier = fixture()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'report.pdf'
            result = pdf.build_pdf(main, verifier, 'development', path,
                                   [{'role': 'toy', 'filename': 'toy.json', 'sha256': 'a' * 64}])
            checks = pdf.validate_pdf(path)
            self.assertTrue(checks['available'])
            self.assertEqual(checks['textOutsidePage'], [])
            self.assertEqual(checks['emptyPages'], [])
            self.assertEqual(result['status'], 'DEVELOPMENT | INCOMPLETE')
            import fitz
            document = fitz.open(path)
            for page in document:
                self.assertIn('DEVELOPMENT | INCOMPLETE', page.get_text())
            all_text = '\n'.join(page.get_text() for page in document)
            self.assertIn('N/A', all_text)
            self.assertIn('No winning architecture is selected', all_text)
            self.assertIn('unknown-usage reservations', all_text)
            self.assertNotIn('Score /100', all_text)
            document.close()

    def test_rejects_wrong_snapshot_and_false_complete_label(self):
        main, verifier = fixture()
        with self.assertRaisesRegex(ValueError, 'snapshot differs'):
            pdf.validate_inputs(main, verifier, 'development', {'runId': 'other-run'})
        main['complete'] = True
        with self.assertRaisesRegex(ValueError, 'Complete label contradicts'):
            pdf.validate_inputs(main, verifier, 'development')

    def test_explicit_verifier_split_and_nonfinite_values_are_rejected(self):
        main, verifier = fixture()
        with self.assertRaisesRegex(ValueError, 'Verifier split'):
            pdf.validate_inputs(main, verifier, 'unknown')
        main['routes'][0]['microSuccessRate'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'Invalid rate'):
            pdf.validate_inputs(main, verifier, 'development')
        self.assertEqual(pdf.percent(None), 'N/A')
        self.assertEqual(pdf.usd(None), 'N/A')

    def test_latency_supplement_exposes_missing_service_values(self):
        main, verifier = fixture()
        unknown = {'episodes': 1, 'wall': {'p50Ms': 2000, 'p95Ms': 2000},
                   'providerHttpSum': {'measured': 0, 'unknown': 1, 'recordedZeros': 0,
                                       'completeEpisodes': 0, 'unknownEpisodes': 1,
                                       'p50Ms': None, 'p95Ms': None}}
        supplement = {'runId': 'toy-pilot', 'split': 'development', 'measuredEpisodes': 9,
                      'routes': [{'route': f'R{i}', 'latency': {'allAttempts': unknown, 'nonError': unknown}}
                                 for i in range(9)]}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'report.pdf'
            pdf.build_pdf(main, verifier, 'development', path, [], supplement)
            self.assertEqual(pdf.validate_pdf(path)['textOutsidePage'], [])
            import fitz
            document = fitz.open(path)
            content = '\n'.join(page.get_text() for page in document)
            self.assertIn('Latency denominators and provider service time', content)
            self.assertIn('N/A / N/A', content)
            document.close()


if __name__ == '__main__':
    unittest.main()
