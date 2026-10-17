import { describe, expect, it } from 'vitest';

import { visualizationMetadata } from '.';

describe('visualizationMetadata', () => {
  const input = {
    datasets: [
      {
        fields: [
          { key: 'name', type: 'string' },
          { key: 'before', type: 'number', unit: 'ms' },
          { key: 'after', type: 'number', unit: 'ms' },
        ],
        id: 'metrics',
        rows: [{ after: 24.8, before: 257, name: 'GC self-time' }],
      },
    ],
    visualizations: [
      {
        dataset: 'metrics',
        encoding: { after: 'after', before: 'before', label: 'name' },
        id: 'performance',
        type: 'metric-comparison',
        version: 1,
      },
    ],
  };

  it('normalizes datasets and views into versioned check-result metadata', () => {
    expect(visualizationMetadata(input)).toEqual({
      visualization: {
        datasets: input.datasets,
        schemaVersion: 1,
        views: input.visualizations,
      },
    });
  });

  it('rejects a view that references a missing dataset', () => {
    expect(() =>
      visualizationMetadata({
        ...input,
        visualizations: [{ ...input.visualizations[0], dataset: 'missing' }],
      }),
    ).toThrow('dataset');
  });

  it('rejects cells outside the declared field schema', () => {
    expect(() =>
      visualizationMetadata({
        ...input,
        datasets: [{ ...input.datasets[0], rows: [{ unexpected: 1 }] }],
      }),
    ).toThrow('does not match');
  });

  it('accepts grouped bar charts and SOTA table highlights', () => {
    expect(
      visualizationMetadata({
        ...input,
        visualizations: [
          {
            dataset: 'metrics',
            encoding: { category: 'name', series: [{ field: 'before' }] },
            id: 'scores',
            type: 'bar-chart',
            version: 1,
          },
          {
            dataset: 'metrics',
            encoding: { highlights: [{ field: 'after', mode: 'min' }] },
            id: 'score-table',
            type: 'table',
            version: 1,
          },
        ],
      })?.visualization?.views.map((view) => view.type),
    ).toEqual(['bar-chart', 'table']);
  });

  it.each([
    ['bar-chart', {}],
    ['heatmap', { x: 'name', y: 'before' }],
    ['line-chart', { series: [], x: 'name' }],
    ['metric-comparison', { after: 'after', before: 'before' }],
    ['scatter-plot', { x: 'before', y: 'missing' }],
    ['table', { columns: ['missing'] }],
  ])('rejects malformed %s encodings', (type, encoding) => {
    expect(() =>
      visualizationMetadata({
        ...input,
        visualizations: [{ dataset: 'metrics', encoding, id: 'invalid-view', type, version: 1 }],
      }),
    ).toThrow();
  });

  it('rejects duplicate dataset field keys', () => {
    expect(() =>
      visualizationMetadata({
        ...input,
        datasets: [
          {
            ...input.datasets[0],
            fields: [
              { key: 'name', type: 'string' },
              { key: 'name', type: 'number' },
            ],
          },
        ],
      }),
    ).toThrow('field keys must be unique');
  });
});
