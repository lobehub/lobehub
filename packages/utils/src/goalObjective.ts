/** What an evaluator's output says about the deliverables it graded. */
export interface EvaluatorResult {
  metrics?: Record<string, number>;
  score: number;
  summary?: string;
  /** False when the evaluator ran but judged the submission unrankable. */
  valid: boolean;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const numericMetrics = (value: unknown): Record<string, number> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) =>
    isFiniteNumber(v),
  ) as [string, number][];
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const fromJson = (text: string): EvaluatorResult | undefined => {
  // The last JSON object that carries a numeric `score` wins: evaluators often
  // log progress objects before the result.
  const candidates = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) ?? [];
  for (const raw of candidates.reverse()) {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const score = isFiniteNumber(data.score)
        ? data.score
        : typeof data.score === 'string' &&
            data.score.trim() !== '' &&
            Number.isFinite(Number(data.score))
          ? Number(data.score)
          : undefined;
      if (score === undefined) continue;
      return {
        metrics: numericMetrics(data.metrics),
        score,
        summary: typeof data.summary === 'string' && data.summary ? data.summary : undefined,
        valid: data.valid !== false,
      };
    } catch {
      continue;
    }
  }
  return undefined;
};

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;

/**
 * The score in an evaluator's output, or undefined when there is none.
 *
 * Accepted, most specific first: a JSON object with a numeric `score`
 * (optional `valid`, `summary`, `metrics`); a `TOTAL_SCORE <n>` line; a
 * `score: <n>` / `score = <n>` line; a last line that is a bare number. The
 * last match of a form wins, so a final result beats earlier progress output.
 */
export const parseEvaluatorOutput = (output: string): EvaluatorResult | undefined => {
  const json = fromJson(output);
  if (json) return json;
  for (const pattern of [
    new RegExp(String.raw`^\s*TOTAL_SCORE\s+(${NUMBER})\s*$`, 'gim'),
    new RegExp(String.raw`^\s*(?:final\s+)?score\s*[:=]\s*(${NUMBER})\s*$`, 'gim'),
  ]) {
    const matches = [...output.matchAll(pattern)];
    if (matches.length > 0) return { score: Number(matches.at(-1)![1]), valid: true };
  }
  const last = output.trim().split('\n').at(-1)?.trim() ?? '';
  if (new RegExp(`^${NUMBER}$`).test(last)) return { score: Number(last), valid: true };
  return undefined;
};

/** Whether `a` is a better score than `b` in this direction. */
export const isBetterScore = (direction: 'max' | 'min', a: number, b: number) =>
  direction === 'max' ? a > b : a < b;
