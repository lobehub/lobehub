import { RadarChart } from '@lobehub/charts';
import { cssVar } from 'antd-style';
import type { FC } from 'react';
import { memo } from 'react';

import { radarStyles } from '../ModelRatingRadar';

/**
 * Slot colors for compared models, assigned by selection order. Hardcoded hex
 * (matching the section-bar colors in ModelDetailPanel) so the polygons stay
 * distinguishable regardless of the user's primary theme color.
 */
export const COMPARE_SERIES_COLORS = ['#1677ff', '#fa8c16', '#13c2c2', '#eb2f96'] as const;

export const MAX_COMPARE_MODELS = COMPARE_SERIES_COLORS.length;

export interface CompareRadarDimension {
  key: string;
  label: string;
}

export interface CompareRadarSeries {
  color: string;
  id: string;
  /** display name shown in the hover tooltip */
  name: string;
  /** aligned with the dimensions array; undefined = no data (vertex omitted) */
  scores: (number | undefined)[];
}

interface CompareRadarProps {
  dimensions: CompareRadarDimension[];
  series: CompareRadarSeries[];
}

/**
 * Multi-series variant of ModelRatingRadar for the benchmark modal: overlays up
 * to MAX_COMPARE_MODELS polygons. With a single series the vertex labels carry
 * the scores; with more, scores move to the tooltip and the table below.
 */
const CompareRadar: FC<CompareRadarProps> = memo(({ dimensions, series }) => {
  const single = series.length === 1;

  const data = dimensions
    .map((dimension, i): Record<string, number | string | undefined> => ({
      subject: dimension.label,
      ...Object.fromEntries(series.map((s) => [s.id, s.scores[i]])),
    }))
    // a dimension no selected model has scored would only draw an empty spoke
    .filter((row) => series.some((s) => row[s.id] !== undefined));

  return (
    <RadarChart
      categories={series.map((s) => s.id)}
      className={radarStyles.radar}
      colors={series.map((s) => s.color)}
      customCategories={Object.fromEntries(series.map((s) => [s.id, s.name]))}
      data={data}
      height={300}
      index={'subject'}
      maxValue={100}
      minValue={0}
      showLegend={false}
      angleAxisLabelFormatter={
        single
          ? (label, row) => (
              <>
                {label}{' '}
                <tspan fill={cssVar.colorText} fontWeight={600}>
                  {row?.[series[0].id]}
                </tspan>
              </>
            )
          : undefined
      }
    />
  );
});

CompareRadar.displayName = 'CompareRadar';

export default CompareRadar;
