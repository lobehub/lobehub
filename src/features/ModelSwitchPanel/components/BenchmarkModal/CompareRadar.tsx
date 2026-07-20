import { createStaticStyles } from 'antd-style';
import type { FC } from 'react';
import { memo } from 'react';

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
  /** aligned with the dimensions array; undefined = no data (vertex omitted) */
  scores: (number | undefined)[];
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
    margin-inline: auto;
  `,
  labelMissing: css`
    font-size: 12px;
    fill: ${cssVar.colorTextQuaternary};
  `,
  labelName: css`
    font-size: 12px;
    fill: ${cssVar.colorTextSecondary};
  `,
  labelScore: css`
    font-size: 12px;
    font-weight: 600;
    fill: ${cssVar.colorText};
  `,
  ring: css`
    fill: none;
    stroke: ${cssVar.colorBorderSecondary};
    stroke-width: 1;
  `,
}));

const WIDTH = 400;
const HEIGHT = 300;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RADIUS = 96;
const LABEL_RADIUS = RADIUS + 18;
const RING_LEVELS = [0.25, 0.5, 0.75, 1];

const pointAt = (index: number, total: number, ratio: number): [number, number] => {
  const angle = ((-90 + (360 / total) * index) * Math.PI) / 180;

  return [CX + RADIUS * ratio * Math.cos(angle), CY + RADIUS * ratio * Math.sin(angle)];
};

const toPoints = (coords: [number, number][]) =>
  coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

interface CompareRadarProps {
  dimensions: CompareRadarDimension[];
  series: CompareRadarSeries[];
}

/**
 * Multi-series variant of ModelRatingRadar for the benchmark modal: overlays up
 * to MAX_COMPARE_MODELS polygons. With a single series the vertex labels carry
 * the scores; with more, scores move to the table below to avoid clutter.
 */
const CompareRadar: FC<CompareRadarProps> = memo(({ dimensions, series }) => {
  const total = dimensions.length;
  const single = series.length === 1;

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
        const missing = series.every((s) => s.scores[i] === undefined);

        return (
          <line
            className={missing ? styles.axisMissing : styles.axis}
            key={dimension.key}
            x1={CX}
            x2={x}
            y1={CY}
            y2={y}
          />
        );
      })}
      {series.map((s) => (
        <g key={s.id}>
          {/* connect scored vertices only — a missing dimension at the center would read as a real 0 */}
          <polygon
            fill={s.color}
            fillOpacity={0.12}
            stroke={s.color}
            strokeWidth={1.5}
            points={toPoints(
              s.scores.flatMap((score, i) =>
                score === undefined ? [] : [pointAt(i, total, score / 100)],
              ),
            )}
          />
          {s.scores.map((score, i) => {
            if (score === undefined) return null;
            const [x, y] = pointAt(i, total, score / 100);

            return <circle cx={x} cy={y} fill={s.color} key={dimensions[i].key} r={3} />;
          })}
        </g>
      ))}
      {dimensions.map((dimension, i) => {
        const angle = ((-90 + (360 / total) * i) * Math.PI) / 180;
        const x = CX + LABEL_RADIUS * Math.cos(angle);
        const y = CY + LABEL_RADIUS * Math.sin(angle);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        const missing = series.every((s) => s.scores[i] === undefined);
        // single series shows a two-line label block (name + score) like the small radar
        const baseY = single
          ? sin < -0.3
            ? y - 16
            : sin > 0.3
              ? y + 10
              : y - 3
          : sin < -0.3
            ? y - 6
            : sin > 0.3
              ? y + 14
              : y + 4;

        return (
          <g key={dimension.key}>
            <text
              className={missing ? styles.labelMissing : styles.labelName}
              textAnchor={anchor}
              x={x}
              y={baseY}
            >
              {dimension.label}
            </text>
            {single && (
              <text
                className={missing ? styles.labelMissing : styles.labelScore}
                textAnchor={anchor}
                x={x}
                y={baseY + 15}
              >
                {series[0].scores[i] ?? '-'}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

CompareRadar.displayName = 'CompareRadar';

export default CompareRadar;
