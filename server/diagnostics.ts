import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { databaseCode, type FailureStage } from './errors';

export type RequestContext = {
  requestId: string;
  method: string;
  // Resolve the registered Express route after routing; never use the user-supplied URL.
  route: () => string;
};
const requests = new AsyncLocalStorage<RequestContext>();
export function withRequestContext<T>(context: RequestContext, operation: () => T): T {
  return requests.run(context, operation);
}

export const requestDiagnostics: RequestHandler = (req, res, next) => {
  const requestId = randomUUID(),
    start = performance.now();
  res.setHeader('X-Request-Id', requestId);
  res.locals.requestId = requestId;
  const context = { requestId, method: req.method, route: () => routeTemplate(req.route?.path) };
  res.locals.diagnosticContext = context;
  let finished = false;
  res.on('finish', () => {
    finished = true;
    if (process.env.NODE_ENV !== 'test')
      diagnostic(
        'http_request',
        {
          status: res.statusCode,
          code: res.locals.errorCode,
          stage: res.locals.errorStage,
          durationMs: Math.round(performance.now() - start),
        },
        context,
      );
  });
  res.on('close', () => {
    if (!finished)
      diagnostic(
        'request_error',
        { code: 'REQUEST_ABORTED', stage: 'internal', durationMs: Math.round(performance.now() - start) },
        context,
      );
  });
  withRequestContext(context, next);
};

const codes = new Set(
  `AI_AUTH_ERROR AI_BUDGET_EXCEEDED AI_BUSY AI_CONNECTION_ERROR AI_INVALID_RESPONSE
AI_MODEL_UNAVAILABLE AI_NOT_CONFIGURED AI_PROVIDER_ERROR AI_RATE_LIMIT AI_REQUEST_REJECTED
AI_SERVICE_UNAVAILABLE AI_TIMEOUT AI_USAGE_UNAVAILABLE UNSUPPORTED_TOOL CHART_TOO_LARGE
ACCOUNTING_RULE ACCOUNT_LIMIT BODY_TOO_LARGE CONCURRENT_CHANGE DATABASE_UNAVAILABLE
IDEMPOTENCY_KEY_REQUIRED INTERNAL_ERROR INVALID_DATE_RANGE INVALID_INPUT INVALID_JSON NOT_FOUND
QUERY_TIMEOUT RECORD_IN_USE DUPLICATE_RECORD AMOUNT_TOO_SMALL CONFIRM_EXCHANGE_RATES CURRENCY_PRECISION
IDEMPOTENCY_CONFLICT IMMUTABLE_ENTRY INVALID_ACCOUNT INVALID_AMOUNT INVALID_CURSOR INVALID_EXCHANGE_RATE
INVALID_REVERSAL_DATE NOT_POSTED STALE_DRAFT UNBALANCED_ENTRY INVALID_SCHEDULE SCHEDULE_ANCHOR_FIXED
SCHEDULE_LIMIT STALE_SCHEDULE GROUP_LEDGER METHOD_NOT_ALLOWED SCHEDULE_UNAVAILABLE UNAUTHORIZED
INVALID_PROPOSAL PROPOSAL_NOT_FOUND PROPOSAL_BINDING_INVALID PROPOSAL_ALREADY_USED PROPOSAL_EXPIRED
CORRECTION_REQUIRES_POSTING CORRECTION_REVIEW_CHANGED REVIEWED_POSTING_REQUIRED ALERT_RESOLVED
DATABASE_ERROR WORKER_ERROR REQUEST_ABORTED UNKNOWN_ERROR`.split(/\s+/),
);
const networkCodes = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const stages = new Set<FailureStage>([
  'http_validation',
  'application_validation',
  'provider_http',
  'provider_transport',
  'provider_timeout',
  'model_response',
  'model_json',
  'model_schema',
  'model_semantic',
  'account_validation',
  'database',
  'financial_tool',
  'background',
  'internal',
]);
type DiagnosticEvent =
  | 'http_request'
  | 'request_error'
  | 'ai_provider_failure'
  | 'ai_request_failed'
  | 'ai_category_result'
  | 'database_pool'
  | 'database_rollback_failed'
  | 'worker_error';
type DiagnosticFields = {
  code?: string;
  stage?: FailureStage;
  status?: number;
  durationMs?: number;
  operation?:
    | 'category'
    | 'proposal'
    | 'financial_tool'
    | 'anomaly_analysis'
    | 'anomaly_heartbeat'
    | 'recurring_generation';
  jobId?: string | number;
  provider?: 'gemini' | 'openai' | 'jev' | 'reference';
  model?: string;
  modelVersion?: string;
  decision?: 'SELECT' | 'CLARIFY' | 'UNSUPPORTED';
  attempts?: number;
  failureClass?: 'http' | 'transport' | 'timeout' | 'provider';
  upstreamStatus?: number | null;
  transportCode?: string;
  databaseCode?: string;
};

export function routeTemplate(value: unknown): string {
  // Values must come from the registered route, not req.path/req.originalUrl.
  return typeof value === 'string' && /^\/api(?:\/[a-zA-Z0-9:_-]+)*$/.test(value) ? value : 'unmatched';
}
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const httpStatus = (value: unknown) => count(value) && (value as number) >= 100 && (value as number) <= 599;

// Deliberately serialize selected fields, never spread an error/request/provider body.
export function diagnostic(
  event: DiagnosticEvent,
  fields: DiagnosticFields = {},
  context = requests.getStore(),
) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.DAYBOOK_SOURCE_COMMIT;
  const deployment = process.env.VERCEL_DEPLOYMENT_ID;
  const output: Record<string, unknown> = {
    event,
    timestamp: new Date().toISOString(),
    deploymentRevision: typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit) ? commit : 'unknown',
  };
  if (typeof deployment === 'string' && /^dpl_[A-Za-z0-9]{8,80}$/.test(deployment))
    output.deploymentId = deployment;
  if (context) {
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(context.requestId))
      output.requestId = context.requestId;
    output.method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(context.method)
      ? context.method
      : 'OTHER';
    output.route = routeTemplate(context.route());
  }
  if (fields.code !== undefined) output.code = codes.has(fields.code) ? fields.code : 'UNKNOWN_ERROR';
  if (fields.stage !== undefined) output.stage = stages.has(fields.stage) ? fields.stage : 'internal';
  if (httpStatus(fields.status)) output.status = fields.status;
  if (count(fields.durationMs)) output.durationMs = fields.durationMs;
  if (
    [
      'category',
      'proposal',
      'financial_tool',
      'anomaly_analysis',
      'anomaly_heartbeat',
      'recurring_generation',
    ].includes(fields.operation ?? '')
  )
    output.operation = fields.operation;
  const jobId =
    typeof fields.jobId === 'number'
      ? Number.isSafeInteger(fields.jobId) && fields.jobId > 0
        ? String(fields.jobId)
        : ''
      : fields.jobId;
  if (typeof jobId === 'string' && /^[1-9][0-9]{0,18}$/.test(jobId) && BigInt(jobId) <= 9223372036854775807n)
    output.jobId = jobId;
  if (['gemini', 'openai', 'jev', 'reference'].includes(fields.provider ?? ''))
    output.provider = fields.provider;
  if (fields.model !== undefined)
    output.model = /^(?:gemini-|gpt-|jev-|exact-memory-label-rules-|o[1-9])[-a-zA-Z0-9._:]{0,150}$/.test(
      fields.model,
    )
      ? fields.model
      : 'invalid';
  if (
    fields.modelVersion !== undefined &&
    /^(?:gemini-|jev-|exact-memory-label-rules-)[-a-zA-Z0-9._:]{0,150}$/.test(fields.modelVersion)
  )
    output.modelVersion = fields.modelVersion;
  if (['SELECT', 'CLARIFY', 'UNSUPPORTED'].includes(fields.decision ?? '')) output.decision = fields.decision;
  if (fields.attempts === 0 || fields.attempts === 1) output.attempts = fields.attempts;
  if (['http', 'transport', 'timeout', 'provider'].includes(fields.failureClass ?? ''))
    output.failureClass = fields.failureClass;
  if (fields.upstreamStatus === null || httpStatus(fields.upstreamStatus))
    output.upstreamStatus = fields.upstreamStatus;
  if (networkCodes.has(fields.transportCode ?? '')) output.transportCode = fields.transportCode;
  // Database callers supply only databaseCode() output; this second gate excludes free-form messages.
  const safeDatabaseCode = databaseCode({ code: fields.databaseCode });
  if (safeDatabaseCode) output.databaseCode = safeDatabaseCode;
  if (event === 'http_request' || event === 'ai_category_result') console.log(JSON.stringify(output));
  else console.error(JSON.stringify(output));
}
