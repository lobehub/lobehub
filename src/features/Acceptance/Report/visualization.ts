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
const FIELD_TYPES = new Set(['boolean', 'category', 'number', 'string', 'temporal']);

const isOptionalString = (value: unknown) =>
  value === undefined || (typeof value === 'string' && value.length > 0);
const isCell = (value: unknown) =>
  value === null || ['boolean', 'number', 'string'].includes(typeof value);

const hasFieldReference = (
  encoding: Record<string, unknown>,
  key: string,
  fieldKeys: Set<string>,
  optional = false,
) =>
  optional && encoding[key] === undefined
    ? true
    : typeof encoding[key] === 'string' && fieldKeys.has(encoding[key]);

const hasValidSeries = (
  encoding: Record<string, unknown>,
  fieldKeys: Set<string>,
  styles = false,
) =>
  Array.isArray(encoding.series) &&
  encoding.series.length > 0 &&
  encoding.series.every(
    (item) =>
      isPlainRecord(item) &&
      hasFieldReference(item, 'field', fieldKeys) &&
      isOptionalString(item.label) &&
      (!styles ||
        item.style === undefined ||
        item.style === 'accent' ||
        item.style === 'muted' ||
        item.style === 'primary'),
  );

const hasValidEncoding = (view: Record<string, unknown>, fieldKeys: Set<string>) => {
  if (view.type === 'table' && view.encoding === undefined) return true;
  if (!isPlainRecord(view.encoding)) return false;
  const encoding = view.encoding;

  switch (view.type) {
    case 'bar-chart': {
      return (
        hasFieldReference(encoding, 'category', fieldKeys) &&
        hasValidSeries(encoding, fieldKeys) &&
        isOptionalString(encoding.valueLabel)
      );
    }
    case 'heatmap': {
      return (
        hasFieldReference(encoding, 'x', fieldKeys) &&
        hasFieldReference(encoding, 'y', fieldKeys) &&
        hasFieldReference(encoding, 'value', fieldKeys)
      );
    }
    case 'line-chart': {
      return (
        hasFieldReference(encoding, 'x', fieldKeys) &&
        hasValidSeries(encoding, fieldKeys, true) &&
        isOptionalString(encoding.xLabel) &&
        isOptionalString(encoding.yLabel)
      );
    }
    case 'metric-comparison': {
      return (
        hasFieldReference(encoding, 'label', fieldKeys) &&
        hasFieldReference(encoding, 'before', fieldKeys) &&
        hasFieldReference(encoding, 'after', fieldKeys) &&
        ['afterSamples', 'beforeSamples', 'direction', 'statistic', 'target', 'unit'].every((key) =>
          hasFieldReference(encoding, key, fieldKeys, true),
        )
      );
    }
    case 'scatter-plot': {
      return (
        hasFieldReference(encoding, 'x', fieldKeys) &&
        hasFieldReference(encoding, 'y', fieldKeys) &&
        hasFieldReference(encoding, 'color', fieldKeys, true) &&
        hasFieldReference(encoding, 'label', fieldKeys, true) &&
        isOptionalString(encoding.xLabel) &&
        isOptionalString(encoding.yLabel)
      );
    }
    case 'table': {
      const columnsValid =
        encoding.columns === undefined ||
        (Array.isArray(encoding.columns) &&
          encoding.columns.length > 0 &&
          encoding.columns.every((field) => typeof field === 'string' && fieldKeys.has(field)));
      const highlightsValid =
        encoding.highlights === undefined ||
        (Array.isArray(encoding.highlights) &&
          encoding.highlights.every(
            (item) =>
              isPlainRecord(item) &&
              hasFieldReference(item, 'field', fieldKeys) &&
              (item.mode === 'max' || item.mode === 'min'),
          ));
      return columnsValid && highlightsValid;
    }
    default: {
      return false;
    }
  }
};

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

  const datasets = manifest.datasets.filter((dataset): dataset is VerifyVisualizationDataset => {
    if (
      !isPlainRecord(dataset) ||
      typeof dataset.id !== 'string' ||
      !Array.isArray(dataset.fields) ||
      !Array.isArray(dataset.rows)
    )
      return false;
    const fieldsValid = dataset.fields.every(
      (field) =>
        isPlainRecord(field) &&
        typeof field.key === 'string' &&
        typeof field.type === 'string' &&
        FIELD_TYPES.has(field.type) &&
        isOptionalString(field.label) &&
        isOptionalString(field.unit),
    );
    const fieldKeys = new Set(
      dataset.fields.flatMap((field) =>
        isPlainRecord(field) && typeof field.key === 'string' ? [field.key] : [],
      ),
    );
    return (
      fieldsValid &&
      fieldKeys.size === dataset.fields.length &&
      dataset.rows.every(
        (row) =>
          isPlainRecord(row) &&
          Object.entries(row).every(([key, value]) => fieldKeys.has(key) && isCell(value)),
      )
    );
  });
  if (datasets.length !== manifest.datasets.length) return null;
  const datasetIds = new Set(datasets.map((dataset) => dataset.id));
  if (datasetIds.size !== datasets.length) return null;
  const views = manifest.views.filter(
    (view): view is VerifyVisualizationView =>
      isPlainRecord(view) &&
      typeof view.id === 'string' &&
      typeof view.type === 'string' &&
      VIEW_TYPES.has(view.type) &&
      view.version === 1 &&
      typeof view.dataset === 'string' &&
      datasetIds.has(view.dataset) &&
      isOptionalString(view.context) &&
      isOptionalString(view.title) &&
      hasValidEncoding(
        view,
        new Set(
          datasets.find((dataset) => dataset.id === view.dataset)!.fields.map((field) => field.key),
        ),
      ),
  );
  if (
    datasets.length === 0 ||
    views.length === 0 ||
    views.length !== manifest.views.length ||
    new Set(views.map((view) => view.id)).size !== views.length
  )
    return null;

  return { datasets, schemaVersion: 1, views };
};

export const datasetForView = (
  manifest: VerifyVisualizationManifest,
  view: VerifyVisualizationView,
) => manifest.datasets.find((dataset) => dataset.id === view.dataset);

/** Structured views are first-class review evidence, even without uploaded files. */
export const hasRenderableEvidence = (
  fileEvidenceCount: number,
  visualization: VerifyVisualizationManifest | null,
) => fileEvidenceCount > 0 || visualization !== null;

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
