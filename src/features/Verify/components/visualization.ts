import type {
  VerifyCheckResultMetadata,
  VerifyVisualizationDataset,
  VerifyVisualizationManifest,
  VerifyVisualizationView,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

const VIEW_TYPES = new Set([
  'bar-chart',
  'heatmap',
  'line-chart',
  'metric-comparison',
  'scatter-plot',
  'table',
]);

/** Defensive parser: open historical metadata must never crash a report page. */
export const readVisualizationManifest = (
  metadata: VerifyCheckResultMetadata | unknown,
): VerifyVisualizationManifest | null => {
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata.visualization)) return null;
  const manifest = metadata.visualization;
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.datasets) ||
    !Array.isArray(manifest.views)
  )
    return null;

  const datasets = manifest.datasets.filter(
    (dataset): dataset is VerifyVisualizationDataset =>
      isPlainRecord(dataset) &&
      typeof dataset.id === 'string' &&
      Array.isArray(dataset.fields) &&
      Array.isArray(dataset.rows),
  );
  const datasetIds = new Set(datasets.map((dataset) => dataset.id));
  const views = manifest.views.filter(
    (view): view is VerifyVisualizationView =>
      isPlainRecord(view) &&
      typeof view.id === 'string' &&
      typeof view.type === 'string' &&
      VIEW_TYPES.has(view.type) &&
      view.version === 1 &&
      typeof view.dataset === 'string' &&
      datasetIds.has(view.dataset),
  );
  if (datasets.length === 0 || views.length === 0) return null;

  return { datasets, schemaVersion: 1, views };
};

export const datasetForView = (
  manifest: VerifyVisualizationManifest,
  view: VerifyVisualizationView,
) => manifest.datasets.find((dataset) => dataset.id === view.dataset);

export const fieldLabel = (dataset: VerifyVisualizationDataset, key: string) => {
  const field = dataset.fields.find((item) => item.key === key);
  return field?.label ?? key;
};

export const fieldUnit = (dataset: VerifyVisualizationDataset, key: string) =>
  dataset.fields.find((item) => item.key === key)?.unit;

export const numberCell = (row: Record<string, unknown>, key: string): number | null => {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const stringCell = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
};

export const metricComparisonDelta = (
  dataset: VerifyVisualizationDataset,
  view: Extract<VerifyVisualizationView, { type: 'metric-comparison' }>,
) => {
  const row = dataset.rows[0];
  if (!row) return null;
  const before = numberCell(row, view.encoding.before);
  const after = numberCell(row, view.encoding.after);
  if (before === null || after === null || before === 0) return null;
  const direction = view.encoding.direction ? stringCell(row, view.encoding.direction) : 'lower';
  const raw = ((after - before) / Math.abs(before)) * 100;
  const improvement = direction === 'higher' ? raw : -raw;
  return { after, before, improvement };
};

export const tableHighlightRows = (
  dataset: VerifyVisualizationDataset,
  field: string,
  mode: 'max' | 'min',
) => {
  const values = dataset.rows
    .map((row, index) => ({ index, value: numberCell(row, field) }))
    .filter((item): item is { index: number; value: number } => item.value !== null);
  if (values.length === 0) return new Set<number>();
  const best =
    mode === 'max'
      ? Math.max(...values.map(({ value }) => value))
      : Math.min(...values.map(({ value }) => value));
  return new Set(values.filter(({ value }) => value === best).map(({ index }) => index));
};
