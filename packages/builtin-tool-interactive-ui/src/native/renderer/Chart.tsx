import { AreaChart, BarChart, LineChart } from '@lobehub/charts';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sampleNativeChart } from '../engine';
import type { NativeUIDocument, NativeUINode, NativeUIState } from '../types';
import {
  chartAreaPath,
  chartLinePath,
  chartSegments,
  chartTicks,
  getChartDomain,
  isFiniteNumber,
  projectChartPoint,
} from './chartGeometry';
import { displayChartNumber, displayValue } from './display';
import { styles } from './styles';

type ChartNode = Extract<NativeUINode, { type: 'chart' }>;
type ChartSample = ReturnType<typeof sampleNativeChart>;

const charts = { area: AreaChart, bar: BarChart, line: LineChart };
const palette = [
  cssVar.geekblue,
  cssVar.green,
  cssVar.gold,
  cssVar.purple,
  cssVar.cyan,
  cssVar.red,
];
const colorTokens = {
  blue: cssVar.geekblue,
  cyan: cssVar.cyan,
  green: cssVar.green,
  orange: cssVar.gold,
  purple: cssVar.purple,
  red: cssVar.red,
};

const seriesColor = (series: ChartNode['series'][number], index: number): string =>
  series.color ? colorTokens[series.color] : palette[index % palette.length];

/** Text keeps its host size on narrow replies instead of shrinking with a fixed viewBox. */
const useChartWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(Math.max(160, Math.round(next)));
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  return { ref, width };
};

/**
 * @lobehub/charts 5.x cannot render an externally controlled numeric x cursor or
 * reference dots. This bounded React SVG shares the exact sampled expressions and
 * scale with the current-value markers; ordinary charts use the host library below.
 */
const CursorPlot = ({
  node,
  sample,
  locale,
  label,
}: {
  label: string;
  locale?: string;
  node: ChartNode;
  sample: ChartSample;
}) => {
  const { ref, width } = useChartWidth();
  const titleId = useId();
  const clipId = useId();
  const height = width < 400 ? 240 : 288;
  const bounds = { bottom: height - 32, left: width < 400 ? 44 : 56, right: width - 12, top: 16 };
  const xDomain = { max: node.x.max, min: node.x.min };
  const currentInRange =
    isFiniteNumber(sample.currentX) &&
    sample.currentX >= node.x.min &&
    sample.currentX <= node.x.max;
  const yDomain = getChartDomain([
    ...sample.data.flatMap((row) => node.series.map((series) => row[series.id])),
    ...(currentInRange ? Object.values(sample.currentValues) : []),
  ]);
  const baseline = projectChartPoint({ x: node.x.min, y: 0 }, xDomain, yDomain, bounds)!.y;
  const cursor = currentInRange
    ? projectChartPoint({ x: sample.currentX!, y: yDomain.min }, xDomain, yDomain, bounds)
    : null;
  const barWidth = Math.min(
    32,
    ((bounds.right - bounds.left) / Math.max(1, sample.data.length) / node.series.length) * 0.8,
  );

  return (
    <div className={styles.chart} ref={ref}>
      <svg
        aria-labelledby={titleId}
        className={styles.chartDrawing}
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title id={titleId}>{label}</title>
        <desc>
          {node.series.map((series) => series.label).join(', ')}. {node.x.label}: {node.x.min}–
          {node.x.max}. {node.yLabel}
        </desc>
        <defs>
          <clipPath id={clipId}>
            <rect
              height={bounds.bottom - bounds.top + 12}
              width={bounds.right - bounds.left + 12}
              x={bounds.left - 6}
              y={bounds.top - 6}
            />
          </clipPath>
        </defs>
        {chartTicks(yDomain).map((value, index) => {
          const point = projectChartPoint({ x: node.x.min, y: value }, xDomain, yDomain, bounds)!;
          return (
            <g key={index}>
              <line
                stroke={cssVar.colorBorderSecondary}
                x1={bounds.left}
                x2={bounds.right}
                y1={point.y}
                y2={point.y}
              />
              <text
                className={styles.chartAxis}
                dominantBaseline="middle"
                textAnchor="end"
                x={bounds.left - 8}
                y={point.y}
              >
                {displayChartNumber(value, locale)}
              </text>
            </g>
          );
        })}
        {chartTicks(xDomain, width < 400 ? 3 : 5).map((value, index) => {
          const point = projectChartPoint({ x: value, y: yDomain.min }, xDomain, yDomain, bounds)!;
          return (
            <text
              className={styles.chartAxis}
              key={index}
              textAnchor={index === 0 ? 'start' : value === xDomain.max ? 'end' : 'middle'}
              x={point.x}
              y={bounds.bottom + 24}
            >
              {displayChartNumber(value, locale)}
            </text>
          );
        })}
        <g clipPath={`url(#${clipId})`}>
          {cursor && (
            <line
              data-native-chart-cursor={sample.currentX}
              stroke={cssVar.colorTextTertiary}
              strokeDasharray="4 4"
              x1={cursor.x}
              x2={cursor.x}
              y1={bounds.top}
              y2={bounds.bottom}
            />
          )}
          {node.series.map((series, index) => {
            const color = seriesColor(series, index);
            const segments = chartSegments(sample.data, series.id, xDomain, yDomain, bounds);
            const currentValue = sample.currentValues[series.id];
            const marker =
              cursor && isFiniteNumber(currentValue)
                ? projectChartPoint(
                    { x: sample.currentX!, y: currentValue },
                    xDomain,
                    yDomain,
                    bounds,
                  )
                : null;
            return (
              <g key={series.id}>
                {segments.map((segment, segmentIndex) =>
                  node.chartType === 'bar' ? (
                    <g key={segmentIndex}>
                      {segment.map((point, pointIndex) => (
                        <rect
                          fill={color}
                          height={Math.abs(baseline - point.y)}
                          key={pointIndex}
                          rx={2}
                          width={barWidth}
                          x={point.x + (index - node.series.length / 2) * barWidth}
                          y={Math.min(baseline, point.y)}
                        />
                      ))}
                    </g>
                  ) : (
                    <g key={segmentIndex}>
                      {node.chartType === 'area' && (
                        <path d={chartAreaPath(segment, baseline)} fill={color} fillOpacity={0.1} />
                      )}
                      <path
                        d={chartLinePath(segment)}
                        fill="none"
                        stroke={color}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                      />
                      {segment.length === 1 && (
                        <circle cx={segment[0].x} cy={segment[0].y} fill={color} r={3} />
                      )}
                    </g>
                  ),
                )}
                {marker && (
                  <circle
                    cx={marker.x}
                    cy={marker.y}
                    data-native-chart-marker={series.id}
                    fill={color}
                    r={5}
                    stroke={cssVar.colorBgContainer}
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

export const NativeChart = ({
  node,
  document,
  state,
  locale,
}: {
  document: NativeUIDocument;
  locale?: string;
  node: ChartNode;
  state: NativeUIState;
}) => {
  const { t } = useTranslation('plugin');
  const sample = sampleNativeChart(node, document, state);
  const Chart = charts[node.chartType];
  const hasCursor = node.currentX !== undefined;
  const hasData = sample.data.some((row) =>
    node.series.some((series) => isFiniteNumber(row[series.id])),
  );
  const currentLabel = t('builtins.lobe-interactive-ui.chart.currentValue', {
    label: node.x.label || node.title || document.title,
  });

  return (
    <Flexbox as="figure" className={styles.chart} gap={8}>
      {node.title && <h4 className={styles.heading}>{node.title}</h4>}
      {node.description && <p className={styles.caption}>{node.description}</p>}
      {node.yLabel && <span className={styles.caption}>{node.yLabel}</span>}
      {!hasData ? (
        <p className={styles.caption} role="status">
          {t('builtins.lobe-interactive-ui.chart.empty')}
        </p>
      ) : hasCursor ? (
        <CursorPlot
          label={node.title || document.title}
          locale={locale}
          node={node}
          sample={sample}
        />
      ) : (
        <Chart
          categories={node.series.map((series) => series.id)}
          colors={node.series.map(seriesColor)}
          data={sample.data}
          height={272}
          index="x"
          showAnimation={false}
          showLegend={false}
          valueFormatter={(value) => displayChartNumber(value, locale)}
          xAxisLabelFormatter={(value) => displayChartNumber(Number(value), locale)}
          yAxisWidth={56}
          customCategories={Object.fromEntries(
            node.series.map((series) => [series.id, series.label]),
          )}
        />
      )}
      {node.x.label && (
        <Flexbox align="center">
          <span className={styles.caption}>{node.x.label}</span>
        </Flexbox>
      )}
      <Flexbox
        horizontal
        as="figcaption"
        className={styles.chartLegend}
        gap={16}
        justify="center"
        wrap="wrap"
      >
        {node.series.map((series, index) => (
          <Flexbox horizontal align="center" gap={8} key={series.id}>
            <span
              className={styles.chartSwatch}
              style={{ background: seriesColor(series, index) }}
            />
            <span>
              {series.label}
              {hasCursor && ` ${displayValue(sample.currentValues[series.id] ?? null, locale)}`}
            </span>
          </Flexbox>
        ))}
        {hasCursor && sample.currentX !== null && (
          <span>
            {currentLabel}: {displayValue(sample.currentX, locale)}
          </span>
        )}
      </Flexbox>
    </Flexbox>
  );
};
