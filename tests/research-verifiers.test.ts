import { describe, expect, it } from 'vitest';
import {
  analyzeVerifiers,
  deterministicReview,
  evaluateVerifier,
  normalizedReviewInput,
  reviewInputHash,
  selectJevThreshold,
  thresholdDecision,
  visibleReviewInput,
  type VerifierRecord,
} from '../research/validator-study';
import { reviewCases, type ReviewCase } from '../research/reference';
import {
  GeminiResearchClient,
  JevResearchClient,
  JEV_CHECKS,
  type JevReviewProbabilities,
  type ResearchRequest,
  type ResearchTransport,
} from '../research/providers';

const correct = reviewCases.find((item) => item.expected === 'PASS')!;
const flawed = (kind: string) => reviewCases.find((item) => item.faultType === kind)!;
function record(item: ReviewCase, method: VerifierRecord['method'], risk = 0.1): VerifierRecord {
  return {
    id: `${method}:${item.id}`,
    caseId: item.id,
    sourceGroupId: item.sourceGroupId,
    split: item.split,
    method,
    inputHash: reviewInputHash(visibleReviewInput(item)),
    threshold: method === 'jev' ? 0.8 : null,
    status: 'ok',
    decision: risk >= 0.8 ? 'BLOCK' : 'PASS',
    reasons: [],
    evidenceIds: [],
    durationMs: 1,
    ...(method === 'jev'
      ? {
          probabilities: Object.fromEntries(
            JEV_CHECKS.map((check) => [check, check === 'unsupported_claim' ? risk : 0.01]),
          ) as JevReviewProbabilities,
        }
      : {}),
  };
}
function clients(json: unknown, status = 200) {
  const requests: ResearchRequest[] = [];
  const transport: ResearchTransport = async (request) => {
    requests.push(request);
    return { status, json, elapsedMs: 12 };
  };
  return {
    requests,
    gemini: new GeminiResearchClient('test', transport),
    jev: new JevResearchClient('test', transport),
  };
}

describe('verifier input isolation and deterministic baseline', () => {
  it('whitelists visible fields and never sends fault labels or expected decisions', () => {
    const input = visibleReviewInput(flawed('wrong_amount'));
    expect(Object.keys(input).sort()).toEqual(['candidate', 'evidence', 'question']);
    expect(input).not.toHaveProperty('expected');
    expect(input).not.toHaveProperty('faultType');
    expect(input).not.toHaveProperty('deterministicExpected');
    expect(normalizedReviewInput(input)).toHaveProperty('answer', input.candidate);
    expect(normalizedReviewInput(input)).not.toHaveProperty('candidate');
    const relabeled = { ...correct, expected: 'BLOCK' as const, faultType: 'arbitrary-secret-label' };
    expect(reviewInputHash(visibleReviewInput(correct))).toBe(reviewInputHash(visibleReviewInput(relabeled)));
  });

  it('checks exact monetary values/currencies and actual citation IDs without labels', () => {
    expect(deterministicReview(visibleReviewInput(correct)).decision).toBe('PASS');
    for (const kind of ['wrong_amount', 'wrong_currency', 'unsupported_citation'])
      expect(deterministicReview(visibleReviewInput(flawed(kind))).decision).toBe('BLOCK');
  });

  it('does not pass dates or bare numbers off as a monetary source', () => {
    const input = visibleReviewInput(correct);
    input.candidate.facts[0].value = '2026';
    input.evidence[0].text = 'This record is dated 2026-10-31. No currency amount is supplied.';
    expect(deterministicReview(input).decision).toBe('BLOCK');
  });

  it('honestly misses semantic-only faults rather than using hidden labels as a checker', () => {
    for (const kind of [
      'wrong_period',
      'wrong_entity',
      'invoice_as_payment',
      'missing_assumption',
      'unjustified_certainty',
      'instruction_in_evidence',
    ])
      expect(deterministicReview(visibleReviewInput(flawed(kind))).decision).toBe('PASS');
  });

  it('rejects malformed candidates and ambiguous duplicate source IDs', () => {
    expect(deterministicReview({ ...visibleReviewInput(correct), expected: 'PASS' }).decision).toBe('BLOCK');
    const input = visibleReviewInput(correct);
    input.evidence.push({ ...input.evidence[0], text: 'Contradictory duplicate.' });
    expect(deterministicReview(input).reasons).toContain('DUPLICATE_SOURCE_ID');
  });
});

describe('semantic reviewer orchestration', () => {
  it('sends the same stripped candidate/evidence to the LLM, with no evaluator labels', async () => {
    const input = visibleReviewInput(correct);
    const mock = clients({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              {
                text: JSON.stringify({
                  decision: 'PASS',
                  reasons: ['The supplied source supports the claim.'],
                  evidenceIds: [input.evidence[0].id],
                }),
              },
            ],
          },
        },
      ],
      modelVersion: 'gemini-3.5-flash-lite',
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
    });
    const result = await evaluateVerifier('llm', input, mock);
    expect(result.status).toBe('ok');
    expect(result.decision).toBe('PASS');
    const body = mock.requests[0].body as { contents: { parts: { text: string }[] }[] };
    const sent = JSON.parse(body.contents[0].parts[0].text);
    expect(sent.answer).toEqual(input.candidate);
    expect(sent.evidence).toEqual(input.evidence);
    expect(sent).not.toHaveProperty('expected');
    expect(mock.requests).toHaveLength(1);
  });

  it('rejects reviewer citations that were never supplied', async () => {
    const mock = clients({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { text: JSON.stringify({ decision: 'PASS', reasons: [], evidenceIds: ['imagined-document'] }) },
            ],
          },
        },
      ],
    });
    expect(await evaluateVerifier('llm', visibleReviewInput(correct), mock)).toMatchObject({
      status: 'error',
      decision: null,
      error: 'VERIFIER_UNKNOWN_EVIDENCE',
    });
  });

  it('retains all Jev hazard probabilities while applying the declared threshold', async () => {
    const answers = Object.fromEntries(
      JEV_CHECKS.map((check) => [check, { type: 'noul', noul: check === 'wrong_period' ? 0.88 : 0.1 }]),
    );
    const mock = clients({ model: 'jev-1.14.0', answers, usage: { input_tokens: 200, output_tokens: 50 } });
    const result = await evaluateVerifier('jev', visibleReviewInput(flawed('wrong_period')), mock, 0.9);
    expect(result.decision).toBe('PASS');
    expect(result.probabilities?.wrong_period).toBe(0.88);
    expect(mock.requests).toHaveLength(1);
  });

  it('records provider failures distinctly without leaking their response body or retrying', async () => {
    const mock = clients({ error: { message: 'private provider details' } }, 401);
    const result = await evaluateVerifier('jev', visibleReviewInput(correct), mock);
    expect(result).toMatchObject({ status: 'error', decision: null, error: 'AUTH_ERROR' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mock.requests).toHaveLength(1);
  });

  it('deterministic decisions make no provider requests', async () => {
    const mock = clients(null);
    expect((await evaluateVerifier('deterministic', visibleReviewInput(correct), mock)).decision).toBe(
      'PASS',
    );
    expect(mock.requests).toHaveLength(0);
  });
});

describe('development-only threshold selection', () => {
  const selected = reviewCases.filter((item) => item.split === 'development').slice(0, 4);
  const rows = selected.flatMap((item) => [
    record(item, 'deterministic', 0.1),
    record(item, 'jev', item.expected === 'PASS' ? 0.2 : 0.8),
  ]);
  it('selects the most conservative threshold tied for fewer harmful accepts under the false-block limit', () => {
    const result = selectJevThreshold(rows, selected);
    expect(result.threshold).toBe(0.8);
    expect(result.feasible).toBe(true);
    expect(result.selectedOn).toBe('development');
    expect(result.probabilityCalibration).toContain('not probability');
  });

  it('refuses held-out labels, missing development cases, and duplicate results', () => {
    expect(() => selectJevThreshold(rows, [reviewCases.find((item) => item.split === 'holdout')!])).toThrow(
      /DEVELOPMENT_ONLY/,
    );
    expect(() => selectJevThreshold(rows.slice(1), selected)).toThrow(/INCOMPLETE/);
    expect(() => selectJevThreshold([...rows, rows[0]], selected)).toThrow(/DUPLICATE/);
  });

  it('marks the selection infeasible if no threshold meets the false-block constraint', () => {
    const unavailable = rows.map((row) =>
      row.method === 'jev' && selected.find((item) => item.id === row.caseId)!.expected === 'PASS'
        ? { ...row, status: 'error' as const, decision: null, probabilities: undefined }
        : row,
    );
    const result = selectJevThreshold(unavailable, selected);
    expect(result.feasible).toBe(false);
    expect(result.successfulJevDecisions).toBe(2);
    expect(result.grid.every((point) => !point.feasible)).toBe(true);
  });

  it('fails closed on missing probabilities instead of fabricating a zero risk score', () => {
    const row = { ...record(correct, 'jev'), probabilities: undefined };
    expect(thresholdDecision(row, 1)).toBe('BLOCK');
  });
});

describe('verifier study report denominators', () => {
  it('separates conditional judgments, operational errors and combined deterministic protection', () => {
    const cases = [correct, flawed('wrong_amount')];
    const rows = cases.flatMap((item) => [
      { ...record(item, 'deterministic'), ...deterministicReview(visibleReviewInput(item)) },
      record(item, 'llm', 0.1),
      item.expected === 'PASS'
        ? { ...record(item, 'jev'), status: 'error' as const, decision: null, probabilities: undefined }
        : record(item, 'jev', 0.1),
    ]);
    const result = analyzeVerifiers(rows, cases, 0.8);
    expect(result.complete).toBe(true);
    const llm = result.methods.find((method) => method.method === 'llm')!;
    expect(llm.conditionalSemantic.falseAcceptanceRate).toBe(1);
    expect(llm.combinedWithDeterministic.falseAcceptanceRate).toBe(0);
    const jev = result.methods.find((method) => method.method === 'jev')!;
    expect(jev.errors).toBe(1);
    expect(jev.conditionalSemantic.correct).toBe(0);
    expect(jev.operationalFailClosed.falseRejectionRate).toBe(1);
    expect(jev.conditionalSemantic.brierScore).toBeNull();
    expect(jev.probabilityCalibration.available).toBe(false);
  });

  it('keeps unrun reviewer cases explicit rather than assuming success', () => {
    const report = analyzeVerifiers(
      [record(correct, 'deterministic')],
      [correct, flawed('wrong_amount')],
      0.8,
    );
    expect(report.complete).toBe(false);
    expect(report.methods.find((method) => method.method === 'jev')?.missingCases).toBe(2);
  });
});
