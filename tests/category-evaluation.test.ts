import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  accountId,
  buildCategoryCase,
  categoryCases,
  categorySequences,
  fixtureLines,
  knownDevelopmentRegressions,
  organizationId,
} from '../scripts/category-evaluation/fixtures';
import { categoryReference } from '../scripts/category-evaluation/references';
import {
  categoryLearningPairs,
  pairedSequenceInterval,
  scoreCategory,
  scoreCategoryMatrix,
  summarizeCategory,
  summarizeCategoryCosts,
} from '../scripts/category-evaluation/scoring';
import {
  categoryFamilies,
  type CategoryCase,
  type CategoryObservation,
} from '../scripts/category-evaluation/types';

const item = (id: string, state: 0 | 1 | 3 = 0) => categoryCases.find((c) => c.id === `${id}:c${state}`)!;
const choose = (
  c: CategoryCase,
  code: string,
  extras: Partial<CategoryObservation> = {},
): CategoryObservation => ({
  caseId: c.id,
  selector: 'gemini',
  inputHash: c.inputHash,
  status: 'ok',
  result: { decision: 'SELECT', accountId: accountId(code) },
  attempts: 1,
  latencyMs: 120,
  reportedCostUsd: '0.0001',
  reservedUnknownUsd: null,
  ...extras,
});
const workflow = (c: CategoryCase, code: string) => ({
  entry: {
    date: c.input.facts.date!,
    description: c.input.facts.description,
    counterparty: c.input.facts.counterparty,
    reference: '',
    source: 'AI' as const,
    lines: fixtureLines(code, c.input.facts.amount!),
  },
  posted: false,
});

describe('Frozen category comparison fixture discipline', () => {
  it('has 24 disjoint sequences, six development and18heldout, with all correlated states kept together', () => {
    expect(categorySequences).toHaveLength(24);
    expect(categoryCases).toHaveLength(72);
    expect(new Set(categoryCases.map((c) => c.id)).size).toBe(72);
    for (const family of categoryFamilies) {
      const familySequences = categorySequences.filter((s) => s.family === family);
      expect(familySequences.filter((s) => s.split === 'development')).toHaveLength(1);
      expect(familySequences.filter((s) => s.split === 'holdout')).toHaveLength(3);
    }
    for (const s of categorySequences)
      expect(categoryCases.filter((c) => c.sequenceId === s.id).map((c) => c.correctionEvents)).toEqual([
        0, 1, 3,
      ]);
  });
  it('freezes actual selector opportunity denominators, excluding zero-call gates', () => {
    const development = categoryCases.filter((c) => c.split === 'development');
    const holdout = categoryCases.filter((c) => c.split === 'holdout');
    expect(development.filter((c) => categoryReference(c).selectorEligible)).toHaveLength(15);
    expect(holdout.filter((c) => categoryReference(c).selectorEligible)).toHaveLength(42);
    expect(holdout.filter((c) => categoryReference(c).decision === 'SELECT')).toHaveLength(33);
    expect(
      new Set(holdout.filter((c) => categoryReference(c).decision === 'SELECT').map((c) => c.sequenceId))
        .size,
    ).toBe(11);
  });
  it('keeps the already observed rent/party examples in development and does not call the rent regression a new holdout', () => {
    expect(knownDevelopmentRegressions).toHaveLength(1);
    expect(categoryReference(knownDevelopmentRegressions[0]).selectorEligible).toBe(false);
    expect(categoryCases.some((c) => c.id === knownDevelopmentRegressions[0].id)).toBe(false);
    expect(
      categoryCases
        .filter((c) => c.input.facts.description.includes('friend to party'))
        .every((c) => c.split === 'development'),
    ).toBe(true);
  });
  it('binds provider-visible facts/context without labels, split, sequence identity or audit-only excluded records', () => {
    for (const c of categoryCases) {
      expect(Object.keys(c.input).sort()).toEqual(['context', 'facts']);
      const serialized = JSON.stringify(c.input);
      for (const label of [
        'preferredCategoryCode',
        'acceptableCategoryCodes',
        'selectorEligible',
        'split',
        'sequenceId',
        'expected',
        'excludedEvidenceIds',
      ])
        expect(serialized).not.toContain(`"${label}"`);
      expect(createHash('sha256').update(serialized).digest('hex')).toBe(c.inputHash);
      for (const excludedId of c.excludedEvidenceIds) expect(serialized).not.toContain(excludedId);
      for (const a of c.input.context.accounts) expect(z.uuid().safeParse(a.id).success).toBe(true);
    }
  });
  it('excludes actual foreign, reversed, archived and superseded candidate examples and reports fewer eligible records honestly', () => {
    const foreign = item('evidence-foreign', 3);
    expect(foreign.excludedEvidenceIds).toHaveLength(1);
    expect(foreign.input.context.corrections).toHaveLength(3);
    const stale = item('evidence-stale', 3);
    expect(stale.excludedEvidenceIds).toHaveLength(2);
    expect(stale.eligibleCorrectionCount).toBe(1);
    const conflict = item('evidence-conflict', 3);
    expect(conflict.eligibleCorrectionCount).toBe(1);
    expect(conflict.input.context.corrections[0].corrected_lines[0].accountId).toBe(accountId('5030'));
    expect(item('evidence-conflict', 1).input.context.corrections[0].corrected_lines[0].accountId).toBe(
      accountId('5070'),
    );
  });
  it('never exposes future corrections and makes every visible account scoped to this workspace', () => {
    const s = structuredClone(categorySequences.find((c) => c.id === 'repeat-paper')!);
    s.priorCorrections[0].postedAt = '2026-11-01T00:00:00Z';
    expect(buildCategoryCase(s, 1).input.context.corrections).toEqual([]);
    for (const c of categoryCases)
      expect(c.input.context.accounts.every((a) => a.organizationId === organizationId)).toBe(true);
  });
});

describe('Semantic validity, business preference and workflow scoring', () => {
  it('accepts generic Supplies before teaching Printing, and separates a missed taught preference from a semantic error afterward', () => {
    const before = item('repeat-paper'),
      after = item('repeat-paper', 3);
    expect(scoreCategory(before, 'gemini', choose(before, '5030'))).toMatchObject({
      semanticCategoryCorrect: true,
      preferenceAgreement: null,
      selectorSuccess: true,
      completeJournalCorrect: null,
    });
    expect(scoreCategory(after, 'gemini', choose(after, '5030'))).toMatchObject({
      semanticCategoryCorrect: true,
      preferenceAgreement: false,
      selectorSuccess: false,
    });
    expect(scoreCategory(after, 'gemini', choose(after, '5070'))).toMatchObject({
      semanticCategoryCorrect: true,
      preferenceAgreement: true,
      selectorSuccess: true,
    });
  });
  it('measures adoption gain without falsely declaring the earlier reasonable choice wrong', () => {
    const cases = categoryCases.filter((c) => c.sequenceId === 'repeat-paper');
    const observations = cases.map((c) => choose(c, c.correctionEvents === 0 ? '5030' : '5070'));
    const scores = scoreCategoryMatrix(cases, observations, ['gemini']);
    const [learning] = categoryLearningPairs(cases, scores, 'gemini');
    expect(learning).toMatchObject({
      handlingGain: 0,
      preferenceAdoptionGain: 1,
      beforeSemanticCorrect: true,
      afterSemanticCorrect: true,
    });
  });
  it('follows the latest active exact-context preference, not majority voting over superseded examples', () => {
    const c = item('evidence-conflict', 3);
    expect(scoreCategory(c, 'gemini', choose(c, '5070')).preferenceAgreement).toBe(false);
    expect(scoreCategory(c, 'gemini', choose(c, '5030')).preferenceAgreement).toBe(true);
  });
  it('counts bad same-vendor transfer of an old category as harmful overgeneralization', () => {
    const c = item('changed-app', 3);
    expect(scoreCategory(c, 'gemini', choose(c, '5070'))).toMatchObject({
      semanticCategoryCorrect: false,
      harmfulOvergeneralization: true,
      selectorSuccess: false,
    });
  });
  it('requires an asset handoff rather than rewarding a balanced expense suggestion for a laptop', () => {
    const c = item('changed-laptop', 3);
    expect(scoreCategory(c, 'gemini', choose(c, '5070'))).toMatchObject({
      unsafeSuggestion: true,
      harmfulOvergeneralization: true,
      selectorSuccess: false,
    });
    expect(
      scoreCategory(
        c,
        'gemini',
        choose(c, '5070', {
          result: {
            decision: 'UNSUPPORTED',
            reason: 'unsupported_description',
            message: 'Use full journal review.',
          },
        }),
      ),
    ).toMatchObject({ selectorSuccess: true, completeJournalCorrect: null });
  });
  it('does not reward unnecessary clarification or let the local funding gate inflate model accuracy', () => {
    const ready = item('unseen-pens-dev');
    expect(
      scoreCategory(
        ready,
        'gemini',
        choose(ready, '5030', {
          result: { decision: 'CLARIFY', topic: 'category', question: 'What category?' },
        }),
      ),
    ).toMatchObject({ unnecessaryClarification: true, selectorSuccess: false });
    const missing = item('missing-party-dev');
    expect(
      scoreCategory(
        missing,
        'gemini',
        choose(missing, '5060', {
          attempts: 0,
          result: { decision: 'CLARIFY', topic: 'funding_account', question: 'Which account paid?' },
        }),
      ),
    ).toMatchObject({ workflowHandlingSuccess: true, selectorSuccess: null, necessaryClarification: true });
  });
  it('rejects wrong or empty clarification and provider calls made despite a zero-call gate', () => {
    const c = item('missing-currency');
    expect(
      scoreCategory(
        c,
        'gemini',
        choose(c, '5020', {
          attempts: 0,
          result: { decision: 'CLARIFY', topic: 'purpose', question: 'Why?' },
        }),
      ).workflowHandlingSuccess,
    ).toBe(false);
    expect(
      scoreCategory(
        c,
        'gemini',
        choose(c, '5020', { result: { decision: 'CLARIFY', topic: 'currency', question: 'Currency?' } }),
      ).failures,
    ).toContain('attempt_contract_mismatch');
  });
  it('keeps correct selection separate from a wrong funding account, amount, rate or date in actual workflow output', () => {
    const c = item('repeat-paper', 3);
    const correct = workflow(c, '5070');
    expect(scoreCategory(c, 'gemini', choose(c, '5070', { workflow: correct }))).toMatchObject({
      selectorSuccess: true,
      completeJournalCorrect: true,
      counterAccountCorrect: true,
    });
    const badFunding = structuredClone(correct);
    badFunding.entry.lines[1].accountId = accountId('1010');
    expect(scoreCategory(c, 'gemini', choose(c, '5070', { workflow: badFunding }))).toMatchObject({
      selectorSuccess: true,
      workflowHandlingSuccess: false,
      completeJournalCorrect: false,
      counterAccountCorrect: false,
    });
    for (const mutate of [
      (w: typeof correct) => {
        w.entry.date = '2026-10-30';
      },
      (w: typeof correct) => {
        w.entry.lines[0].debit = '341';
        w.entry.lines[1].credit = '341';
      },
      (w: typeof correct) => {
        w.entry.lines[0].exchangeRate = '1.1';
        w.entry.lines[1].exchangeRate = '1.1';
      },
    ]) {
      const changed = structuredClone(correct);
      mutate(changed);
      expect(
        scoreCategory(c, 'gemini', choose(c, '5070', { workflow: changed })).completeJournalCorrect,
      ).toBe(false);
    }
  });
  it('does not call a balanced but semantically wrong journal correct', () => {
    const c = item('repeat-paper', 3);
    expect(scoreCategory(c, 'gemini', choose(c, '5040', { workflow: workflow(c, '5040') }))).toMatchObject({
      semanticCategoryCorrect: false,
      completeJournalCorrect: false,
    });
  });
  it('checks earned-income direction and fixed bank identity independently of the expense pattern', () => {
    const c = item('unseen-consulting-receipt');
    const receipt = {
      entry: {
        date: c.input.facts.date!,
        description: c.input.facts.description,
        counterparty: c.input.facts.counterparty,
        reference: '',
        source: 'AI' as const,
        lines: [
          { accountId: accountId('1010'), debit: '625', credit: '0', exchangeRate: '1', memo: '' },
          { accountId: accountId('4020'), debit: '0', credit: '625', exchangeRate: '1', memo: '' },
        ],
      },
      posted: false,
    };
    expect(scoreCategory(c, 'gemini', choose(c, '4020', { workflow: receipt }))).toMatchObject({
      selectorSuccess: true,
      completeJournalCorrect: true,
      counterAccountCorrect: true,
    });
    receipt.entry.lines = receipt.entry.lines.map((line) => ({
      ...line,
      debit: line.credit,
      credit: line.debit,
    }));
    expect(scoreCategory(c, 'gemini', choose(c, '4020', { workflow: receipt }))).toMatchObject({
      selectorSuccess: true,
      completeJournalCorrect: false,
      counterAccountCorrect: false,
    });
  });
  it('rejects generated entries during clarification and any posting authority', () => {
    const c = item('missing-party-dev');
    const scored = scoreCategory(
      c,
      'gemini',
      choose(c, '5060', {
        attempts: 0,
        result: { decision: 'CLARIFY', topic: 'funding_account', question: 'Which account?' },
        workflow: workflow(c, '5060'),
      }),
    );
    expect(scored).toMatchObject({ unsafeSuggestion: true, workflowHandlingSuccess: false });
    const ready = item('repeat-paper', 3);
    expect(
      scoreCategory(
        ready,
        'gemini',
        choose(ready, '5070', { workflow: { ...workflow(ready, '5070'), posted: true } }),
      ).unsafeSuggestion,
    ).toBe(true);
  });
});

describe('Attempts, costs and uncertainty', () => {
  it('preserves missing/errors in the denominator and rejects replacing, duplicating or adding an unknown attempt', () => {
    const cases = categoryCases.filter((c) => c.sequenceId === 'repeat-paper');
    const observations = [
      choose(cases[0], '5030'),
      choose(cases[1], '5070', {
        status: 'error',
        result: null,
        errorCode: 'AI_TIMEOUT',
        reportedCostUsd: null,
        reservedUnknownUsd: '0.001',
      }),
    ];
    const summary = summarizeCategory(scoreCategoryMatrix(cases, observations, ['gemini']));
    expect(summary).toMatchObject({
      planned: 3,
      observed: 2,
      errors: 1,
      missing: 1,
      selectorEligible: 3,
      selectorSuccesses: 1,
    });
    expect(() => scoreCategoryMatrix(cases, [observations[0], observations[0]], ['gemini'])).toThrow(
      /duplicated/,
    );
    expect(() =>
      scoreCategoryMatrix(cases, [{ ...observations[0], caseId: 'not-planned' }], ['gemini']),
    ).toThrow(/Unknown/);
  });
  it('requires the identical visible input and detects fixture mutations after hashing', () => {
    const c = structuredClone(item('repeat-paper'));
    expect(scoreCategory(c, 'gemini', choose(c, '5030', { inputHash: 'wrong' })).selectorSuccess).toBe(false);
    c.input.facts.amount = '999';
    expect(scoreCategory(c, 'gemini', choose(c, '5030')).inputVerified).toBe(false);
  });
  it('retains exact unknown-cost reservations and never turns missing paid latency or usage into zero', () => {
    const c = item('repeat-paper');
    const rows = [
      choose(c, '5030', { reportedCostUsd: '0.1', latencyMs: 0 }),
      choose(c, '5030', {
        reportedCostUsd: null,
        reservedUnknownUsd: '0.2',
        latencyMs: null,
        status: 'error',
        result: null,
      }),
    ];
    expect(summarizeCategoryCosts(rows)).toMatchObject({
      reportedUsd: '0.1',
      reservedUnknownUsd: '0.2',
      trackedUsd: '0.3',
      actualAttempts: 2,
      unknownCostAttempts: 1,
      unreservedUnknownAttempts: 0,
      paidLatencyObserved: 1,
      paidLatencyMissing: 1,
      paidLatencyP50Ms: 0,
    });
    expect(summarizeCategoryCosts([{ ...rows[1], reservedUnknownUsd: null }]).unreservedUnknownAttempts).toBe(
      1,
    );
    expect(() => summarizeCategoryCosts([{ ...rows[0], reservedUnknownUsd: '0.2' }])).toThrow(/overlap/);
    expect(() => summarizeCategoryCosts([{ ...rows[0], reportedCostUsd: '-1' }])).toThrow(/Invalid/);
  });
  it('uses paired sequence intervals and returns no interval for a single group', () => {
    expect(pairedSequenceInterval([1])).toBeNull();
    expect(pairedSequenceInterval([1, 1, 1])).toEqual([1, 1]);
    expect(pairedSequenceInterval([-1, 0, 1])).toEqual(pairedSequenceInterval([-1, 0, 1]));
    expect(() => pairedSequenceInterval([Number.NaN, 0])).toThrow();
  });
});
