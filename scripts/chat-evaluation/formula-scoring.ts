import { Decimal } from '../../shared/money';
import type { ScenarioCalculationFact, ScenarioReference } from '../../server/financial-calculation';
import type { EvaluationCase } from './types';
import type { ScoredFact } from './scoring';
import { hash } from './io';
// Sparse symbolic polynomials preserve operand identity. Merely matching a final dollar value cannot pass.
type Poly = Map<string, Decimal>;
const constant = (v: string) => new Map([['', new Decimal(v)]]);
const variable = (v: string) => new Map([[v, new Decimal(1)]]);
function add(a: Poly, b: Poly, sign = 1) {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, (out.get(k) ?? new Decimal(0)).plus(v.times(sign)));
  return out;
}
function multiply(a: Poly, b: Poly) {
  const out: Poly = new Map();
  for (const [ak, av] of a)
    for (const [bk, bv] of b) {
      const k = [...ak.split('|'), ...bk.split('|')].filter(Boolean).sort().join('|');
      out.set(k, (out.get(k) ?? new Decimal(0)).plus(av.times(bv)));
    }
  return out;
}
const signature = (p: Poly) =>
  JSON.stringify(
    [...p]
      .filter(([, v]) => !v.isZero())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.toString()]),
  );
function operate(op: string, args: Poly[]): Poly {
  if (op === 'sum' || op === 'add') return args.reduce((a, b) => add(a, b), constant('0'));
  if (op === 'product' || op === 'multiply') return args.reduce(multiply, constant('1'));
  if (op === 'difference' || op === 'subtract') {
    if (args.length !== 2) throw Error('FORMULA_ARITY');
    return add(args[0], args[1], -1);
  }
  // Non-polynomial division is deliberately unassessed, never reduced to its coincidental numeric answer.
  throw Error('FORMULA_UNSUPPORTED');
}
export function checkFormulaProvenance(
  c: EvaluationCase,
  calculations: ScenarioCalculationFact[],
  facts: ScoredFact[],
  scopeMatches: (expected: Record<string, unknown>, actual: Record<string, unknown>) => boolean,
) {
  try {
    const assumptions = new Map<string, ScenarioCalculationFact['assumptions'][number]>();
    for (const n of calculations)
      for (const a of n.assumptions) {
        const old = assumptions.get(a.id);
        if (old && JSON.stringify(old) !== JSON.stringify(a)) throw Error('ASSUMPTION_CONFLICT');
        assumptions.set(a.id, a);
      }
    const leaves: { value: string; unit: string; poly: Poly; source: 'query' | 'assumption' }[] = [];
    const assumptionPolys = new Map<string, Poly>(),
      queryPolys = new Map<string, Poly>();
    for (const [id, a] of assumptions) {
      if (
        !c.messages.some(
          (m, i) => m.role === 'user' && i === a.userMessageIndex && m.content.includes(a.sourceText),
        )
      )
        throw Error('UNSOURCED_ASSUMPTION');
      const p = variable(
        `a:${hash(JSON.stringify({ value: a.value, unit: a.unit, sourceText: a.sourceText })).slice(0, 20)}`,
      );
      assumptionPolys.set(id, p);
      leaves.push({ value: a.value, unit: a.unit, poly: p, source: 'assumption' });
    }
    for (const f of facts) {
      if (
        !c.expected.facts.some(
          (e) =>
            e.metric === f.metric &&
            e.unit === f.unit &&
            new Decimal(e.value).eq(f.value) &&
            scopeMatches(e.scope, f.scope),
        )
      )
        continue;
      const p = variable(
        `q:${hash(JSON.stringify({ metric: f.metric, unit: f.unit, scope: f.scope })).slice(0, 20)}`,
      );
      queryPolys.set(`${f.proof.queryId}/${f.proof.rowId}`, p);
      leaves.push({ value: f.value, unit: f.unit, poly: p, source: 'query' });
    }
    const actual = new Map<string, Poly>();
    function reference(r: ScenarioReference): Poly {
      const p =
        r.source === 'assumption'
          ? assumptionPolys.get(r.id)
          : r.source === 'calculation'
            ? actual.get(r.id)
            : r.field === 'value'
              ? queryPolys.get(`${r.id}/${r.rowId}`)
              : undefined;
      if (!p) throw Error('UNPROVEN_FORMULA_OPERAND');
      return p;
    }
    for (const n of calculations) {
      if (n.source !== 'scenario' || !n.hypothetical) throw Error('SCENARIO_SOURCE');
      actual.set(n.id, operate(n.operation, n.operands.map(reference)));
    }
    const earlier: { value: string; poly: Poly }[] = [];
    function expected(term: unknown): Poly {
      if (typeof term === 'string') {
        const previous = earlier.filter((x) => new Decimal(x.value).eq(term));
        if (previous.length === 1) return previous[0].poly;
        if (previous.length > 1) throw Error('AMBIGUOUS_REFERENCE');
        const matches = leaves.filter((x) => new Decimal(x.value).eq(term));
        if (matches.length === 1) return matches[0].poly;
        if (matches.length > 1) throw Error('AMBIGUOUS_LITERAL');
        // A stated percentage surcharge can be written either base + base*rate or base*(1+rate).
        const surcharge = leaves.filter(
          (x) => x.source === 'assumption' && x.unit === 'ratio' && new Decimal(x.value).plus(1).eq(term),
        );
        if (surcharge.length === 1) return add(constant('1'), surcharge[0].poly);
        throw Error('UNSOURCED_ORACLE_LITERAL');
      }
      if (!term || typeof term !== 'object') throw Error('FORMULA_SHAPE');
      const t = term as { operation: string; terms: unknown[] };
      if (!Array.isArray(t.terms)) throw Error('FORMULA_SHAPE');
      return operate(t.operation, t.terms.map(expected));
    }
    const checks = c.expected.formulas.map((raw) => {
      const f = raw as { operation: string; terms: unknown[]; value: string; unit: string };
      const p = expected(f);
      const matching = calculations.filter(
        (n) =>
          n.unit === f.unit &&
          new Decimal(n.value).eq(f.value) &&
          signature(actual.get(n.id)!) === signature(p),
      );
      earlier.push({ value: f.value, poly: p });
      return {
        expectedValue: f.value,
        unit: f.unit,
        passed: matching.length > 0,
        matchedCalculationIds: matching.map((n) => n.id),
      };
    });
    return {
      status: checks.length && checks.every((x) => x.passed) ? ('pass' as const) : ('fail' as const),
      checks,
      method:
        'symbolic operands, query scope and exact user-source assumptions; no model ID/name interpretation',
    };
  } catch {
    return {
      status: 'needs_review' as const,
      checks: [],
      method: 'Formula form or operand identity could not be established mechanically; no pass awarded',
    };
  }
}
