import { RadarChart } from '@lobehub/charts';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ModelRating, ModelRatingSource } from 'model-bank';
import type { FC } from 'react';
import { memo } from 'react';

/** display order around the hexagon, starting from the top vertex, clockwise */
export const RATING_DIMENSION_ORDER = [
  'intelligence',
  'agentic',
  'writing',
  'design',
  'speed',
  'price',
] as const satisfies readonly (keyof ModelRating)[];

export type RatingDimensionKey = (typeof RATING_DIMENSION_ORDER)[number];

/** proper nouns — not translated */
export const RATING_SOURCE_NAMES: Record<ModelRatingSource, string> = {
  'artificial-analysis': 'Artificial Analysis',
  'design-arena': 'Design Arena',
  'lmarena': 'LMArena',
  'lobehub': 'LobeHub',
};

/** below this coverage the radar reads as broken — callers fall back to a list */
export const RADAR_MIN_DIMENSIONS = 5;

export interface RadarDimensionDatum {
  key: RatingDimensionKey;
  label: string;
  /** undefined = no data: the dimension is omitted from the radar (list fallback shows it) */
  score?: number;
  sourceUrl?: string;
  tooltip?: string;
}

export const radarStyles = createStaticStyles(({ css, cssVar }) => ({
  /**
   * Grid strokes are re-colored with the alpha-based fill token: the library
   * draws them with colorBorderSecondary, which equals colorBgElevated in the
   * dark theme (both neutral scale[2]), so they vanish on elevated surfaces.
   * Note the concentric rings render as `path` (class
   * recharts-polar-grid-concentric-polygon) and `circle` in circle grid mode —
   * there is no `polygon` element inside the grid group.
   */
  radar: css`
    .recharts-polar-grid line,
    .recharts-polar-grid path,
    .recharts-polar-grid circle {
      stroke: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface ModelRatingRadarProps {
  dimensions: RadarDimensionDatum[];
}

const ModelRatingRadar: FC<ModelRatingRadarProps> = memo(({ dimensions }) => {
  // unscored dimensions are omitted entirely — plotting them would read as a real 0
  const data = dimensions
    .filter((dimension) => dimension.score !== undefined)
    .map((dimension) => ({ label: dimension.label, score: dimension.score! }));

  return (
    <RadarChart
      categories={['score']}
      className={radarStyles.radar}
      colors={[cssVar.colorPrimary]}
      data={data}
      height={220}
      index={'label'}
      maxValue={100}
      minValue={0}
      showLegend={false}
      showTooltip={false}
      angleAxisLabelFormatter={(label, row) => (
        <>
          {label}{' '}
          <tspan fill={cssVar.colorText} fontWeight={600}>
            {row?.score}
          </tspan>
        </>
      )}
    />
  );
});

ModelRatingRadar.displayName = 'ModelRatingRadar';

export default ModelRatingRadar;
