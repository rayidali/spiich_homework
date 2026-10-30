export type EvaluationOptions = {
  suite: 'smoke' | 'development' | 'holdout' | 'all';
  repeats: number;
  maxAttempts: number;
  maxTotalTokens: number;
  candidate: string;
  help: boolean;
};

export function parseEvaluationOptions(args: string[]): EvaluationOptions {
  const values: Record<string, string> = {};
  const allowed = new Set(['suite', 'repeats', 'max-attempts', 'max-total-tokens', 'candidate']);
  let help = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      help = true;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new Error('Unknown evaluation option. Use --help.');
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--') || values[match[1]] !== undefined)
      throw new Error('Missing or repeated evaluation option. Use --help.');
    values[match[1]] = value;
  }
  const suite = values.suite ?? 'smoke';
  if (!['smoke', 'development', 'holdout', 'all'].includes(suite))
    throw new Error('Suite must be smoke, development, holdout, or all.');
  const integer = (key: string, fallback: number, maximum: number) => {
    const value = values[key] ?? String(fallback);
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 ||
      Number(value) > maximum
    )
      throw new Error(`Invalid ${key}; expected 1–${maximum}.`);
    return Number(value);
  };
  const candidate = values.candidate ?? 'baseline-text-retrieval';
  if (!/^[a-zA-Z0-9._-]{1,60}$/.test(candidate))
    throw new Error(
      'Candidate must be a short name containing letters, numbers, dot, underscore, or hyphen.',
    );
  return {
    suite: suite as EvaluationOptions['suite'],
    repeats: integer('repeats', suite === 'holdout' ? 3 : 1, 10),
    maxAttempts: integer('max-attempts', suite === 'smoke' ? 8 : suite === 'development' ? 32 : 96, 200),
    maxTotalTokens: integer(
      'max-total-tokens',
      suite === 'smoke' ? 32000 : suite === 'development' ? 150000 : 400000,
      2000000,
    ),
    candidate,
    help,
  };
}
