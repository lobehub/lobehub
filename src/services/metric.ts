import type { MetricKind, MetricSubjectType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * One chartable series of a subject, points included — the shape the north-star
 * strip consumes. Aggregated client-side from `metric.listSeries` +
 * `metric.listPoints` because the strip always needs both halves: the series
 * definition names the metric, the points carry the progress.
 */
export interface MetricSeriesWithPoints {
  config?: { direction?: 'higher_is_better' | 'lower_is_better'; target?: number } | null;
  id: string;
  key: string;
  kind: MetricKind;
  points: { observedAt: Date; value: number }[];
  title?: string | null;
  unit?: string | null;
}

/** Sparkline + progress need the shape, not the volume — cap the read. */
const SERIES_POINT_LIMIT = 200;

class MetricService {
  listSeriesWithPoints = async (
    subjectType: MetricSubjectType,
    subjectId: string,
  ): Promise<MetricSeriesWithPoints[]> => {
    const { data: series } = await lambdaClient.metric.listSeries.query({
      subjectId,
      subjectType,
    });

    return Promise.all(
      series.map(async (item) => {
        const { data } = await lambdaClient.metric.listPoints.query({
          id: item.id,
          limit: SERIES_POINT_LIMIT,
        });
        return {
          config: item.config,
          id: item.id,
          key: item.key,
          kind: data.kind,
          points: data.points.map((point) => ({
            observedAt: new Date(point.observedAt),
            value: Number(point.value),
          })),
          title: data.title,
          unit: data.unit,
        };
      }),
    );
  };
}

export const metricService = new MetricService();
