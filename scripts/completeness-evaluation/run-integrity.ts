/** Final report admission, independent of whether a full score table exists.
 * No I/O, spending authorization, source reads or fingerprint reconstruction. */
import { Decimal } from '../../shared/money';
import { PROTOCOL } from './protocol';
import type { EvaluationTransportSummary } from './transport';
import type { EvaluationSplit } from './types';

export type FinalizeRunIntegrityInput = {
  phase: EvaluationSplit;
  failure: string | null;
  plannedExecutions: number;
  completedExecutions: number;
  sourceHash: string;
  finalSourceHash: string | null;
  initialFingerprint: unknown;
  finalFingerprint: unknown;
  budget: EvaluationTransportSummary | null | undefined;
};
export type RunIntegrity = { complete: boolean; failure: string | null };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const decimal = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,16}(?:\.\d{1,12})?$/.test(value);
const fingerprintKeys = ['sha256', 'organizations', 'accounts', 'entries', 'lines', 'scope'] as const;
function fingerprint(value: unknown): value is Record<(typeof fingerprintKeys)[number], unknown> {
  return (
    object(value) &&
    Object.keys(value).length === fingerprintKeys.length &&
    fingerprintKeys.every((key) => Object.hasOwn(value, key)) &&
    hash(value.sha256) &&
    value.scope === 'full_org_account_entry_line_rows' &&
    ['organizations', 'accounts', 'entries', 'lines'].every((key) => integer(value[key]))
  );
}
const failed = (failure: string): RunIntegrity => ({ complete: false, failure });
export function finalizeRunIntegrity(input: FinalizeRunIntegrityInput): RunIntegrity {
  // Do not replace the original causal failure with a later cleanup/accounting error.
  if (input.failure !== null)
    return failed(
      typeof input.failure === 'string' ? input.failure : 'COMPLETENESS_EXISTING_FAILURE_INVALID',
    );
  if (input.phase !== 'development' && input.phase !== 'holdout') return failed('COMPLETENESS_PHASE_INVALID');
  const limits = PROTOCOL.phases[input.phase];
  if (
    !integer(input.plannedExecutions) ||
    input.plannedExecutions !== limits.executions ||
    !integer(input.completedExecutions) ||
    input.completedExecutions !== input.plannedExecutions
  )
    return failed('COMPLETENESS_EXECUTIONS_INCOMPLETE');
  if (!hash(input.sourceHash) || !hash(input.finalSourceHash))
    return failed('COMPLETENESS_FINAL_SOURCE_INVALID');
  if (input.sourceHash !== input.finalSourceHash) return failed('COMPLETENESS_SOURCE_DRIFT');
  const { initialFingerprint, finalFingerprint } = input;
  if (!fingerprint(initialFingerprint) || !fingerprint(finalFingerprint))
    return failed('COMPLETENESS_FINAL_FINGERPRINT_INVALID');
  if (fingerprintKeys.some((key) => initialFingerprint[key] !== finalFingerprint[key]))
    return failed('COMPLETENESS_BOOKS_CHANGED');
  const budget = input.budget;
  if (
    !budget ||
    budget.state !== 'closed' ||
    budget.haltReason !== null ||
    budget.pending !== 0 ||
    budget.activeTrial !== null ||
    !integer(budget.attempts) ||
    !decimal(budget.knownUsd) ||
    !decimal(budget.unknownReservedUsd) ||
    !decimal(budget.chargedUsd)
  )
    return failed('COMPLETENESS_FINAL_ACCOUNTING_INVALID');
  const known = new Decimal(budget.knownUsd),
    unknown = new Decimal(budget.unknownReservedUsd),
    charged = new Decimal(budget.chargedUsd);
  if (
    !unknown.eq(0) ||
    !known.plus(unknown).eq(charged) ||
    !known.eq(charged) ||
    (budget.attempts === 0 && !charged.eq(0))
  )
    return failed('COMPLETENESS_FINAL_ACCOUNTING_INVALID');
  if (budget.attempts > limits.maxAttempts || charged.gt(limits.ceilingUsd))
    return failed('COMPLETENESS_PHASE_BUDGET_EXCEEDED');
  return { complete: true, failure: null };
}
