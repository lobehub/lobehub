import type {
  VerifyCheckResultMetadata,
  VerifyVisualizationDataset,
  VerifyVisualizationField,
  VerifyVisualizationManifest,
  VerifyVisualizationValue,
  VerifyVisualizationView,
} from '@lobechat/types';

import { firstString, objectValue } from './values';

const VISUALIZATION_FIELD_TYPES = new Set(['boolean', 'category', 'number', 'string', 'temporal']);
const VISUALIZATION_TYPES = new Set([
  'bar-chart',
  'heatmap',
  'line-chart',
  'metric-comparison',
  'scatter-plot',
  'table',
]);
const MAX_INLINE_VISUALIZATION_ROWS = 10_000;

const visualizationValue = (value: unknown): value is VerifyVisualizationValue =>
  value === null || ['boolean', 'number', 'string'].includes(typeof value);

const visualizationField = (
  encoding: Record<string, unknown>,
  key: string,
  fieldKeys: Set<string>,
  path: string,
) => {
  const field = firstString(encoding[key]);
  if (!field || !fieldKeys.has(field)) {
    throw new Error(`${path}.${key} must reference a declared dataset field`);
  }
  return field;
};

const optionalVisualizationField = (
  encoding: Record<string, unknown>,
  key: string,
  fieldKeys: Set<string>,
  path: string,
) => {
  if (encoding[key] === undefined) return;
  visualizationField(encoding, key, fieldKeys, path);
};

const optionalVisualizationString = (value: Record<string, unknown>, key: string, path: string) => {
  if (value[key] !== undefined && !firstString(value[key])) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
};

const visualizationSeries = (
  encoding: Record<string, unknown>,
  fieldKeys: Set<string>,
  path: string,
  options?: { styles?: boolean },
) => {
  if (!Array.isArray(encoding.series) || encoding.series.length === 0) {
    throw new Error(`${path}.series must be a non-empty array`);
  }
  encoding.series.forEach((rawSeries, seriesIndex) => {
    const series = objectValue(rawSeries);
    const seriesPath = `${path}.series[${seriesIndex}]`;
    if (!series) throw new Error(`${seriesPath} must be an object`);
    visualizationField(series, 'field', fieldKeys, seriesPath);
    if (series.label !== undefined && !firstString(series.label)) {
      throw new Error(`${seriesPath}.label must be a non-empty string`);
    }
    if (
      options?.styles &&
      series.style !== undefined &&
      !['accent', 'muted', 'primary'].includes(String(series.style))
    ) {
      throw new Error(`${seriesPath}.style is invalid`);
    }
  });
};

const validateVisualizationEncoding = (
  view: Record<string, unknown>,
  fieldKeys: Set<string>,
  index: number,
) => {
  const path = `visualizations[${index}].encoding`;
  if (view.type === 'table' && view.encoding === undefined) return;
  const encoding = objectValue(view.encoding);
  if (!encoding) throw new Error(`${path} is required for ${String(view.type)}`);

  switch (view.type) {
    case 'bar-chart': {
      visualizationField(encoding, 'category', fieldKeys, path);
      visualizationSeries(encoding, fieldKeys, path);
      optionalVisualizationString(encoding, 'valueLabel', path);
      break;
    }
    case 'heatmap': {
      visualizationField(encoding, 'x', fieldKeys, path);
      visualizationField(encoding, 'y', fieldKeys, path);
      visualizationField(encoding, 'value', fieldKeys, path);
      break;
    }
    case 'line-chart': {
      visualizationField(encoding, 'x', fieldKeys, path);
      visualizationSeries(encoding, fieldKeys, path, { styles: true });
      optionalVisualizationString(encoding, 'xLabel', path);
      optionalVisualizationString(encoding, 'yLabel', path);
      break;
    }
    case 'metric-comparison': {
      visualizationField(encoding, 'label', fieldKeys, path);
      visualizationField(encoding, 'before', fieldKeys, path);
      visualizationField(encoding, 'after', fieldKeys, path);
      for (const key of [
        'afterSamples',
        'beforeSamples',
        'direction',
        'statistic',
        'target',
        'unit',
      ]) {
        optionalVisualizationField(encoding, key, fieldKeys, path);
      }
      break;
    }
    case 'scatter-plot': {
      visualizationField(encoding, 'x', fieldKeys, path);
      visualizationField(encoding, 'y', fieldKeys, path);
      optionalVisualizationField(encoding, 'color', fieldKeys, path);
      optionalVisualizationField(encoding, 'label', fieldKeys, path);
      optionalVisualizationString(encoding, 'xLabel', path);
      optionalVisualizationString(encoding, 'yLabel', path);
      break;
    }
    case 'table': {
      if (encoding.columns !== undefined) {
        if (!Array.isArray(encoding.columns) || encoding.columns.length === 0) {
          throw new Error(`${path}.columns must be a non-empty array`);
        }
        encoding.columns.forEach((field, fieldIndex) =>
          visualizationField({ field }, 'field', fieldKeys, `${path}.columns[${fieldIndex}]`),
        );
      }
      if (encoding.highlights !== undefined) {
        if (!Array.isArray(encoding.highlights)) {
          throw new Error(`${path}.highlights must be an array`);
        }
        encoding.highlights.forEach((rawHighlight, highlightIndex) => {
          const highlight = objectValue(rawHighlight);
          const highlightPath = `${path}.highlights[${highlightIndex}]`;
          if (!highlight) throw new Error(`${highlightPath} must be an object`);
          visualizationField(highlight, 'field', fieldKeys, highlightPath);
          if (highlight.mode !== 'max' && highlight.mode !== 'min') {
            throw new Error(`${highlightPath}.mode must be max or min`);
          }
        });
      }
      break;
    }
  }
};

/** Parse the case's datasets + views into versioned check-result metadata. */
export function visualizationMetadata(value: unknown): VerifyCheckResultMetadata | undefined {
  const input = objectValue(value);
  if (!input || (input.datasets === undefined && input.visualizations === undefined))
    return undefined;
  if (!Array.isArray(input.datasets) || !Array.isArray(input.visualizations)) {
    throw new Error('datasets and visualizations must both be arrays');
  }

  let rowCount = 0;
  const datasets = input.datasets.map((rawDataset, datasetIndex) => {
    const dataset = objectValue(rawDataset);
    const id = firstString(dataset?.id);
    if (!id || !Array.isArray(dataset?.fields) || !Array.isArray(dataset.rows)) {
      throw new Error(`datasets[${datasetIndex}] needs id, fields, and rows`);
    }

    const fields = dataset.fields.map((rawField, fieldIndex) => {
      const field = objectValue(rawField);
      const key = firstString(field?.key);
      const type = field?.type;
      if (!key || typeof type !== 'string' || !VISUALIZATION_FIELD_TYPES.has(type)) {
        throw new Error(`datasets[${datasetIndex}].fields[${fieldIndex}] is invalid`);
      }
      return {
        key,
        label: firstString(field.label),
        type,
        unit: firstString(field.unit),
      } as VerifyVisualizationField;
    });
    const fieldKeys = new Set(fields.map((field) => field.key));
    if (fieldKeys.size !== fields.length) {
      throw new Error(`datasets[${datasetIndex}] field keys must be unique`);
    }

    const rows = dataset.rows.map((rawRow, rowIndex) => {
      const row = objectValue(rawRow);
      if (
        !row ||
        Object.entries(row).some(([key, cell]) => !fieldKeys.has(key) || !visualizationValue(cell))
      ) {
        throw new Error(`datasets[${datasetIndex}].rows[${rowIndex}] does not match its fields`);
      }
      return row as Record<string, VerifyVisualizationValue>;
    });
    rowCount += rows.length;
    return { fields, id, rows } satisfies VerifyVisualizationDataset;
  });

  if (rowCount > MAX_INLINE_VISUALIZATION_ROWS) {
    throw new Error(`visualization metadata exceeds ${MAX_INLINE_VISUALIZATION_ROWS} inline rows`);
  }
  const datasetIds = new Set(datasets.map((dataset) => dataset.id));
  if (datasetIds.size !== datasets.length) throw new Error('dataset ids must be unique');
  const fieldKeysByDataset = new Map(
    datasets.map((dataset) => [dataset.id, new Set(dataset.fields.map((field) => field.key))]),
  );

  const views = input.visualizations.map((rawView, index) => {
    const view = objectValue(rawView);
    const id = firstString(view?.id);
    const type = view?.type;
    const dataset = firstString(view?.dataset);
    if (
      !id ||
      typeof type !== 'string' ||
      !VISUALIZATION_TYPES.has(type) ||
      !dataset ||
      !datasetIds.has(dataset) ||
      view.version !== 1
    ) {
      throw new Error(`visualizations[${index}] has an invalid id, type, version, or dataset`);
    }
    optionalVisualizationString(view, 'context', `visualizations[${index}]`);
    optionalVisualizationString(view, 'title', `visualizations[${index}]`);
    validateVisualizationEncoding(view, fieldKeysByDataset.get(dataset)!, index);
    return view as unknown as VerifyVisualizationView;
  });
  if (new Set(views.map((view) => view.id)).size !== views.length) {
    throw new Error('visualization ids must be unique');
  }

  const visualization: VerifyVisualizationManifest = { datasets, schemaVersion: 1, views };
  return { visualization };
}
