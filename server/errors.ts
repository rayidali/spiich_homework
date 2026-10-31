export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type FailureStage =
  | 'http_validation'
  | 'application_validation'
  | 'provider_http'
  | 'provider_transport'
  | 'provider_timeout'
  | 'model_response'
  | 'model_json'
  | 'model_schema'
  | 'model_semantic'
  | 'account_validation'
  | 'database'
  | 'financial_tool'
  | 'background'
  | 'internal';

// Diagnostic classification must not become API details or retain a raw cause.
const stages = new WeakMap<object, FailureStage>();
export function failureStage(error: unknown): FailureStage | undefined {
  return error !== null && typeof error === 'object' ? stages.get(error) : undefined;
}
export function markFailure<T>(error: T, stage: FailureStage): T {
  if (error !== null && typeof error === 'object' && !stages.has(error)) stages.set(error, stage);
  return error;
}
export async function duringStage<T>(stage: FailureStage, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw markFailure(error, stage);
  }
}

const databaseCodes = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '08004',
  '08P01',
  '22003',
  '22007',
  '22008',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
  '25006',
  '25P02',
  '28000',
  '28P01',
  '40001',
  '40P01',
  '42501',
  '42601',
  '42703',
  '42P01',
  '53300',
  '53400',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
export function databaseCode(error: unknown): string | undefined {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && databaseCodes.has(code) ? code : undefined;
}
export function required<T>(value: T | undefined, message = 'Record not found'): T {
  if (value === undefined) throw new AppError(404, 'NOT_FOUND', message);
  return value;
}
