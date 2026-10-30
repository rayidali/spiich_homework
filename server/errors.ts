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
export function required<T>(value: T | undefined, message = 'Record not found'): T {
  if (value === undefined) throw new AppError(404, 'NOT_FOUND', message);
  return value;
}
