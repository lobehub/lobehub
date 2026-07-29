/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RadarDimensionDatum } from './ModelRatingRadar';
import ModelRatingRadar, { RATING_DIMENSION_ORDER } from './ModelRatingRadar';

vi.mock('antd-style', () => ({
  createStaticStyles: () =>
    new Proxy({}, { get: (_target, prop: string) => prop }) as Record<string, string>,
  cssVar: new Proxy({}, { get: (_target, token) => `var(--${String(token)})` }),
}));

const { radarChartProps } = vi.hoisted(() => ({ radarChartProps: vi.fn() }));

vi.mock('@lobehub/charts', () => ({
  RadarChart: (props: Record<string, unknown>) => {
    radarChartProps(props);

    return <svg data-testid={'radar-chart'} />;
  },
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

const lastProps = () => radarChartProps.mock.lastCall![0];

describe('ModelRatingRadar', () => {
  it('plots all six dimensions when every one is scored', () => {
    render(
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

    expect(lastProps().data).toHaveLength(6);
    expect(lastProps().data[0]).toEqual({ label: 'intelligence', score: 90 });
  });

  it('omits missing dimensions from the chart instead of plotting them as zero', () => {
    render(
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

    const { data } = lastProps();
    expect(data).toHaveLength(5);
    expect(data.map((row: { label: string }) => row.label)).not.toContain('agentic');
  });

  it('pins the radius domain to the full 0-100 score range', () => {
    render(<ModelRatingRadar dimensions={createDimensions({ intelligence: 90 })} />);

    // an auto domain would rescale the polygon to the scored min/max and
    // exaggerate differences — scores must always read against 0-100
    expect(lastProps().minValue).toBe(0);
    expect(lastProps().maxValue).toBe(100);
  });
});
