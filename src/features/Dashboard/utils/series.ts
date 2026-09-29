import type { WidgetSeriesOutput } from '@lobechat/types';
import dayjs from 'dayjs';

import type { DashboardTrendSeries } from '@/services/dashboard';

export interface SeriesChartData {
  categories: string[];
  /** Whether the history came from `metric_points` rather than the latest output alone. */
  fromHistory: boolean;
  rows: Record<string, number | string>[];
}

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}/;
/** A calendar day with no time of day, e.g. '2026-09-27'. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const formatLabel = (t: string, spansDays: boolean) => {
  if (!ISO_PREFIX.test(t)) return t;
  const date = dayjs(t);
  if (!date.isValid()) return t;
  // A day has no time to show; formatting it as 'HH:mm' labels every point '00:00'.
  if (DATE_ONLY.test(t)) return date.format('MM-DD');
  return date.format(spansDays ? 'MM-DD HH:mm' : 'HH:mm');
};

/**
 * Chart rows for a series widget.
 *
 * Each series prefers its long-term history from `metric_points` (subject
 * `dashboardWidget`, key `series:<name>`), which keeps growing across runs
 * while a script usually only reports a sliding window. Series the metrics
 * cannot hold — category labels like 'Mon' — fall back to the latest output.
 */
export const buildSeriesChartData = (
  output: WidgetSeriesOutput,
  trend?: DashboardTrendSeries[],
): SeriesChartData => {
  const history = new Map((trend ?? []).map((series) => [series.name, series.points]));
  let fromHistory = false;

  const series = output.series.map((item) => {
    const stored = history.get(item.name);
    if (stored && stored.length >= item.points.length && stored.length > 0) {
      fromHistory = true;
      return {
        name: item.name,
        points: stored.map((point) => ({ t: point.observedAt.toISOString(), v: point.value })),
      };
    }
    return item;
  });

  const times = series.flatMap((item) => item.points.map((point) => point.t));
  const isoTimes = times.filter((t) => ISO_PREFIX.test(t)).map((t) => dayjs(t).valueOf());
  const spansDays =
    isoTimes.length > 1 && Math.max(...isoTimes) - Math.min(...isoTimes) > 24 * 3600 * 1000;

  // Keep first-seen order for categories; sort timestamps chronologically.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const t of times) {
    if (!seen.has(t)) {
      seen.add(t);
      order.push(t);
    }
  }
  if (order.every((t) => ISO_PREFIX.test(t))) {
    order.sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf());
  }

  const rows = order.map((t) => {
    const row: Record<string, number | string> = { t: formatLabel(t, spansDays) };
    for (const item of series) {
      const point = item.points.find((p) => p.t === t);
      if (point) row[item.name] = point.v;
    }
    return row;
  });

  return { categories: series.map((item) => item.name), fromHistory, rows };
};

/**
 * Points of a stat's sparkline in a `width` × `height` box (2px inset). A flat
 * history sits mid-height so it reads as a steady trend, not as the box edge.
 */
export const sparklinePoints = (values: number[], width: number, height: number) => {
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const x = (index: number) => (values.length > 1 ? (index / (values.length - 1)) * width : 0);
  const y = (value: number) =>
    span === 0 ? height / 2 : height - 2 - ((value - min) / span) * (height - 4);
  return values.map((value, index) => ({ x: x(index), y: y(value) }));
};
