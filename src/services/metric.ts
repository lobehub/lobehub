import type { MetricKind, MetricSubjectType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * One chartable series of a subject — the shape the north-star strip consumes.
 * `firstPoint` is the series' true first observation, carried separately
 * because `points` is a recent window: a progress baseline read from
 * `points[0]` would silently rebase once history outgrows the window.
 */
export interface MetricSeriesWithPoints {
  config?: { direction?: 'higher_is_better' | 'lower_is_better'; target?: number } | null;
  firstPoint: { observedAt: Date; value: number } | null;
  id: string;
  key: string;
  kind: MetricKind;
  points: { observedAt: Date; value: number }[];
  title?: string | null;
  unit?: string | null;
}

/** Sparkline + progress need the shape, not the volume — cap the window. */
const SERIES_POINT_LIMIT = 200;

class MetricService {
  /**
   * One RPC for the whole tracking surface: only the named series (a declared
   * acceptance contract is capped), each with its recent window and true
   * first observation.
   */
  listSeriesWithPoints = async (
    subjectType: MetricSubjectType,
    subjectId: string,
    keys: string[],
  ): Promise<MetricSeriesWithPoints[]> => {
    if (keys.length === 0) return [];

    const { data } = await lambdaClient.metric.listSeriesWithPoints.query({
      keys,
      limit: SERIES_POINT_LIMIT,
      subjectId,
      subjectType,
    });

    return data.map((item) => ({
      config: item.config,
      firstPoint: item.firstPoint
        ? { observedAt: new Date(item.firstPoint.observedAt), value: Number(item.firstPoint.value) }
        : null,
      id: item.id,
      key: item.key,
      kind: item.kind,
      points: item.points.map((point) => ({
        observedAt: new Date(point.observedAt),
        value: Number(point.value),
      })),
      title: item.title,
      unit: item.unit,
    }));
  };
}

export const metricService = new MetricService();
