import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';

const scopeDate = z.string().date();
const scopeName = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value));
export const wrenRowScopeSchema = z
  .discriminatedUnion('supported', [
    z.object({ provenance: z.literal('ast-scope-v1'), supported: z.literal(false) }).strict(),
    z
      .object({
        provenance: z.literal('ast-scope-v1'),
        supported: z.literal(true),
        from: scopeDate.nullable(),
        toExclusive: scopeDate.nullable(),
        periodColumn: z
          .object({ name: scopeName, kind: z.enum(['month', 'date']) })
          .strict()
          .optional(),
        identityColumns: z
          .object({
            accountCode: scopeName.optional(),
            accountName: scopeName.optional(),
            vendor: scopeName.optional(),
            entryId: scopeName.optional(),
          })
          .strict()
          .optional(),
        fixedIdentity: z
          .object({
            accountCode: z.string().min(1).max(1000).optional(),
            accountName: z.string().min(1).max(1000).optional(),
            vendor: z.string().min(1).max(1000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  ])
  .refine(
    (scope) =>
      !scope.supported || scope.from === null || scope.toExclusive === null || scope.from < scope.toExclusive,
    'Scope boundaries must form a nonempty interval',
  );
export type WrenRowScope = z.infer<typeof wrenRowScopeSchema>;

const planned = z
  .object({
    ok: z.literal(true),
    id: z.literal('daybook'),
    engine: z.literal('wren-core-py'),
    engineVersion: z.literal('0.8.2'),
    sqlglotVersion: z.literal('30.27.0'),
    plannedSql: z.string().min(1).max(65_536),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    planningMs: z.number().nonnegative(),
    maxRows: z.literal(100),
    columnUnits: z.record(z.string(), z.enum(['USD', 'count', 'native', 'unsupported'])).optional(),
    unitProvenance: z.literal('ast-v1').optional(),
    nativeCurrency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'JPY']).optional(),
    currencyColumn: z.string().optional(),
    rowScope: wrenRowScopeSchema.default({ provenance: 'ast-scope-v1', supported: false }),
  })
  .strict();

export type WrenPlan = z.infer<typeof planned>;

/** No shell, credentials, application state, or LLM calls are available to the bridge. */
export async function planWithWren(
  sql: string,
  options: { python?: string; timeoutMs?: number } = {},
): Promise<WrenPlan> {
  if (Buffer.byteLength(JSON.stringify({ id: 'daybook', sql })) > 16_000) {
    throw new Error('WREN_REQUEST_SIZE');
  }
  const executable =
    options.python ?? process.env.RESEARCH_WREN_PYTHON ?? resolve('.tools/research/wren/venv/bin/python');
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5_000, 100), 10_000);
  return await new Promise<WrenPlan>((accept, reject) => {
    const child = spawn(executable, [resolve('research/wren/bridge.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // In particular: do not pass GEMINI_API_KEY, DATABASE_URL or provider tokens.
      env: {
        PATH: process.env.PATH,
        LANG: 'en_US.UTF-8',
        TZ: 'UTC',
        RUST_LOG: 'off',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    let output = '';
    let settled = false;
    const finish = (error?: Error, value?: WrenPlan) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else if (value) accept(value);
    };
    const timer = setTimeout(() => finish(new Error('WREN_TIMEOUT')), timeoutMs);
    child.on('error', () => finish(new Error('WREN_UNAVAILABLE')));
    child.stdin.on('error', () => finish(new Error('WREN_PROCESS_FAILED')));
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 128_000) finish(new Error('WREN_OUTPUT_SIZE'));
    });
    // Drain stderr without publishing raw native errors or candidate SQL.
    child.stderr.resume();
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error('WREN_PROCESS_FAILED'));
      try {
        const body: unknown = JSON.parse(output);
        const value = planned.safeParse(body);
        if (!value.success) return finish(new Error('WREN_PLAN_REJECTED'));
        finish(undefined, value.data);
      } catch {
        finish(new Error('WREN_RESPONSE_INVALID'));
      }
    });
    child.stdin.end(JSON.stringify({ id: 'daybook', sql }) + '\n');
  });
}
