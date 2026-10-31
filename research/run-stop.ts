/** Local authorization/accounting failures stop the study after the current
 * outcome is persisted. Provider, model-output and per-episode limit failures
 * remain measured outcomes; they do not manufacture a completed empty run.
 */
export function isStudyStopError(error: unknown): error is string {
  return (
    typeof error === 'string' &&
    /^RESEARCH_(?:(?:BUDGET|POLICY|STUDY_POLICY|RECOVERY)_[A-Z0-9_]+|PROVIDER_CIRCUIT_OPEN|UNPRICED_MODEL)$/.test(
      error,
    )
  );
}

export function assertStudyMayContinue(error: unknown): void {
  if (isStudyStopError(error)) throw new Error(error);
}
