import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { config } from './config';
import { query } from './db';
import { AppError, databaseCode, failureStage, required } from './errors';
import { diagnostic, requestDiagnostics } from './diagnostics';
import { accounts, createEntry, getEntry, listEntries, postEntry, reverseEntry, updateDraft } from './ledger';
import { accountSchema, entrySchema, recurringSchema, dateSchema } from '../shared/schema';
import {
  accountLedger,
  balanceSheet,
  dashboard,
  incomeStatement,
  monthStart,
  reportSnapshot,
  today,
  trialBalance,
} from './reports';
import { createRecurring, generateRecurring, updateRecurring } from './recurring';
import { financialChat, messagesSchema, proposeEntry } from './ai';
import { learningForEntry, revokeCorrection } from './categorization-memory';

export function createApp(org = config.organizationId) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestDiagnostics);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '128kb' }));
  const key = (req: express.Request) => {
    const result = z.string().min(8).max(128).safeParse(req.get('Idempotency-Key'));
    if (!result.success)
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header of 8 to 128 characters',
      );
    return result.data;
  };
  const id = (req: express.Request) => z.uuid().parse(req.params.id);
  const range = (req: express.Request) => {
    const p = z
      .object({ from: dateSchema.default(monthStart()), to: dateSchema.default(today()) })
      .parse(req.query);
    if (p.from > p.to)
      throw new AppError(400, 'INVALID_DATE_RANGE', 'Start date must be on or before end date');
    return p;
  };
  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.get('/api/meta', async (_req, res) => {
    const organization = required(
      (await query('SELECT id,name,base_currency,timezone FROM organizations WHERE id=$1', [org]))[0],
    );
    res.json({
      organization,
      today: today(),
      ai: {
        available: Boolean(config.aiKey),
        provider: config.aiProvider,
        model: config.aiKey ? config.aiModel : null,
      },
      valuation: 'Recorded exchange rates',
      alertCount: Number(
        (await query("SELECT count(*) AS n FROM alerts WHERE organization_id=$1 AND status='OPEN'", [org]))[0]
          .n,
      ),
      demo: process.env.SEED_DEMO !== 'false',
    });
  });
  app.get('/api/dashboard', async (req, res) => {
    const p = range(req);
    res.json(await dashboard(org, p.from, p.to));
  });
  app.get('/api/accounts', async (req, res) =>
    res.json(await accounts(org, dateSchema.optional().parse(req.query.asOf))),
  );
  app.post('/api/accounts', async (req, res) => {
    const a = accountSchema.parse(req.body);
    if (
      Number((await query('SELECT count(*) AS n FROM accounts WHERE organization_id=$1', [org]))[0].n) >= 250
    )
      throw new AppError(422, 'ACCOUNT_LIMIT', 'This workspace supports up to 250 accounts');
    res
      .status(201)
      .json(
        (
          await query(
            `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_group,is_cash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [org, a.code, a.name, a.type, a.currency, a.parentId, a.isGroup, a.isCash],
          )
        )[0],
      );
  });
  app.put('/api/accounts/:id', async (req, res) => {
    const a = accountSchema.parse(req.body);
    res.json(
      required(
        (
          await query(
            `UPDATE accounts SET code=$3,name=$4,type=$5,currency=$6,parent_id=$7,is_group=$8,is_cash=$9 WHERE organization_id=$1 AND id=$2 RETURNING *`,
            [org, id(req), a.code, a.name, a.type, a.currency, a.parentId, a.isGroup, a.isCash],
          )
        )[0],
      ),
    );
  });
  app.patch('/api/accounts/:id', async (req, res) => {
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    res.json(
      required(
        (
          await query('UPDATE accounts SET archived=$3 WHERE organization_id=$1 AND id=$2 RETURNING *', [
            org,
            id(req),
            archived,
          ])
        )[0],
      ),
    );
  });
  app.delete('/api/accounts/:id', async (req, res) => {
    required(
      (
        await query('DELETE FROM accounts WHERE organization_id=$1 AND id=$2 RETURNING id', [org, id(req)])
      )[0],
    );
    res.status(204).end();
  });
  app.get('/api/accounts/:id/ledger', async (req, res) => {
    const p = range(req);
    res.json(
      await accountLedger(org, id(req), p.from, p.to, z.string().max(300).optional().parse(req.query.cursor)),
    );
  });

  app.get('/api/entries', async (req, res) => {
    const filter = z
      .object({
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        search: z.string().max(100).optional(),
        status: z.enum(['DRAFT', 'POSTED']).optional(),
        accountId: z.uuid().optional(),
        currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'JPY']).optional(),
        cursor: z.string().max(300).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(req.query);
    if (filter.from && filter.to && filter.from > filter.to)
      throw new AppError(400, 'INVALID_DATE_RANGE', 'Start date must be before end date');
    res.json(await listEntries(org, filter));
  });
  app.get('/api/entries/:id', async (req, res) => {
    const entry = await getEntry(org, id(req));
    res.json(
      entry.source === 'AI' && entry.status === 'POSTED'
        ? { ...entry, categorizationLearning: await learningForEntry(org, entry.id) }
        : entry,
    );
  });
  app.post('/api/entries', async (req, res) =>
    res.status(201).json(
      await createEntry(org, entrySchema.parse(req.body), key(req), {
        proposalId: z.uuid().optional().parse(req.body.proposalId),
      }),
    ),
  );
  app.put('/api/entries/:id', async (req, res) =>
    res.json(
      await updateDraft(
        org,
        id(req),
        entrySchema.parse(req.body),
        z.number().int().positive().parse(req.body.expectedRevision),
        z.uuid().optional().parse(req.body.proposalId),
      ),
    ),
  );
  app.post('/api/entries/:id/post', async (req, res) => {
    const expectedRevision = z.number().int().positive().parse(req.body?.expectedRevision);
    res.json(await postEntry(org, id(req), expectedRevision, req.body?.exchangeRatesConfirmed === true));
  });
  app.post('/api/entries/:id/reverse', async (req, res) => {
    const p = z.object({ date: dateSchema }).parse(req.body);
    res.status(201).json(await reverseEntry(org, id(req), p.date, key(req)));
  });

  app.get('/api/reports/:kind', async (req, res) => {
    const kind = z.enum(['trial', 'income', 'balance']).parse(req.params.kind);
    const p =
      kind === 'balance'
        ? { from: '1900-01-01', to: dateSchema.default(today()).parse(req.query.to) }
        : range(req);
    res.json(
      await reportSnapshot(async (db) =>
        kind === 'trial'
          ? await trialBalance(org, p.from, p.to, db)
          : kind === 'income'
            ? await incomeStatement(org, p.from, p.to, db)
            : await balanceSheet(org, p.to, db),
      ),
    );
  });
  app.get('/api/recurring', async (_req, res) =>
    res.json(
      await query(
        'SELECT * FROM recurring_templates WHERE organization_id=$1 ORDER BY active DESC,next_date,id LIMIT 200',
        [org],
      ),
    ),
  );
  app.post('/api/recurring', async (req, res) =>
    res.status(201).json(await createRecurring(org, recurringSchema.parse(req.body), key(req))),
  );
  app.put('/api/recurring/:id', async (req, res) =>
    res.json(
      await updateRecurring(
        org,
        id(req),
        recurringSchema.parse(req.body),
        z.number().int().positive().parse(req.body.expectedRevision),
      ),
    ),
  );
  app.patch('/api/recurring/:id', async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    res.json(
      required(
        (
          await query(
            'UPDATE recurring_templates SET active=$3 WHERE organization_id=$1 AND id=$2 RETURNING *',
            [org, id(req), active],
          )
        )[0],
      ),
    );
  });
  app.post('/api/recurring/generate', async (_req, res) => res.json(await generateRecurring(org)));
  app.get('/api/alerts', async (req, res) => {
    const status = z.enum(['OPEN', 'DISMISSED', 'RESOLVED']).default('OPEN').parse(req.query.status);
    res.json(
      await query(
        `SELECT a.*,e.number,e.description AS entry_description,e.date FROM alerts a JOIN journal_entries e ON e.id=a.entry_id WHERE a.organization_id=$1 AND a.status=$2 ORDER BY a.created_at DESC LIMIT 100`,
        [org, status],
      ),
    );
  });
  app.patch('/api/alerts/:id', async (req, res) => {
    const { status } = z.object({ status: z.enum(['OPEN', 'DISMISSED']) }).parse(req.body);
    const updated = await query(
      "UPDATE alerts SET status=$3 WHERE organization_id=$1 AND id=$2 AND resolved_at IS NULL AND status<>'RESOLVED' RETURNING *",
      [org, id(req), status],
    );
    if (!updated[0]) {
      required((await query('SELECT id FROM alerts WHERE organization_id=$1 AND id=$2', [org, id(req)]))[0]);
      throw new AppError(
        409,
        'ALERT_RESOLVED',
        'This alert no longer applies. Refresh the list to see its resolution.',
      );
    }
    res.json(updated[0]);
  });
  app.post('/api/ai/entry', async (req, res) => {
    const p = z.object({ messages: messagesSchema, date: dateSchema }).parse(req.body);
    res.json(await proposeEntry(org, p.messages, p.date));
  });
  app.post('/api/ai/chat', async (req, res) => {
    const p = z.object({ messages: messagesSchema }).parse(req.body);
    res.json(await financialChat(org, p.messages));
  });
  app.post('/api/ai/feedback', async () => {
    throw new AppError(
      410,
      'REVIEWED_POSTING_REQUIRED',
      'Category choices are remembered when you post a reviewed AI entry. Separate feedback samples are no longer accepted.',
    );
  });
  app.delete('/api/ai/corrections/:id', async (req, res) => {
    await revokeCorrection(org, id(req));
    res.status(204).end();
  });
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'API route not found')));
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use(apiErrorHandler);
  return app;
}

export function apiErrorHandler(
  error: unknown,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  let status = 500,
    code = 'INTERNAL_ERROR',
    message = 'Something went wrong. Please try again.',
    details: unknown;
  if (error instanceof AppError) {
    ({ status, code, message, details } = error);
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'INVALID_INPUT';
    message = error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    details = error.issues;
  } else if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
    status = 413;
    code = 'BODY_TOO_LARGE';
    message = 'The request body exceeds 128 KB';
  } else if (error && typeof error === 'object' && 'code' in error) {
    const pg = error as { code: string };
    if (pg.code === '23514') {
      status = 422;
      code = 'ACCOUNTING_RULE';
      message = 'This operation violates an accounting rule';
    } else if (pg.code === '23505') {
      status = 409;
      code = 'DUPLICATE_RECORD';
      message = 'This code or record already exists. An entry can only be reversed once.';
    } else if (pg.code === '23503') {
      status = 409;
      code = 'RECORD_IN_USE';
      message = 'This record is referenced by other records. Archive a used account instead of deleting it.';
    } else if (pg.code === '57014') {
      status = 503;
      code = 'QUERY_TIMEOUT';
      message = 'The query took too long. Try a narrower date range.';
    } else if (['40P01', '40001'].includes(pg.code)) {
      status = 409;
      code = 'CONCURRENT_CHANGE';
      message = 'Another change happened at the same time. Please retry this operation.';
    } else if (
      [
        '08000',
        '08001',
        '08003',
        '08006',
        '08004',
        '08P01',
        '53300',
        '53400',
        '57P01',
        '57P02',
        '57P03',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
      ].includes(pg.code)
    ) {
      status = 503;
      code = 'DATABASE_UNAVAILABLE';
      message = 'The database is temporarily unavailable. Please try again shortly.';
    }
  } else if (error instanceof SyntaxError) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON';
  }
  const stage =
    failureStage(error) ??
    (databaseCode(error)
      ? 'database'
      : error instanceof AppError
        ? 'application_validation'
        : status < 500
          ? 'http_validation'
          : 'internal');
  res.locals.errorCode = code;
  res.locals.errorStage = stage;
  const operation =
    req.route?.path === '/api/ai/entry'
      ? 'proposal'
      : req.route?.path === '/api/ai/chat'
        ? 'financial_tool'
        : undefined;
  diagnostic(
    'request_error',
    {
      code,
      stage,
      status,
      databaseCode: databaseCode(error),
      ...(operation ? { operation, provider: config.aiProvider, model: config.aiModel } : {}),
    },
    res.locals.diagnosticContext,
  );
  res.status(status).json({ error: { code, message, details, requestId: res.locals.requestId } });
}
