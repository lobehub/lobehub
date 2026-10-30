import type { SearchMemoryParams } from '@lobechat/types';

import type {
  LayerBaseMemorySignals,
  RankedSearchCandidate,
  RecommendationScoreBreakdown,
} from './types';
import { coerceDate } from './utils';

const DEFAULT_TEMPORAL_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const SHORT_TERM_ASSOCIATION_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;

const normalizeSimilarityTerm = (value: string) => value.trim().toLowerCase();

const normalizeSearchTerms = (values?: string[]) => [
  ...new Set(
    (
      values ??
      // v8 ignore start -- unreachable: both callers pass an array
      []
    )
      // v8 ignore stop
      .map((value) => normalizeSimilarityTerm(value))
      .filter(Boolean),
  ),
];

const clampScore = (value: number) => Math.max(0, Math.min(1, value));

const reciprocalRankScore = (rank?: number) =>
  rank === undefined
    ? // v8 ignore start -- unreachable: callers always pass the list index; the pair is ignored because a skipped first arm shifts the second arm's count
      0
    : 1 / (rank + 1);
// v8 ignore stop

const tokenizeSimilarityTerm = (value: string) =>
  normalizeSimilarityTerm(value)
    .split(/[\s\-_/]+/)
    .filter(Boolean);

const computeTokenJaccard = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) return 0;

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union === 0
    ? // v8 ignore start -- unreachable: both token lists are non-empty here; the pair is ignored because a skipped first arm shifts the second arm's count
      0
    : intersection / union;
  // v8 ignore stop
};

const computeTermSimilarity = (left: string, right: string) => {
  const normalizedLeft = normalizeSimilarityTerm(left);
  const normalizedRight = normalizeSimilarityTerm(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.85;
  }

  return computeTokenJaccard(
    tokenizeSimilarityTerm(normalizedLeft),
    tokenizeSimilarityTerm(normalizedRight),
  );
};

const computeArraySimilarity = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) return 0;

  return left.reduce((maxScore, leftValue) => {
    return Math.max(
      maxScore,
      right.reduce(
        (innerMax, rightValue) => Math.max(innerMax, computeTermSimilarity(leftValue, rightValue)),
        0,
      ),
    );
  }, 0);
};

const scoreTimeDistance = (distanceMs: number, windowMs: number) => {
  if (!Number.isFinite(distanceMs)) return 0;
  if (distanceMs <= 0) return 1;

  return clampScore(Math.exp(-distanceMs / Math.max(windowMs, 1)));
};

export const scoreHybridCandidates = <T extends { id: string; tags?: string[] | null }>(params: {
  baseSignals: Map<string, LayerBaseMemorySignals>;
  items: T[];
  lexicalLists: T[][];
  queries: string[];
  queryParams: SearchMemoryParams;
  semanticLists: T[][];
}): RankedSearchCandidate<T>[] => {
  const { baseSignals, items, lexicalLists, queries, queryParams, semanticLists } = params;
  if (items.length === 0) return [];

  const extractSearchableTerms = (value: unknown): string[] => {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (value instanceof Date) return [value.toISOString()];
    if (Array.isArray(value)) {
      return [...new Set(value.flatMap((item) => extractSearchableTerms(item)).filter(Boolean))];
    }
    if (typeof value === 'object') {
      return [
        ...new Set(
          Object.values(value as Record<string, unknown>)
            .flatMap((item) => extractSearchableTerms(item))
            .filter(Boolean),
        ),
      ];
    }

    return [];
  };

  const computeFuzzyScore = (item: unknown) => {
    const normalizedQueries = normalizeSearchTerms(queries);
    if (normalizedQueries.length === 0) return 0;

    const itemTerms = normalizeSearchTerms(extractSearchableTerms(item));
    if (itemTerms.length === 0) return 0;

    return clampScore(
      normalizedQueries.reduce(
        (bestScore, query) =>
          Math.max(
            bestScore,
            itemTerms.reduce(
              (innerBestScore, term) =>
                Math.max(innerBestScore, computeTermSimilarity(query, term)),
              0,
            ),
          ),
        0,
      ),
    );
  };

  const collectCandidateTimes = (
    item: Record<string, unknown>,
    baseSignal: LayerBaseMemorySignals,
  ) => {
    const values = [
      item.capturedAt,
      item.startsAt,
      item.endsAt,
      item.episodicDate,
      item.createdAt,
      item.updatedAt,
    ];

    const times = values
      .map((value) => coerceDate(value))
      .filter((value): value is Date => Boolean(value))
      .map((value) => value.getTime());

    return [...new Set([...times, ...baseSignal.times])];
  };

  const computeTemporalScore = (candidateTimes: number[]) => {
    const { timeRange } = queryParams;
    if (!timeRange || candidateTimes.length === 0) return 0;

    const fieldWindow =
      timeRange.start && timeRange.end
        ? Math.abs(timeRange.end.getTime() - timeRange.start.getTime()) ||
          DEFAULT_TEMPORAL_WINDOW_MS
        : DEFAULT_TEMPORAL_WINDOW_MS;

    return candidateTimes.reduce((bestScore, time) => {
      if (
        timeRange.start &&
        timeRange.end &&
        time >= timeRange.start.getTime() &&
        time <= timeRange.end.getTime()
      ) {
        return 1;
      }

      const distance =
        timeRange.start && timeRange.end
          ? Math.min(
              Math.abs(time - timeRange.start.getTime()),
              Math.abs(time - timeRange.end.getTime()),
            )
          : Math.abs(time - (timeRange.start?.getTime() ?? timeRange.end?.getTime() ?? time));

      return Math.max(bestScore, scoreTimeDistance(distance, fieldWindow));
    }, 0);
  };

  const computeClusterSignals = (
    candidateId: string,
    candidateCategories: string[],
    candidateTags: string[],
    candidateTimes: number[],
    seeds: Array<{
      categories: string[];
      id: string;
      tags: string[];
      times: number[];
    }>,
  ) => {
    let bestCategoryAffinity = 0;
    let bestTagAffinity = 0;
    let bestClusterBoost = 0;

    for (const seed of seeds) {
      if (seed.id === candidateId) continue;

      const categoryAffinity = computeArraySimilarity(candidateCategories, seed.categories);
      const tagAffinity = computeArraySimilarity(candidateTags, seed.tags);
      const timeDistance =
        candidateTimes.length && seed.times.length
          ? Math.min(
              ...candidateTimes.flatMap((candidateTime) =>
                seed.times.map((seedTime) => Math.abs(candidateTime - seedTime)),
              ),
            )
          : Number.POSITIVE_INFINITY;
      const shortTermAssociation = scoreTimeDistance(
        timeDistance,
        SHORT_TERM_ASSOCIATION_WINDOW_MS,
      );
      const clusterBoost = (0.55 * tagAffinity + 0.45 * categoryAffinity) * shortTermAssociation;

      bestCategoryAffinity = Math.max(bestCategoryAffinity, categoryAffinity);
      bestTagAffinity = Math.max(bestTagAffinity, tagAffinity);
      bestClusterBoost = Math.max(bestClusterBoost, clusterBoost);
    }

    return {
      categoryAffinity: clampScore(bestCategoryAffinity),
      clusterBoost: clampScore(bestClusterBoost),
      tagAffinity: clampScore(bestTagAffinity),
    };
  };

  const candidates = new Map<
    string,
    {
      categories: string[];
      fuzzyScore: number;
      item: T;
      keywordScore: number;
      semanticScore: number;
      tags: string[];
      temporalScore: number;
      times: number[];
    }
  >();

  const registerRankedList = (list: T[], source: 'keyword' | 'semantic') => {
    list.forEach((item, index) => {
      const baseSignal = baseSignals.get(item.id) ?? {
        categories: [],
        memoryIds: [],
        tags: [],
        times: [],
      };
      const tags = [...new Set([...(item.tags ?? []), ...baseSignal.tags])];
      const times = collectCandidateTimes(item as Record<string, unknown>, baseSignal);
      const existing = candidates.get(item.id) ?? {
        categories: baseSignal.categories,
        fuzzyScore: computeFuzzyScore(item),
        item,
        keywordScore: 0,
        semanticScore: 0,
        tags,
        temporalScore: computeTemporalScore(times),
        times,
      };

      if (source === 'keyword') {
        existing.keywordScore = Math.max(existing.keywordScore, reciprocalRankScore(index));
      } else {
        existing.semanticScore = Math.max(existing.semanticScore, reciprocalRankScore(index));
      }

      existing.categories = [...new Set([...existing.categories, ...baseSignal.categories])];
      existing.tags = [...new Set([...existing.tags, ...tags])];
      existing.times = [...new Set([...existing.times, ...times])];
      existing.temporalScore = Math.max(
        existing.temporalScore,
        computeTemporalScore(existing.times),
      );
      candidates.set(item.id, existing);
    });
  };

  lexicalLists.forEach((list) => registerRankedList(list, 'keyword'));
  semanticLists.forEach((list) => registerRankedList(list, 'semantic'));

  const preliminary = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      preliminaryScore:
        0.34 * candidate.keywordScore +
        0.28 * candidate.semanticScore +
        0.2 * candidate.fuzzyScore +
        0.18 * candidate.temporalScore,
    }))
    .sort((left, right) => right.preliminaryScore - left.preliminaryScore);

  const seeds = preliminary.slice(0, Math.min(3, preliminary.length)).map((candidate) => ({
    categories: candidate.categories,
    id: candidate.item.id,
    tags: candidate.tags,
    times: candidate.times,
  }));

  return preliminary
    .map((candidate) => {
      const clusterSignals = computeClusterSignals(
        candidate.item.id,
        candidate.categories,
        candidate.tags,
        candidate.times,
        seeds,
      );
      const breakdown: RecommendationScoreBreakdown = {
        categoryAffinity: clusterSignals.categoryAffinity,
        clusterBoost: clusterSignals.clusterBoost,
        final: 0,
        fuzzy: clampScore(candidate.fuzzyScore),
        keyword: clampScore(candidate.keywordScore),
        semantic: clampScore(candidate.semanticScore),
        tagAffinity: clusterSignals.tagAffinity,
        temporal: clampScore(candidate.temporalScore),
      };

      const crossSignalBoost = breakdown.keyword > 0 && breakdown.semantic > 0 ? 0.06 : 0;
      breakdown.final = clampScore(
        0.24 * breakdown.keyword +
          0.22 * breakdown.semantic +
          0.18 * breakdown.fuzzy +
          0.14 * breakdown.temporal +
          0.12 * breakdown.tagAffinity +
          0.06 * breakdown.categoryAffinity +
          0.08 * breakdown.clusterBoost +
          crossSignalBoost,
      );

      return {
        item: candidate.item,
        score: breakdown,
      };
    })
    .sort((left, right) => right.score.final - left.score.final);
};
