import 'dotenv/config';

const selectedProvider =
  process.env.AI_PROVIDER?.trim() || (process.env.GEMINI_API_KEY?.trim() ? 'gemini' : 'openai');
if (selectedProvider !== 'gemini' && selectedProvider !== 'openai')
  throw new Error('AI_PROVIDER must be gemini or openai.');

const categoryProvider = process.env.CATEGORY_PROVIDER?.trim() || 'gemini';
if (!['gemini', 'jev', 'reference'].includes(categoryProvider))
  throw new Error('CATEGORY_PROVIDER must be gemini, jev or reference.');

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://spiich_app:spiich_app_local@127.0.0.1:55432/spiich',
  migrationUrl: process.env.MIGRATION_DATABASE_URL ?? 'postgres://spiich:spiich@127.0.0.1:55432/spiich',
  organizationId: process.env.ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000001',
  port: Number(process.env.PORT ?? 3001),
  listenHost: process.env.LISTEN_HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
  categoryProvider: categoryProvider as 'gemini' | 'jev' | 'reference',
  categoryKey:
    (categoryProvider === 'jev'
      ? process.env.TYPESAFE_API_KEY
      : categoryProvider === 'gemini'
        ? process.env.GEMINI_API_KEY
        : ''
    )?.trim() ?? '',
  aiProvider: selectedProvider as 'gemini' | 'openai',
  aiKey:
    (selectedProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? '',
  aiModel:
    process.env.AI_MODEL?.trim() || (selectedProvider === 'gemini' ? 'gemini-3.5-flash-lite' : 'gpt-6-luna'),
};
