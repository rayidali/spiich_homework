import { createHash } from 'node:crypto';
import { getQuickJS, type QuickJSHandle } from 'quickjs-emscripten';
import { z } from 'zod';
import { AppError } from './errors';

export const ANALYSIS_PROGRAM_LIMITS = Object.freeze({
  codeBytes: 16 * 1024,
  inputBytes: 256 * 1024,
  executionMs: 2000,
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 256 * 1024,
  operations: 5000,
  tables: 4,
  inputRowsPerTable: 50,
  outputTables: 2,
  outputRows: 64,
  outputBytes: 256 * 1024,
  arrayValues: 200,
});

const unitSchema = z.enum(['USD', 'count', 'ratio']);
const sourceSchema = z.enum(['posted', 'draft']);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();
const rowSchema = z.strictObject({
  id: z.string().min(1).max(1024),
  label: z.string().max(1024),
  from: date,
  to: date,
  balanceAsOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dimensions: z
    .array(
      z.strictObject({
        kind: z.enum(['account', 'counterparty', 'month', 'quarter']),
        key: z.string().max(1024),
        label: z.string().max(1024).optional(),
        accountId: z.string().max(100).optional(),
      }),
    )
    .max(3)
    .optional(),
  value: z
    .string()
    .regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/)
    .nullable(),
  unit: unitSchema,
  source: sourceSchema,
});
const tableSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  rows: z.array(rowSchema).max(ANALYSIS_PROGRAM_LIMITS.inputRowsPerTable),
  truncated: z.boolean(),
});
export type AnalysisProgramInputRow = z.infer<typeof rowSchema>;
export type AnalysisProgramInputTable = z.infer<typeof tableSchema>;
export type AnalysisProgramTable = AnalysisProgramInputTable;
export type AnalysisProgramUnit = z.infer<typeof unitSchema>;
export type AnalysisProgramReference = { queryId: string; rowId: string };
type Source = z.infer<typeof sourceSchema>;
type Fraction = { numerator: bigint; denominator: bigint };
type NullReason = 'missing_value' | 'zero_denominator' | 'empty_input';
type Value = {
  exact: Fraction | null;
  unit: AnalysisProgramUnit;
  source: Source;
  references: AnalysisProgramReference[];
  reason?: NullReason;
  original?: { queryId: string; row: AnalysisProgramInputRow };
};
export type AnalysisProgramResultRow = {
  label: string;
  value: string;
  exact: { numerator: string; denominator: string } | null;
  unit: AnalysisProgramUnit;
  source: Source;
  references: AnalysisProgramReference[];
  reason?: NullReason;
};
export type AnalysisProgramResult = {
  tables: { title: string; rows: AnalysisProgramResultRow[] }[];
  codeHash: string;
  operationCount: number;
};

function invalid(message: string): never {
  throw new AppError(422, 'INVALID_ANALYSIS_PROGRAM', message);
}
function limit(message: string): never {
  throw new AppError(422, 'ANALYSIS_PROGRAM_LIMIT', message);
}
const abs = (n: bigint) => (n < 0n ? -n : n);
function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (!denominator) invalid('A non-null exact value needs a nonzero denominator.');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let a = abs(numerator),
    b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  if (
    abs(numerator) > 10n ** 15n * denominator ||
    numerator.toString().length > 1024 ||
    denominator.toString().length > 1024
  )
    limit('An analysis value exceeds the supported amount or precision.');
  return { numerator, denominator };
}
function decimal(value: string): Fraction {
  const [whole, digits = ''] = value.replace(/^-/, '').split('.');
  return fraction(BigInt(whole + digits) * (value.startsWith('-') ? -1n : 1n), 10n ** BigInt(digits.length));
}
function provenance(values: Value[]): Pick<Value, 'source' | 'references'> {
  return {
    source: values.some((value) => value.source === 'draft') ? 'draft' : 'posted',
    references: [
      ...new Map(
        values.flatMap((value) => value.references).map((ref) => [JSON.stringify(ref), ref]),
      ).values(),
    ],
  };
}
function unitFor(operation: string, left: AnalysisProgramUnit, right: AnalysisProgramUnit) {
  if (operation === 'add' || operation === 'sub') {
    if (left === right) return left;
  } else if (operation === 'mul') {
    if (left === 'ratio' || left === 'count') return right;
    if (right === 'ratio' || right === 'count') return left;
  } else if (operation === 'div') {
    if (left === right) return 'ratio';
    if (right === 'ratio' || right === 'count') return left;
  }
  return invalid('The analysis combines incompatible units.');
}
function rounded(exact: Fraction, digits: number, scale = 1n): string {
  const scaled = abs(exact.numerator) * scale * 10n ** BigInt(digits);
  let n = scaled / exact.denominator;
  if ((scaled % exact.denominator) * 2n >= exact.denominator) n++;
  const padded = n.toString().padStart(digits + 1, '0');
  return `${exact.numerator < 0n && n !== 0n ? '-' : ''}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
function display(value: Value, format: string): string {
  if (
    (format === 'money' && value.unit !== 'USD') ||
    (format === 'percent' && value.unit !== 'ratio') ||
    (format === 'number' && value.unit === 'USD') ||
    !['money', 'percent', 'number'].includes(format)
  )
    invalid('The requested display format does not match the calculated unit.');
  if (!value.exact)
    return value.reason === 'zero_denominator'
      ? 'Not available — denominator is zero'
      : value.reason === 'empty_input'
        ? 'Not available — no matching values'
        : 'Not available — missing source value';
  if (format === 'percent') return `${rounded(value.exact, 2, 100n)}%`;
  if (format === 'money') {
    const text = rounded(value.exact, 2);
    const negative = text.startsWith('-');
    const [whole, cents] = text.replace(/^-/, '').split('.');
    return `${negative ? '-' : ''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
  }
  return rounded(value.exact, 6).replace(/\.?0+$/, '');
}

/** Execute generated computation in a separate QuickJS WASM runtime. Only data
 * and exact host arithmetic cross the boundary. No host I/O is exposed. Source
 * references prove where values came from, not that the generated formula
 * answers the user's intended question. */
export async function executeAnalysisProgram(input: {
  code: string;
  tables: AnalysisProgramInputTable[];
  /** Monotonic performance.now deadline, shared with the outer request. */
  deadline?: number;
}): Promise<AnalysisProgramResult> {
  const start = performance.now();
  if (typeof input.code !== 'string' || !input.code.trim()) invalid('An analysis program is required.');
  if (Buffer.byteLength(input.code) > ANALYSIS_PROGRAM_LIMITS.codeBytes)
    limit('The analysis program exceeds its size limit.');
  if (input.deadline !== undefined && !Number.isFinite(input.deadline))
    invalid('An analysis deadline must be finite.');
  const deadline = Math.min(input.deadline ?? Infinity, start + ANALYSIS_PROGRAM_LIMITS.executionMs);
  const checkTime = () => {
    if (performance.now() >= deadline) limit('The analysis program exceeded its execution time.');
  };
  checkTime();
  if (Buffer.byteLength(JSON.stringify(input.tables)) > ANALYSIS_PROGRAM_LIMITS.inputBytes)
    limit('Analysis input exceeds its size limit.');
  const parsed = z.array(tableSchema).min(1).max(ANALYSIS_PROGRAM_LIMITS.tables).safeParse(input.tables);
  if (!parsed.success) invalid('Analysis input does not match the supported table shape.');
  const tables = parsed.data;
  if (new Set(tables.map((table) => table.id)).size !== tables.length)
    invalid('Analysis table IDs must be unique.');
  for (const table of tables) {
    if (table.truncated) invalid('Analysis requires complete source results, not truncated tables.');
    if (new Set(table.rows.map((row) => row.id)).size !== table.rows.length)
      invalid('Analysis source rows must have unique identities.');
    for (const row of table.rows) {
      // Reject out-of-range input before allocating any guest handles.
      if (row.value !== null) decimal(row.value);
      if (row.balanceAsOf !== undefined && row.balanceAsOf !== row.to)
        invalid('A balance row must preserve its exact as-of date.');
      const pointBalance = row.from == null && row.to != null && row.balanceAsOf === row.to;
      if (
        (!pointBalance && (row.from == null) !== (row.to == null)) ||
        (row.from && row.to && row.from > row.to)
      )
        invalid('Analysis row periods must have compatible boundaries.');
      if (row.dimensions && new Set(row.dimensions.map((d) => d.kind)).size !== row.dimensions.length)
        invalid('Analysis row dimensions must be unique.');
    }
  }
  const quickjs = await getQuickJS();
  checkTime();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(ANALYSIS_PROGRAM_LIMITS.memoryBytes);
  runtime.setMaxStackSize(ANALYSIS_PROGRAM_LIMITS.stackBytes);
  runtime.setInterruptHandler(() => performance.now() >= deadline);
  runtime.removeModuleLoader();
  const vm = runtime.newContext();
  let operationCount = 0;
  let hostFailure: AppError | undefined;
  const known = new WeakSet<Value>();
  const handles: QuickJSHandle[] = [];
  const retain = (value: QuickJSHandle) => {
    handles.push(value);
    return value;
  };
  const countOperation = () => {
    checkTime();
    if (++operationCount > ANALYSIS_PROGRAM_LIMITS.operations)
      limit('The analysis program exceeded its operation allowance.');
  };
  const wrap = (value: Value): QuickJSHandle => {
    known.add(value);
    return vm.newHostRef(value).handle;
  };
  const unwrap = (handle: QuickJSHandle): Value => {
    let value: Value;
    try {
      value = vm.unwrapHostRef<Value>(handle);
    } catch {
      return invalid('Numeric results must use exact values supplied by the analysis calculator.');
    }
    if (!known.has(value)) invalid('The numeric reference does not belong to this analysis.');
    return value;
  };
  const checked = (result: ReturnType<typeof vm.evalCode>): QuickJSHandle => {
    if (result.error) {
      result.error.dispose();
      if (hostFailure) throw hostFailure;
      checkTime();
      invalid('The generated analysis could not execute within its supported environment.');
    }
    return result.value;
  };
  // Retain pristine array/serialization helpers before any generated code runs.
  const isArray = retain(checked(vm.evalCode('Array.isArray')));
  const array = (handle: QuickJSHandle, max: number): QuickJSHandle[] => {
    const result = checked(vm.callFunction(isArray, vm.undefined, handle));
    const yes = vm.getNumber(result);
    result.dispose();
    if (!yes) invalid('The analysis expects an array.');
    const lengthHandle = vm.getProp(handle, 'length');
    const length = vm.getNumber(lengthHandle);
    lengthHandle.dispose();
    if (!Number.isSafeInteger(length) || length < 0 || length > max)
      limit('An analysis array exceeds its size limit.');
    return Array.from({ length }, (_, i) => vm.getProp(handle, i));
  };
  const values = (handle: QuickJSHandle): Value[] => {
    const entries = array(handle, ANALYSIS_PROGRAM_LIMITS.arrayValues);
    try {
      return entries.map(unwrap);
    } finally {
      entries.forEach((entry) => entry.dispose());
    }
  };
  const text = (handle: QuickJSHandle, max: number): string => {
    if (vm.typeof(handle) !== 'string') invalid('Analysis labels and formats must be text.');
    const result = vm.getString(handle);
    if (!result.trim() || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result))
      invalid('Analysis text is empty or exceeds its allowed shape.');
    return result;
  };
  const binary = (operation: 'add' | 'sub' | 'mul' | 'div', left: Value, right: Value): Value => {
    const unit = unitFor(operation, left.unit, right.unit);
    const inherited = provenance([left, right]);
    if (!left.exact || !right.exact)
      return { exact: null, unit, ...inherited, reason: left.reason ?? right.reason ?? 'missing_value' };
    const a = left.exact,
      b = right.exact;
    if (operation === 'div' && b.numerator === 0n)
      return { exact: null, unit, ...inherited, reason: 'zero_denominator' };
    const exact =
      operation === 'add' || operation === 'sub'
        ? fraction(
            a.numerator * b.denominator + (operation === 'add' ? 1n : -1n) * b.numerator * a.denominator,
            a.denominator * b.denominator,
          )
        : operation === 'mul'
          ? fraction(a.numerator * b.numerator, a.denominator * b.denominator)
          : fraction(a.numerator * b.denominator, a.denominator * b.numerator);
    return { exact, unit, ...inherited };
  };
  const compare = (left: Value, right: Value): number => {
    if (left.unit !== right.unit) invalid('Comparison needs matching units.');
    if (!left.exact || !right.exact) invalid('Handle missing values explicitly before comparison.');
    const difference =
      left.exact.numerator * right.exact.denominator - right.exact.numerator * left.exact.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  };
  const aggregate = (name: string, items: Value[]): Value => {
    const inherited = provenance(items);
    if (name === 'count') {
      if (
        items.some((item) => !item.original) ||
        new Set(items.map((item) => JSON.stringify([item.original?.queryId, item.original?.row.id]))).size !==
          items.length
      )
        invalid('Count accepts distinct original source rows, not duplicated or calculated values.');
      return { exact: fraction(BigInt(items.length), 1n), unit: 'count', ...inherited };
    }
    const unit = items[0]?.unit ?? 'ratio';
    if (items.some((item) => item.unit !== unit)) invalid('Aggregation needs matching units.');
    if (!items.length) return { exact: null, unit, ...inherited, reason: 'empty_input' };
    if (items.some((item) => item.exact === null))
      return {
        exact: null,
        unit,
        ...inherited,
        reason: items.find((item) => item.reason)?.reason ?? 'missing_value',
      };
    let exact: Fraction;
    if (name === 'sum' || name === 'mean') {
      exact = items.reduce(
        (total, item) =>
          fraction(
            total.numerator * item.exact!.denominator + item.exact!.numerator * total.denominator,
            total.denominator * item.exact!.denominator,
          ),
        fraction(0n, 1n),
      );
      if (name === 'mean') exact = fraction(exact.numerator, exact.denominator * BigInt(items.length));
    } else {
      const sorted = [...items].sort(compare);
      if (name === 'min') exact = sorted[0].exact!;
      else if (name === 'max') exact = sorted.at(-1)!.exact!;
      else {
        const middle = Math.floor(sorted.length / 2);
        exact = sorted[middle].exact!;
        if (sorted.length % 2 === 0) {
          const earlier = sorted[middle - 1].exact!;
          exact = fraction(
            exact.numerator * earlier.denominator + earlier.numerator * exact.denominator,
            2n * exact.denominator * earlier.denominator,
          );
        }
      }
    }
    return { exact, unit, ...inherited };
  };
  const object = (data: unknown): QuickJSHandle => {
    // This serialization is host-owned input metadata, never guest output.
    return checked(vm.evalCode(`(${JSON.stringify(data)})`));
  };
  const sourceRow = (original: NonNullable<Value['original']>, value: QuickJSHandle) => {
    const { value: _rawValue, ...metadata } = original.row;
    const row = object(metadata);
    vm.setProp(row, 'value', value);
    return row;
  };
  try {
    const guestTables = retain(vm.newArray());
    tables.forEach((table, tableIndex) => {
      const guestTable = vm.newObject();
      const id = vm.newString(table.id);
      vm.setProp(guestTable, 'id', id);
      id.dispose();
      const guestRows = vm.newArray();
      table.rows.forEach((row, rowIndex) => {
        const original = { queryId: table.id, row };
        const value = wrap({
          exact: row.value === null ? null : decimal(row.value),
          unit: row.unit,
          source: row.source,
          references: [{ queryId: table.id, rowId: row.id }],
          ...(row.value === null ? { reason: 'missing_value' as const } : {}),
          original,
        });
        const guestRow = sourceRow(original, value);
        value.dispose();
        vm.setProp(guestRows, rowIndex, guestRow);
        guestRow.dispose();
      });
      vm.setProp(guestTable, 'rows', guestRows);
      guestRows.dispose();
      vm.setProp(guestTables, tableIndex, guestTable);
      guestTable.dispose();
    });
    const calc = retain(vm.newObject());
    const expose = (name: string, implementation: (...args: QuickJSHandle[]) => QuickJSHandle) => {
      const fn = vm.newFunction(name, (...args) => {
        try {
          countOperation();
          return implementation(...args);
        } catch (error) {
          hostFailure ??=
            error instanceof AppError
              ? error
              : new AppError(
                  422,
                  'INVALID_ANALYSIS_PROGRAM',
                  'The analysis calculator received invalid input.',
                );
          return { error: vm.newError(hostFailure.message) };
        }
      });
      vm.setProp(calc, name, fn);
      fn.dispose();
    };
    for (const name of ['add', 'sub', 'mul', 'div'] as const)
      expose(name, (...args) => {
        if (args.length !== 2) invalid('Binary arithmetic needs two exact values.');
        return wrap(binary(name, unwrap(args[0]), unwrap(args[1])));
      });
    for (const name of ['sum', 'mean', 'median', 'min', 'max', 'count'])
      expose(name, (...args) => {
        if (args.length !== 1) invalid('Aggregation needs one array of exact values.');
        return wrap(aggregate(name, values(args[0])));
      });
    expose('compare', (...args) => {
      if (args.length !== 2) invalid('Comparison needs two exact values.');
      return vm.newNumber(compare(unwrap(args[0]), unwrap(args[1])));
    });
    expose('isNull', (...args) => {
      if (args.length !== 1) invalid('Missing-value inspection needs one exact value.');
      return unwrap(args[0]).exact === null ? vm.true : vm.false;
    });
    expose('abs', (...args) => {
      if (args.length !== 1) invalid('Absolute value needs one exact value.');
      const value = unwrap(args[0]);
      const { original: _original, ...rest } = value;
      return wrap({
        ...rest,
        exact: value.exact ? fraction(abs(value.exact.numerator), value.exact.denominator) : null,
      });
    });
    expose('align', (...args) => {
      if (args.length !== 2) invalid('Alignment needs two arrays of source rows.');
      const originals = (arg: QuickJSHandle) => {
        const rows = array(arg, ANALYSIS_PROGRAM_LIMITS.arrayValues);
        try {
          return rows.map((row) => {
            const handle = vm.getProp(row, 'value');
            try {
              const value = unwrap(handle);
              if (!value.original) invalid('Alignment needs original source rows.');
              return { value, original: value.original };
            } finally {
              handle.dispose();
            }
          });
        } finally {
          rows.forEach((row) => row.dispose());
        }
      };
      const left = originals(args[0]),
        right = originals(args[1]);
      const key = ({ original }: (typeof left)[number]) => {
        const row = original.row;
        return JSON.stringify({
          from: row.from ?? null,
          to: row.to ?? null,
          balanceAsOf: row.balanceAsOf ?? null,
          dimensions:
            row.dimensions
              ?.map(({ kind, key, accountId }) => [kind, key, accountId ?? null])
              .sort((a, b) => String(a[0]).localeCompare(String(b[0]))) ?? [],
          id:
            row.id.startsWith('month:') ||
            row.id.startsWith('quarter:') ||
            row.dimensions?.some((dimension) => dimension.kind === 'month' || dimension.kind === 'quarter')
              ? null
              : row.id,
        });
      };
      const rightByKey = new Map(right.map((row) => [key(row), row]));
      if (
        left.length !== right.length ||
        new Set(left.map(key)).size !== left.length ||
        rightByKey.size !== right.length
      )
        invalid('Alignment requires unique matching rows and complete period coverage.');
      const result = vm.newArray();
      try {
        left.forEach((row, index) => {
          const match = rightByKey.get(key(row));
          if (!match || row.value.unit !== match.value.unit || row.value.source !== match.value.source)
            invalid('Aligned rows must match period, dimensions, units and posting status.');
          const pair = vm.newObject();
          for (const [name, item] of [
            ['left', row],
            ['right', match],
          ] as const) {
            const value = wrap(item.value);
            const trusted = sourceRow(item.original, value);
            value.dispose();
            vm.setProp(pair, name, trusted);
            trusted.dispose();
          }
          vm.setProp(result, index, pair);
          pair.dispose();
        });
        return result;
      } catch (error) {
        result.dispose();
        throw error;
      }
    });
    const freeze = retain(
      checked(
        vm.evalCode(`(function freeze(value) {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    })`),
      ),
    );
    checked(vm.callFunction(freeze, vm.undefined, guestTables)).dispose();
    checked(vm.callFunction(freeze, vm.undefined, calc)).dispose();
    // The only evaluator is QuickJS. The generated function is never evaluated
    // by Node, and receives no host object, module loader or I/O capability.
    const fn = retain(
      checked(
        vm.evalCode(`(function(tables, calc) { "use strict";\n${input.code}\n})`, 'analysis.js', {
          type: 'global',
        }),
      ),
    );
    const result = retain(checked(vm.callFunction(fn, vm.undefined, guestTables, calc)));
    checkTime();
    if (hostFailure) throw hostFailure;
    const outputTables = array(result, ANALYSIS_PROGRAM_LIMITS.outputTables);
    if (!outputTables.length) invalid('The analysis must return at least one result table.');
    let totalRows = 0;
    const output: AnalysisProgramResult['tables'] = [];
    try {
      for (const table of outputTables) {
        const titleHandle = vm.getProp(table, 'title');
        let title: string;
        try {
          title = text(titleHandle, 200);
        } finally {
          titleHandle.dispose();
        }
        const rowsHandle = vm.getProp(table, 'rows');
        let rows: QuickJSHandle[];
        try {
          rows = array(rowsHandle, ANALYSIS_PROGRAM_LIMITS.outputRows);
        } finally {
          rowsHandle.dispose();
        }
        totalRows += rows.length;
        try {
          if (!rows.length) invalid('Each analysis result table must contain a result row.');
          if (totalRows > ANALYSIS_PROGRAM_LIMITS.outputRows)
            limit('The analysis has too many displayed rows.');
          const displayed: AnalysisProgramResultRow[] = [];
          for (const row of rows) {
            checkTime();
            const labelHandle = vm.getProp(row, 'label');
            const valueHandle = vm.getProp(row, 'value');
            const formatHandle = vm.getProp(row, 'format');
            try {
              const label = text(labelHandle, 300);
              const value = unwrap(valueHandle);
              const formatted = display(value, text(formatHandle, 10));
              displayed.push({
                label,
                value: formatted,
                exact: value.exact
                  ? {
                      numerator: value.exact.numerator.toString(),
                      denominator: value.exact.denominator.toString(),
                    }
                  : null,
                unit: value.unit,
                source: value.source,
                references: structuredClone(value.references),
                ...(value.reason ? { reason: value.reason } : {}),
              });
            } finally {
              labelHandle.dispose();
              valueHandle.dispose();
              formatHandle.dispose();
            }
          }
          output.push({ title, rows: displayed });
        } finally {
          rows.forEach((row) => row.dispose());
        }
      }
    } finally {
      outputTables.forEach((table) => table.dispose());
    }
    checkTime();
    if (hostFailure) throw hostFailure;
    if (Buffer.byteLength(JSON.stringify(output)) > ANALYSIS_PROGRAM_LIMITS.outputBytes)
      limit('The analysis result and source references exceed the output size limit.');
    return {
      tables: output,
      codeHash: createHash('sha256').update(input.code).digest('hex'),
      operationCount,
    };
  } catch (error) {
    // Extraction may execute guest getters. Preserve an expired deadline even
    // when a terminated getter subsequently looks like a malformed value.
    checkTime();
    if (error instanceof AppError) throw error;
    if (hostFailure) throw hostFailure;
    return invalid('The generated analysis could not execute within its supported environment.');
  } finally {
    handles.reverse().forEach((handle) => handle.alive && handle.dispose());
    vm.dispose();
    runtime.dispose();
  }
}
