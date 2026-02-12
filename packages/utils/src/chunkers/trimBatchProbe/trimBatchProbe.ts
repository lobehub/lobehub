import { encodeAsync } from '../../tokenizer';

export interface Buildable {
  build: (tryCompactIfPossible?: boolean) => string | Promise<string>;
}

export type Joiner<T = string> =
  | string
  | ((batch: T[]) => string | Promise<string>)
  | { join: (batch: T[]) => string | Promise<string> };

export interface TrimBatchProbeOptions<T = string | Buildable> {
  builder?: (item: T, tryCompact?: boolean) => string | Promise<string>;
  joiner?: Joiner<string>;
  tokenLimit?: number;
  tryChunkingByPunctuation?: boolean;
  tryHardTruncation?: boolean;
}

export type Input<T = string | Buildable> = T | T[] | undefined | null;

const PUNCTUATION_SPLIT_REGEXP = /(?<=\p{Punctuation})\s*/u;

export const isBuildable = (value: unknown): value is Buildable =>
  Boolean(value) && typeof (value as Buildable).build === 'function';

/**
 * Resolves joiner preference into a callable or string separator.
 * - string: direct separator
 * - function: joiner(batch)
 * - object with join(): use join(batch)
 */
export const resolveJoiner = (joiner?: Joiner<string>) => {
  if (!joiner) return '\n';
  if (typeof joiner === 'string') return joiner;
  if (typeof joiner === 'function') return joiner;
  if (typeof (joiner as { join?: unknown }).join === 'function') return joiner.join.bind(joiner);

  return '\n';
};

/**
 * Normalizes any input to an array to simplify downstream probing.
 */
export const normalizeToArray = <T>(input: Input<T>): T[] => {
  if (input === null || input === undefined) return [];

  return Array.isArray(input) ? input : [input];
};

export const buildSegment = async <T>(
  item: T,
  tryCompact: boolean,
  builder?: TrimBatchProbeOptions<T>['builder'],
) => {
  if (builder) return builder(item, tryCompact);
  if (isBuildable(item)) return item.build(tryCompact);
  if (typeof item === 'string') return item;

  return String(item);
};

/**
 * Tries to preserve sentence/element boundaries by removing older punctuation-delimited chunks first.
 */
export const truncateByPunctuation = async (text: string, tokenLimit: number) => {
  const segments = text
    .split(PUNCTUATION_SPLIT_REGEXP)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length <= 1) return '';

  for (let i = segments.length; i >= 1; i -= 1) {
    const candidate = segments.slice(-i).join(' ');
    const tokenCount = await encodeAsync(candidate);
    if (tokenCount <= tokenLimit) return candidate;
  }

  return '';
};

/**
 * Last-resort truncation from the tail using a shrinking window heuristic.
 */
export const hardTruncateFromTail = async (text: string, tokenLimit: number) => {
  let candidate = text.trim();
  if (!candidate) return '';

  // approximate characters per token to avoid excessive calls
  const estimatedLength = Math.max(1, tokenLimit * 4);
  candidate = candidate.slice(-estimatedLength);

  for (let i = 0; i < 5 && candidate.length > 0; i += 1) {
    const tokenCount = await encodeAsync(candidate);
    if (tokenCount <= tokenLimit) return candidate;

    const nextLength = Math.max(
      1,
      Math.min(candidate.length - 1, Math.floor(candidate.length * 0.75)),
    );
    candidate = candidate.slice(-nextLength);
  }

  return candidate;
};

/**
 * Joins built segments using the provided joiner or string separator.
 */
export const joinSegments = async (
  segments: string[],
  joiner: ReturnType<typeof resolveJoiner>,
) => {
  if (typeof joiner === 'string') return segments.join(joiner);

  return joiner(segments);
};

/**
 * Binary-search style probe from newest to oldest to find the largest batch under the token limit.
 * Tries with either full or compact builds depending on `tryCompact`.
 */
export const searchBestBatch = async <T>(
  segments: T[],
  tokenLimit: number,
  tryCompact: boolean,
  joiner: ReturnType<typeof resolveJoiner>,
  builder?: TrimBatchProbeOptions<T>['builder'],
) => {
  const cache = new Map<string, string>();

  const buildBatch = async (count: number) => {
    const key = `${tryCompact}-${count}`;
    if (cache.has(key)) return cache.get(key)!;

    const builtSegments: string[] = [];
    const start = Math.max(segments.length - count, 0);

    for (let i = start; i < segments.length; i += 1) {
      builtSegments.push(await buildSegment(segments[i], tryCompact, builder));
    }

    const joined = await joinSegments(builtSegments, joiner);
    cache.set(key, joined);
    return joined;
  };

  let low = 1;
  let high = segments.length;
  let best: { count: number; text: string } | null = null;

  while (low <= high) {
    const mid = Math.max(1, Math.floor((low + high) / 2));
    const candidate = await buildBatch(mid);
    const tokens = await encodeAsync(candidate);

    if (tokens <= tokenLimit) {
      best = { count: mid, text: candidate };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
};

/**
 * Handles single-segment fallback: uses punctuation slicing then hard tail truncation if needed.
 */
export const handleSingle = async (
  built: string,
  tokenLimit: number,
  opts: { tryChunking: boolean; tryHard: boolean },
) => {
  const attemptProbeLimit = await encodeAsync(built);
  if (attemptProbeLimit <= tokenLimit) return built;

  if (opts.tryChunking) {
    const punctuation = await truncateByPunctuation(built, tokenLimit);
    if (punctuation) {
      return punctuation;
    }
  }

  if (opts.tryHard) {
    const truncated = await hardTruncateFromTail(built, tokenLimit);
    if (truncated) {
      return truncated;
    }
  }

  return '';
};

/**
 * Token-aware chunk trimmer that keeps the newest items first and only truncates when probing fails.
 *
 * Strategy:
 * 1) Normalize everything to an array of segments (supports strings or Buildable items with optional compact build).
 * 2) Probe from the tail (newest-first) using binary search to find the largest batch under `tokenLimit`.
 * 3) Retry with compact builds (`build(true)` or custom builder) if the first probe drops earlier items.
 * 4) If nothing fits, fall back to trimming the newest segment via punctuation slicing or hard tail truncation
 *    to avoid breaking structured XML/JSON-like content mid-way.
 *
 * Bisection example (8 segments, keep newest):
 *   try 4 (fits?) -> yes -> try 6 -> no -> try 5 -> yes => best=5
 *   if compact retry needed, repeat with build(true) and pick the better fit.
 *
 * This minimizes structural breakage by preferring whole built segments and only truncating the last one as a last resort.
 *
 * @param input Segments to trim (string, Buildable, or arrays of them).
 * @param tokenLimitOrOptions Either a numeric token limit or options object.
 * @param maybeOptions Optional options or joiner when token limit is numeric.
 */
export const trimBasedOnBatchProbe = async <T = string | Buildable>(
  input: Input<T>,
  tokenLimitOrOptions?: number | TrimBatchProbeOptions<T>,
  maybeOptions?: TrimBatchProbeOptions<T> | string,
): Promise<string> => {
  const options: TrimBatchProbeOptions<T> =
    typeof tokenLimitOrOptions === 'number'
      ? {
          ...(typeof maybeOptions === 'object' ? maybeOptions : {}),
          tokenLimit: tokenLimitOrOptions,
        }
      : (tokenLimitOrOptions ?? {});

  if (typeof maybeOptions === 'string') {
    options.joiner = maybeOptions;
  }

  const tokenLimit = options.tokenLimit;
  const joiner = resolveJoiner(options.joiner);
  const tryChunking = options.tryChunkingByPunctuation ?? true;
  const tryHard = options.tryHardTruncation ?? true;
  const segments = normalizeToArray(input);

  if (!tokenLimit || tokenLimit <= 0) {
    const built = await Promise.all(segments.map((s) => buildSegment(s, false, options.builder)));
    return joinSegments(built, joiner);
  }
  if (segments.length === 0) {
    return '';
  }
  if (segments.length === 1) {
    const first = segments[0];
    const built = await buildSegment(first, false, options.builder);
    if ((await encodeAsync(built)) <= tokenLimit) {
      return built;
    }

    if (isBuildable(first)) {
      const compactBuilt = await first.build(true);
      if ((await encodeAsync(compactBuilt)) <= tokenLimit) {
        return compactBuilt;
      }

      return handleSingle(compactBuilt, tokenLimit, { tryChunking, tryHard });
    }

    return handleSingle(built, tokenLimit, { tryChunking, tryHard });
  }

  const bestNormal = await searchBestBatch(segments, tokenLimit, false, joiner, options.builder);
  if (bestNormal?.count === segments.length || bestNormal) {
    const remainingSegments = segments.length - (bestNormal?.count ?? 0);
    // try to include more with compact builds if we dropped anything
    if (remainingSegments > 0) {
      const bestCompact = await searchBestBatch(
        segments,
        tokenLimit,
        true,
        joiner,
        options.builder,
      );

      if (
        bestCompact &&
        (!bestNormal ||
          bestCompact.count > bestNormal.count ||
          bestCompact.text.length > bestNormal.text.length)
      ) {
        return bestCompact.text;
      }
    }

    if (bestNormal) {
      return bestNormal.text;
    }
  }

  const bestCompact = await searchBestBatch(segments, tokenLimit, true, joiner, options.builder);
  if (bestCompact) {
    return bestCompact.text;
  }

  // fallback to truncation on the most recent segment
  const lastBuilt = await buildSegment(segments.at(-1) as T, true, options.builder);
  const truncated = await handleSingle(lastBuilt, tokenLimit, { tryChunking, tryHard });

  return truncated || '';
};
