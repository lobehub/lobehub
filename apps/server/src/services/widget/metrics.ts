import type { WidgetManifest, WidgetOutput } from '@lobechat/types';

import { MetricModel } from '@/database/models/metric';
import type { LobeChatDatabase } from '@/database/type';

export interface WidgetMetricScope {
  id: string;
  metricId: string | null;
  title: string;
  userId: string;
  workspaceId: string | null;
}

export interface RecordWidgetMetricsParams {
  manifest?: WidgetManifest | null;
  observedAt: Date;
  output: WidgetOutput;
  runId: string;
}

export interface RecordWidgetMetricsResult {
  pointsWritten: number;
  /** Series the widget row should point at (`widgets.metric_id`). */
  primaryMetricId?: string;
}

const DEFAULT_STAT_KEY = 'value';
const SERIES_KEY_PREFIX = 'series:';

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replaceAll(',', ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const pickPath = (source: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      source,
    );

const parseTime = (t: string): Date | undefined => {
  // Category labels ('Mon', 'v1.2') are not time points and never enter a trend.
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return undefined;
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Fold a successful, complete run into the widget's long-term trend in
 * `metrics` / `metric_points` (subject `widget`):
 *
 * - `stat` — one point per run, the numeric `value` (or `manifest.metric.valuePath`)
 *   observed at the run's finish time. Non-numeric stats are skipped.
 * - `series` — one metric per series (`series:<name>`); only points with an
 *   ISO timestamp newer than the series' latest stored point are appended
 *   (serialized per series), so a script re-reporting a sliding window — even
 *   from two overlapping runs — does not duplicate history.
 *
 * list / table outputs carry no numbers to trend and write nothing.
 */
export const recordWidgetMetrics = async (
  db: LobeChatDatabase,
  widget: WidgetMetricScope,
  params: RecordWidgetMetricsParams,
): Promise<RecordWidgetMetricsResult> => {
  const { manifest, output, observedAt, runId } = params;
  const metricModel = new MetricModel(db, widget.userId, widget.workspaceId ?? undefined);
  const kind = manifest?.metric?.kind ?? 'gauge';

  const pointBase = {
    actorId: runId,
    actorType: 'system' as const,
    sourceType: 'probe' as const,
  };

  if (output.type === 'stat') {
    const value = toNumber(
      manifest?.metric?.valuePath ? pickPath(output, manifest.metric.valuePath) : output.value,
    );
    if (value === undefined) return { pointsWritten: 0 };

    const metric = await metricModel.ensure({
      key: manifest?.metric?.key ?? DEFAULT_STAT_KEY,
      kind,
      subjectId: widget.id,
      subjectType: 'widget',
      title: output.label ?? widget.title,
      unit: manifest?.metric?.unit ?? output.unit,
    });
    if (!metric) return { pointsWritten: 0 };

    await metricModel.addPoint(metric.id, { ...pointBase, observedAt, value });
    return { pointsWritten: 1, primaryMetricId: metric.id };
  }

  if (output.type === 'series') {
    let pointsWritten = 0;
    let primaryMetricId: string | undefined;

    for (const series of output.series) {
      const points = series.points
        .map((p) => ({ observedAt: parseTime(p.t), value: p.v }))
        .filter((p): p is { observedAt: Date; value: number } => !!p.observedAt);
      if (points.length === 0) continue;

      const metric = await metricModel.ensure({
        key: `${SERIES_KEY_PREFIX}${series.name}`,
        kind,
        subjectId: widget.id,
        subjectType: 'widget',
        title: series.name,
        unit: manifest?.metric?.unit ?? output.unit,
      });
      if (!metric) continue;
      primaryMetricId ??= metric.id;

      // Overlapping runs report the same window; the append is serialized
      // per series so each timestamp is written once.
      pointsWritten += await metricModel.appendNewerPoints(
        metric.id,
        points.map((p) => ({ ...pointBase, ...p })),
      );
    }

    return { pointsWritten, primaryMetricId };
  }

  return { pointsWritten: 0 };
};
