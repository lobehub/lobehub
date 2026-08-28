import { describe, expect, it } from 'vitest';

import {
  hasRenderableEvidence,
  metricComparisonDelta,
  readVisualizationManifest,
  tableHighlightRows,
} from './visualization';

const metadata = {
  visualization: {
    datasets: [
      {
        fields: [
          { key: 'name', type: 'string' },
          { key: 'before', type: 'number' },
          { key: 'after', type: 'number' },
        ],
        id: 'metrics',
        rows: [{ after: 25, before: 250, name: 'GC time' }],
      },
    ],
    schemaVersion: 1,
    views: [
      {
        dataset: 'metrics',
        encoding: { after: 'after', before: 'before', label: 'name' },
        id: 'comparison',
        type: 'metric-comparison',
        version: 1,
      },
    ],
  },
};

describe('readVisualizationManifest', () => {
  it('reads a supported, versioned manifest', () => {
    const manifest = readVisualizationManifest(metadata);

    expect(manifest?.datasets).toHaveLength(1);
    expect(manifest?.views[0]?.type).toBe('metric-comparison');
  });

  it('ignores malformed or unsupported metadata', () => {
    expect(readVisualizationManifest(null)).toBe(null);
    expect(
      readVisualizationManifest({
        visualization: { ...metadata.visualization, schemaVersion: 2 },
      }),
    ).toBe(null);
  });

  it.each([
    ['bar-chart', {}],
    ['line-chart', { series: [], x: 'name' }],
    ['scatter-plot', { x: 'before', y: 'missing' }],
    ['table', { columns: ['missing'] }],
  ])('rejects a persisted %s view with a malformed encoding', (type, encoding) => {
    expect(
      readVisualizationManifest({
        visualization: {
          ...metadata.visualization,
          views: [{ dataset: 'metrics', encoding, id: 'invalid', type, version: 1 }],
        },
      }),
    ).toBe(null);
  });

  it('rejects malformed persisted datasets instead of partially rendering them', () => {
    expect(
      readVisualizationManifest({
        visualization: {
          ...metadata.visualization,
          datasets: [
            ...metadata.visualization.datasets,
            {
              fields: [{ key: 'score', type: 'number' }],
              id: 'broken',
              rows: [{ unknown: 1 }],
            },
          ],
        },
      }),
    ).toBe(null);
  });

  it('computes the first metric improvement for the collapsed check row', () => {
    const manifest = readVisualizationManifest(metadata)!;
    const view = manifest.views[0];
    if (view.type !== 'metric-comparison') throw new Error('unexpected fixture view');

    expect(metricComparisonDelta(manifest.datasets[0], view)).toEqual({
      after: 25,
      before: 250,
      improvement: 90,
    });
  });

  it('selects every tied SOTA row for max and min table metrics', () => {
    const dataset = {
      fields: [{ key: 'score', type: 'number' as const }],
      id: 'models',
      rows: [{ score: 92 }, { score: 88 }, { score: 92 }],
    };

    expect([...tableHighlightRows(dataset, 'score', 'max')]).toEqual([0, 2]);
    expect([...tableHighlightRows(dataset, 'score', 'min')]).toEqual([1]);
  });

  it('treats a structured visualization as review evidence without uploaded files', () => {
    const manifest = readVisualizationManifest(metadata);

    expect(hasRenderableEvidence(0, manifest)).toBe(true);
    expect(hasRenderableEvidence(0, null)).toBe(false);
    expect(hasRenderableEvidence(1, null)).toBe(true);
  });
});
