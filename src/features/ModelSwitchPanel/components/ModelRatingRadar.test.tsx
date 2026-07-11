/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RadarDimensionDatum } from './ModelRatingRadar';
import ModelRatingRadar, { RATING_DIMENSION_ORDER } from './ModelRatingRadar';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    axis: 'axis',
    axisMissing: 'axisMissing',
    container: 'container',
    dot: 'dot',
    labelLink: 'labelLink',
    labelMissing: 'labelMissing',
    labelName: 'labelName',
    labelScore: 'labelScore',
    polygon: 'polygon',
    ring: 'ring',
  }),
}));

const createDimensions = (
  scores: Partial<Record<(typeof RATING_DIMENSION_ORDER)[number], number>>,
): RadarDimensionDatum[] =>
  RATING_DIMENSION_ORDER.map((key) => ({
    key,
    label: key,
    score: scores[key],
    sourceUrl: scores[key] === undefined ? undefined : `https://example.com/${key}`,
  }));

const dataPolygonPoints = (container: HTMLElement) =>
  container.querySelector('polygon.polygon')!.getAttribute('points')!.split(' ').filter(Boolean);

describe('ModelRatingRadar', () => {
  it('connects all six vertices when every dimension is scored', () => {
    const { container } = render(
      <ModelRatingRadar
        dimensions={createDimensions({
          agentic: 80,
          design: 70,
          intelligence: 90,
          price: 40,
          speed: 60,
          writing: 85,
        })}
      />,
    );

    expect(dataPolygonPoints(container)).toHaveLength(6);
  });

  it('omits missing dimensions from the polygon instead of plotting them as zero', () => {
    const { container } = render(
      <ModelRatingRadar
        dimensions={createDimensions({
          design: 70,
          intelligence: 90,
          price: 40,
          speed: 60,
          writing: 85,
        })}
      />,
    );

    // 5 scored vertices only — a center vertex would read as a real 0 score
    expect(dataPolygonPoints(container)).toHaveLength(5);
    expect(container.querySelectorAll('line.axisMissing')).toHaveLength(1);
    expect(container.querySelectorAll('circle.dot')).toHaveLength(5);
    // the missing dimension keeps its greyed label with a dash placeholder
    expect(container.querySelectorAll('text.labelMissing')).toHaveLength(2);
  });
});
