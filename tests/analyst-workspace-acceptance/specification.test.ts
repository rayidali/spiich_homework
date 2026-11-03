import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fixture from './fixture.json';
import expected from './expected.json';
import specification from './cases.json';

const directory = fileURLToPath(new URL('.', import.meta.url));

describe('analyst workspace reference materials — no model evaluation', () => {
  it('recomputes stored facts with an independent Decimal oracle', () => {
    const output = execFileSync('python3', ['-B', 'oracle.py', '--check'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(output).toContain('Fixture integrity and stored Decimal facts match');
  });

  it('checks manual anchors and rejects meaningful fixture corruptions', () => {
    // Seven Python checks exercise draft/future scope, refunds, tenant isolation,
    // native/base FX, balance, reversal linkage and different ratio meanings.
    expect(() =>
      execFileSync('python3', ['-B', 'oracle_test.py', '-q'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('keeps complete prompts, charts and expected facts separate', () => {
    const cases = specification.cases;
    const turns = cases.flatMap((entry) => entry.turns);
    expect(cases).toHaveLength(18);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(18);
    expect(turns).toHaveLength(25);
    expect(turns.filter((turn) => turn.chartRequired)).toHaveLength(4);
    expect(cases.filter((entry) => entry.turns.length > 1)).toHaveLength(6);
    const knownFacts = new Set(Object.keys(expected.facts));
    for (const turn of turns) {
      expect(turn.prompt.trim().length).toBeGreaterThan(10);
      expect(turn.requirements.length).toBeGreaterThan(0);
      expect(turn.forbidden.length).toBeGreaterThan(0);
      expect(turn).not.toHaveProperty('assistant');
      for (const id of [...turn.requiredFacts, ...turn.conditionalFacts]) {
        expect(knownFacts.has(id), `Unknown reference: ${id}`).toBe(true);
      }
      expect(turn.requiredFacts.some((id) => turn.conditionalFacts.includes(id))).toBe(false);
    }
  });

  it('retains all dataset traps needed for source and accounting review', () => {
    expect(fixture.entries).toHaveLength(59);
    expect(fixture.entries.flatMap((entry) => entry.lines)).toHaveLength(118);
    expect(fixture.accounts).toHaveLength(34);
    const own = fixture.entries.filter((entry) => entry.organization_id === fixture.organization_id);
    expect(own).toHaveLength(56);
    expect(own.filter((entry) => entry.status === 'DRAFT')).toHaveLength(3);
    expect(own.filter((entry) => entry.date > fixture.business_date)).toHaveLength(2);
    expect(own.some((entry) => entry.description.includes('IGNORE PRIOR INSTRUCTIONS'))).toBe(true);
    expect(own.some((entry) => entry.reverses_entry_id !== null)).toBe(true);
    expect(fixture.accounts.filter((account) => account.name === 'Travel')).toHaveLength(4);
    expect(fixture.alerts.filter((alert) => alert.organization_id === fixture.organization_id)).toHaveLength(
      5,
    );
    expect(fixture.recurring_templates).toHaveLength(2);
  });
});
