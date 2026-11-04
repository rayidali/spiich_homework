import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class FixtureError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function requireFixture(condition: unknown, code: string): asserts condition {
  if (!condition) throw new FixtureError(code);
}

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export type FixtureLine = {
  account_id: string;
  account_code: string;
  position: number;
  currency: string;
  debit: string;
  credit: string;
  exchange_rate: string;
  base_debit: string;
  base_credit: string;
  memo: string;
};
export type FixtureEntry = {
  id: string;
  key: string;
  organization_id: string;
  number: number;
  date: string;
  description: string;
  counterparty: string;
  reference: string;
  status: 'DRAFT' | 'POSTED';
  source: string;
  reverses_entry_id: string | null;
  recurring_template_id: string | null;
  occurrence_date: string | null;
  lines: FixtureLine[];
};
export type Fixture = {
  version: number;
  business_date: string;
  organization_id: string;
  organizations: { id: string; key: string; name: string; base_currency: string; timezone: string }[];
  accounts: {
    id: string;
    organization_id: string;
    code: string;
    name: string;
    type: string;
    currency: string;
    is_cash: boolean;
    is_group: boolean;
    archived: boolean;
    parent_id: string | null;
  }[];
  entries: FixtureEntry[];
  alerts: {
    id: string;
    organization_id: string;
    entry_id: string;
    entry_key: string;
    rule: string;
    severity: string;
    status: 'OPEN' | 'DISMISSED' | 'RESOLVED';
  }[];
  recurring_templates: {
    id: string;
    organization_id: string;
    name: string;
    counterparty: string;
    frequency: string;
    anchor_date: string;
    next_date: string;
    active: boolean;
    lines: FixtureLine[];
  }[];
};
export type References = {
  fixture: Fixture;
  facts: Record<string, { value: unknown }>;
  hashes: Record<string, string>;
  root: string;
};

/** Runs only the standalone reference checker; it cannot load or change a database. */
export function readReferences(root = process.cwd()): References {
  const directory = join(root, 'tests/analyst-workspace-acceptance');
  try {
    execFileSync('python3', ['-B', 'oracle.py', '--check'], {
      cwd: directory,
      timeout: 10_000,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    throw new FixtureError('REFERENCE_CHECK_FAILED');
  }
  const hashes = Object.fromEntries(
    ['fixture.json', 'expected.json', 'cases.json', 'shared-context.md', 'oracle.py'].map((name) => [
      name,
      hash(readFileSync(join(directory, name))),
    ]),
  );
  const fixture = JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8')) as Fixture;
  const expected = JSON.parse(readFileSync(join(directory, 'expected.json'), 'utf8')) as {
    fixture_business_date: string;
    facts: References['facts'];
  };
  requireFixture(
    fixture.version === 1 &&
      fixture.business_date === expected.fixture_business_date &&
      fixture.organizations.length === 2 &&
      fixture.entries.length === 59 &&
      Object.keys(expected.facts).length === 38,
    'REFERENCE_VERSION_MISMATCH',
  );
  return { fixture, facts: expected.facts, hashes, root };
}

/** Version5 UUIDs make saved line identities stable across fresh disposable databases. */
export function lineId(entryId: string, position: number): string {
  const namespace = Buffer.from('5c0dba7985ad4e0fa1580dcab4c59d61', 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(`stored-line/${entryId}/${position}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Normalize numeric *strings* without IEEE754; retain array order and nonnumeric strings. */
export function comparable(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const integer = whole.replace(/^0+(?=\d)/, '');
    const decimals = fraction.replace(/0+$/, '');
    const magnitude = integer + (decimals ? `.${decimals}` : '');
    return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
  }
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, comparable(item)]),
    );
  return value;
}

export function sameValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(comparable(actual)) === JSON.stringify(comparable(expected));
}

export function assertTarget(
  ownerUrl: string,
  expectedDatabase: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  requireFixture(
    /^daybook_analyst_acceptance_[a-z0-9_]{1,35}$/.test(expectedDatabase),
    'UNSAFE_DATABASE_NAME',
  );
  let url: URL;
  try {
    url = new URL(ownerUrl);
  } catch {
    throw new FixtureError('INVALID_DATABASE_URL');
  }
  requireFixture(['postgres:', 'postgresql:'].includes(url.protocol), 'INVALID_DATABASE_PROTOCOL');
  requireFixture(!url.search && !url.hash, 'DATABASE_URL_OPTIONS_NOT_ALLOWED');
  requireFixture(url.pathname === `/${expectedDatabase}`, 'DATABASE_NAME_MISMATCH');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const ciService =
    (env.CI === 'true' || env.CI === '1' || env.NODE_ENV === 'test') &&
    url.hostname === 'db' &&
    url.port === '5432';
  requireFixture(local || ciService, 'NONLOCAL_DATABASE_REFUSED');
  requireFixture(Boolean(url.username), 'DATABASE_ROLE_REQUIRED');
  return {
    database: expectedDatabase,
    readerRole: `analyst_fixture_reader_${hash(expectedDatabase).slice(0, 12)}`,
  };
}
