import { createStaticStyles } from 'antd-style';
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
  /** undefined = no data: grey label, dashed axis, vertex omitted from the polygon */
  score?: number;
  sourceUrl?: string;
  tooltip?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  axis: css`
    stroke: ${cssVar.colorBorderSecondary};
    stroke-width: 1;
  `,
  axisMissing: css`
    stroke: ${cssVar.colorBorderSecondary};
    stroke-dasharray: 3 3;
    stroke-width: 1;
  `,
  container: css`
    display: block;
    margin-block: 4px;
    margin-inline: auto;
  `,
  dot: css`
    fill: ${cssVar.colorPrimary};
  `,
  labelLink: css`
    cursor: pointer;

    &:hover text {
      fill: ${cssVar.colorPrimary};
    }
  `,
  labelMissing: css`
    font-size: 11px;
    fill: ${cssVar.colorTextQuaternary};
  `,
  labelName: css`
    font-size: 11px;
    fill: ${cssVar.colorTextSecondary};
  `,
  labelScore: css`
    font-size: 11px;
    font-weight: 600;
    fill: ${cssVar.colorText};
  `,
  polygon: css`
    fill: ${cssVar.colorPrimary};
    fill-opacity: 0.16;
    stroke: ${cssVar.colorPrimary};
    stroke-width: 1.5;
  `,
  ring: css`
    fill: none;
    stroke: ${cssVar.colorBorderSecondary};
    stroke-width: 1;
  `,
}));

const WIDTH = 240;
const HEIGHT = 204;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RADIUS = 58;
const LABEL_RADIUS = RADIUS + 12;
const RING_LEVELS = [0.25, 0.5, 0.75, 1];

const pointAt = (index: number, total: number, ratio: number): [number, number] => {
  const angle = ((-90 + (360 / total) * index) * Math.PI) / 180;

  return [CX + RADIUS * ratio * Math.cos(angle), CY + RADIUS * ratio * Math.sin(angle)];
};

const toPoints = (coords: [number, number][]) =>
  coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

interface ModelRatingRadarProps {
  dimensions: RadarDimensionDatum[];
}

const ModelRatingRadar: FC<ModelRatingRadarProps> = memo(({ dimensions }) => {
  const total = dimensions.length;

  return (
    <svg
      className={styles.container}
      height={HEIGHT}
      role={'img'}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
    >
      {RING_LEVELS.map((level) => (
        <polygon
          className={styles.ring}
          key={level}
          points={toPoints(dimensions.map((_, i) => pointAt(i, total, level)))}
        />
      ))}
      {dimensions.map((dimension, i) => {
        const [x, y] = pointAt(i, total, 1);

        return (
          <line
            className={dimension.score === undefined ? styles.axisMissing : styles.axis}
            key={dimension.key}
            x1={CX}
            x2={x}
            y1={CY}
            y2={y}
          />
        );
      })}
      {/* connect scored vertices only — plotting a missing dimension at the center would read as a real 0 */}
      <polygon
        className={styles.polygon}
        points={toPoints(
          dimensions.flatMap((d, i) =>
            d.score === undefined ? [] : [pointAt(i, total, d.score / 100)],
          ),
        )}
      />
      {dimensions.map((dimension, i) => {
        if (dimension.score === undefined) return null;
        const [x, y] = pointAt(i, total, dimension.score / 100);

        return <circle className={styles.dot} cx={x} cy={y} key={dimension.key} r={2.5} />;
      })}
      {dimensions.map((dimension, i) => {
        const angle = ((-90 + (360 / total) * i) * Math.PI) / 180;
        const x = CX + LABEL_RADIUS * Math.cos(angle);
        const y = CY + LABEL_RADIUS * Math.sin(angle);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        // keep the two-line label block clear of the vertex on top/bottom
        const baseY = sin < -0.3 ? y - 16 : sin > 0.3 ? y + 10 : y - 3;
        const missing = dimension.score === undefined;

        const label = (
          <g key={dimension.key}>
            {dimension.tooltip && <title>{dimension.tooltip}</title>}
            <text
              className={missing ? styles.labelMissing : styles.labelName}
              textAnchor={anchor}
              x={x}
              y={baseY}
            >
              {dimension.label}
            </text>
            <text
              className={missing ? styles.labelMissing : styles.labelScore}
              textAnchor={anchor}
              x={x}
              y={baseY + 13}
            >
              {missing ? '-' : dimension.score}
            </text>
          </g>
        );

        if (!dimension.sourceUrl || missing) return label;

        return (
          <a
            className={styles.labelLink}
            href={dimension.sourceUrl}
            key={dimension.key}
            // the whole radar can be a click target (benchmark modal) — a source
            // link click must not bubble into it
            rel={'noreferrer'}
            target={'_blank'}
            onClick={(e) => e.stopPropagation()}
          >
            {label}
          </a>
        );
      })}
    </svg>
  );
});

ModelRatingRadar.displayName = 'ModelRatingRadar';

export default ModelRatingRadar;
