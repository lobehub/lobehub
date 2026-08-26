'use client';

import type {
  VerifyBarChartView,
  VerifyHeatmapView,
  VerifyLineChartView,
  VerifyMetricComparisonView,
  VerifyScatterPlotView,
  VerifyTableView,
  VerifyVisualizationDataset,
  VerifyVisualizationManifest,
} from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  datasetForView,
  fieldLabel,
  fieldUnit,
  metricComparisonDelta,
  numberCell,
  stringCell,
  tableHighlightRows,
} from './visualization';

const styles = createStaticStyles(({ css }) => ({
  axisLabel: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  badge: css`
    display: inline-flex;
    gap: 3px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 5px;
    border-radius: 999px;

    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
  badgeWorse: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
  bar: css`
    overflow: hidden;
    height: 6px;
    border-radius: 999px;
    background: ${cssVar.colorFillSecondary};
  `,
  barChartLabel: css`
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
  barAfter: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorInfo};
  `,
  barBefore: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorTextQuaternary};
  `,
  body: css`
    min-width: 0;
    padding: 14px;
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  chart: css`
    display: block;
    width: 100%;
    min-height: 180px;
  `,
  context: css`
    padding-block: 8px 10px;
    padding-inline: 14px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  delta: css`
    display: inline-flex;
    gap: 3px;
    align-items: center;

    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorSuccess};
  `,
  deltaWorse: css`
    color: ${cssVar.colorError};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  heatmap: css`
    display: grid;
    gap: 3px;
    align-items: center;
  `,
  heatmapCell: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 34px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  `,
  metric: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(240px, 2.4fr) auto;
    gap: 16px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 14px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    @media (width <= 640px) {
      grid-template-columns: 1fr auto;
    }
  `,
  metricName: css`
    min-width: 0;
    font-weight: 500;
  `,
  sample: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  table: css`
    border-collapse: collapse;
    width: 100%;

    th,
    td {
      padding-block: 8px;
      padding-inline: 10px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      text-align: start;
      white-space: nowrap;
    }

    th {
      font-size: 11px;
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillQuaternary};
    }

    td {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
  `,
  tableBest: css`
    font-weight: 700;
    color: ${cssVar.colorInfo};
    background: ${cssVar.colorInfoBg};
  `,
  tableBestBadge: css`
    margin-inline-start: 5px;
    padding-block: 1px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 9px;
    font-weight: 700;
    color: ${cssVar.colorInfo};

    background: ${cssVar.colorInfoBgHover};
  `,
  tableScroll: css`
    overflow-x: auto;
  `,
  target: css`
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
  values: css`
    display: flex;
    flex-direction: column;
    gap: 9px;

    @media (width <= 640px) {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  `,
  valueText: css`
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
}));

const SERIES_COLORS = [
  cssVar.colorInfo,
  cssVar.colorWarning,
  cssVar.colorSuccess,
  cssVar.colorInfo,
  cssVar.colorError,
];

const lineSeriesColor = (style: VerifyLineChartView['encoding']['series'][number]['style']) => {
  if (style === 'muted') return cssVar.colorTextQuaternary;
  if (style === 'accent') return cssVar.colorWarning;
  return cssVar.colorInfo;
};

const formatValue = (value: number, unit?: string) => {
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)}${unit ? ` ${unit}` : ''}`;
};

const extent = (values: number[]) => {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum ? [minimum - 1, maximum + 1] : [minimum, maximum];
};

const scale = (value: number, domain: number[], range: number[]) =>
  range[0] + ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);

const ViewCard = memo<{
  children: ReactNode;
  context?: string;
  title?: string;
}>(({ children, context, title }) => {
  const { t } = useTranslation('verify');
  return (
    <div className={styles.card}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Icon icon={ChartNoAxesCombined} size={15} />
        <Text strong>{title ?? t('report.visualization.title')}</Text>
      </Flexbox>
      {children}
      {context && <div className={styles.context}>{context}</div>}
    </div>
  );
});

ViewCard.displayName = 'ViewCard';

const MetricComparisonRenderer = memo<{
  dataset: VerifyVisualizationDataset;
  view: VerifyMetricComparisonView;
}>(({ dataset, view }) => {
  const { t } = useTranslation('verify');
  return (
    <ViewCard context={view.context} title={view.title}>
      {dataset.rows.map((row, index) => {
        const before = numberCell(row, view.encoding.before);
        const after = numberCell(row, view.encoding.after);
        if (before === null || after === null) return null;
        const maximum = Math.max(Math.abs(before), Math.abs(after), 0.000_001);
        const direction = view.encoding.direction
          ? stringCell(row, view.encoding.direction)
          : 'lower';
        const improved = direction === 'higher' ? after >= before : after <= before;
        const delta = before === 0 ? null : ((after - before) / Math.abs(before)) * 100;
        const improvement = delta === null ? null : direction === 'higher' ? delta : -delta;
        const target = view.encoding.target ? numberCell(row, view.encoding.target) : null;
        const targetMet =
          target === null ? null : direction === 'higher' ? after >= target : after <= target;
        const unit = view.encoding.unit
          ? (stringCell(row, view.encoding.unit) ?? undefined)
          : fieldUnit(dataset, view.encoding.after);
        const DeltaIcon = after <= before ? ArrowDownRight : ArrowUpRight;

        return (
          <div className={styles.metric} key={`${stringCell(row, view.encoding.label)}-${index}`}>
            <Flexbox gap={2}>
              <span className={styles.metricName}>
                {stringCell(row, view.encoding.label) ?? t('report.visualization.unnamed')}
              </span>
              <Flexbox horizontal gap={8}>
                {view.encoding.statistic && (
                  <span className={styles.sample}>{stringCell(row, view.encoding.statistic)}</span>
                )}
                {(view.encoding.beforeSamples || view.encoding.afterSamples) && (
                  <span className={styles.sample}>
                    n=
                    {view.encoding.beforeSamples
                      ? (numberCell(row, view.encoding.beforeSamples) ?? '–')
                      : '–'}{' '}
                    →{' '}
                    {view.encoding.afterSamples
                      ? (numberCell(row, view.encoding.afterSamples) ?? '–')
                      : '–'}
                  </span>
                )}
              </Flexbox>
            </Flexbox>
            <div className={styles.values}>
              {(
                [
                  ['before', before, styles.barBefore],
                  ['after', after, styles.barAfter],
                ] as const
              ).map(([role, value, barClass]) => (
                <Flexbox gap={5} key={role}>
                  <span className={styles.valueText}>
                    <span>{t(`report.visualization.${role}`)}</span>
                    <strong>{formatValue(value, unit)}</strong>
                  </span>
                  <div className={styles.bar}>
                    <div
                      className={barClass}
                      style={{ width: `${Math.max(3, (Math.abs(value) / maximum) * 100)}%` }}
                    />
                  </div>
                </Flexbox>
              ))}
            </div>
            <Flexbox align={'flex-end'} gap={2}>
              {improvement !== null && (
                <span className={cx(styles.delta, !improved && styles.deltaWorse)}>
                  <Icon icon={DeltaIcon} size={13} />
                  {Math.abs(improvement).toFixed(1)}%
                </span>
              )}
              {target !== null && (
                <span className={styles.target}>
                  {t(
                    targetMet
                      ? 'report.visualization.targetMet'
                      : 'report.visualization.targetMissed',
                    { value: formatValue(target, unit) },
                  )}
                </span>
              )}
            </Flexbox>
          </div>
        );
      })}
    </ViewCard>
  );
});

MetricComparisonRenderer.displayName = 'MetricComparisonRenderer';

const LineChartRenderer = memo<{
  dataset: VerifyVisualizationDataset;
  view: VerifyLineChartView;
}>(({ dataset, view }) => {
  const points = dataset.rows
    .map((row) => ({ row, x: numberCell(row, view.encoding.x) }))
    .filter(
      (point): point is { row: (typeof dataset.rows)[number]; x: number } => point.x !== null,
    );
  const yValues = points.flatMap(({ row }) =>
    view.encoding.series
      .map((series) => numberCell(row, series.field))
      .filter((value): value is number => value !== null && Number.isFinite(value)),
  );
  if (points.length === 0 || yValues.length === 0) return null;
  const xDomain = extent(points.map((point) => point.x));
  const yDomain = extent(yValues);

  return (
    <ViewCard context={view.context} title={view.title}>
      <div className={styles.body}>
        <svg
          aria-label={view.title ?? 'Line chart'}
          className={styles.chart}
          role={'img'}
          viewBox={'0 0 640 230'}
        >
          <line stroke={cssVar.colorBorderSecondary} x1={48} x2={620} y1={198} y2={198} />
          <line stroke={cssVar.colorBorderSecondary} x1={48} x2={48} y1={12} y2={198} />
          {view.encoding.series.map((series, seriesIndex) => {
            const semanticStyle =
              series.style ??
              (view.encoding.series.length > 1 && seriesIndex === 0
                ? 'muted'
                : seriesIndex > 1
                  ? 'accent'
                  : 'primary');
            const color = lineSeriesColor(semanticStyle);
            const coordinates = points
              .map(({ row, x }) => {
                const y = numberCell(row, series.field);
                return y === null
                  ? null
                  : `${scale(x, xDomain, [48, 620])},${scale(y, yDomain, [198, 12])}`;
              })
              .filter(Boolean)
              .join(' ');
            return (
              <g key={series.field}>
                <polyline
                  fill={'none'}
                  points={coordinates}
                  stroke={color}
                  strokeDasharray={semanticStyle === 'muted' ? '5 4' : undefined}
                  strokeLinejoin={'round'}
                  strokeWidth={semanticStyle === 'muted' ? 1.5 : 2.5}
                />
                <text fill={color} fontSize={11} x={54 + seriesIndex * 130} y={18}>
                  {series.label ?? fieldLabel(dataset, series.field)}
                </text>
              </g>
            );
          })}
          <text fill={cssVar.colorTextTertiary} fontSize={10} textAnchor={'middle'} x={334} y={222}>
            {view.encoding.xLabel ?? fieldLabel(dataset, view.encoding.x)}
          </text>
          <text fill={cssVar.colorTextTertiary} fontSize={10} x={4} y={108}>
            {view.encoding.yLabel ?? ''}
          </text>
        </svg>
      </div>
    </ViewCard>
  );
});

LineChartRenderer.displayName = 'LineChartRenderer';

const ScatterPlotRenderer = memo<{
  dataset: VerifyVisualizationDataset;
  view: VerifyScatterPlotView;
}>(({ dataset, view }) => {
  const points = dataset.rows
    .map((row) => ({
      category: view.encoding.color ? stringCell(row, view.encoding.color) : null,
      label: view.encoding.label ? stringCell(row, view.encoding.label) : null,
      x: numberCell(row, view.encoding.x),
      y: numberCell(row, view.encoding.y),
    }))
    .filter(
      (point): point is typeof point & { x: number; y: number } =>
        point.x !== null && point.y !== null,
    );
  if (points.length === 0) return null;
  const xDomain = extent(points.map((point) => point.x));
  const yDomain = extent(points.map((point) => point.y));
  const categories = [...new Set(points.map((point) => point.category).filter(Boolean))];

  return (
    <ViewCard context={view.context} title={view.title}>
      <div className={styles.body}>
        <svg
          aria-label={view.title ?? 'Scatter plot'}
          className={styles.chart}
          role={'img'}
          viewBox={'0 0 640 230'}
        >
          <line stroke={cssVar.colorBorderSecondary} x1={48} x2={620} y1={198} y2={198} />
          <line stroke={cssVar.colorBorderSecondary} x1={48} x2={48} y1={12} y2={198} />
          {points.map((point, index) => {
            const colorIndex = point.category ? categories.indexOf(point.category) : 0;
            return (
              <circle
                cx={scale(point.x, xDomain, [48, 620])}
                cy={scale(point.y, yDomain, [198, 12])}
                fill={SERIES_COLORS[Math.max(0, colorIndex) % SERIES_COLORS.length]}
                key={`${point.label}-${index}`}
                opacity={0.75}
                r={4}
              >
                <title>{`${point.label ?? index}: ${point.x}, ${point.y}${point.category ? ` · ${point.category}` : ''}`}</title>
              </circle>
            );
          })}
          <text fill={cssVar.colorTextTertiary} fontSize={10} textAnchor={'middle'} x={334} y={222}>
            {view.encoding.xLabel ?? fieldLabel(dataset, view.encoding.x)}
          </text>
          <text fill={cssVar.colorTextTertiary} fontSize={10} x={4} y={108}>
            {view.encoding.yLabel ?? fieldLabel(dataset, view.encoding.y)}
          </text>
        </svg>
      </div>
    </ViewCard>
  );
});

ScatterPlotRenderer.displayName = 'ScatterPlotRenderer';

const HeatmapRenderer = memo<{
  dataset: VerifyVisualizationDataset;
  view: VerifyHeatmapView;
}>(({ dataset, view }) => {
  const xValues = [...new Set(dataset.rows.map((row) => stringCell(row, view.encoding.x)))].filter(
    Boolean,
  ) as string[];
  const yValues = [...new Set(dataset.rows.map((row) => stringCell(row, view.encoding.y)))].filter(
    Boolean,
  ) as string[];
  const values = dataset.rows
    .map((row) => numberCell(row, view.encoding.value))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (xValues.length === 0 || yValues.length === 0 || values.length === 0) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 0.000_001);
  const byCoordinate = new Map(
    dataset.rows.map((row) => [
      `${stringCell(row, view.encoding.x)}\0${stringCell(row, view.encoding.y)}`,
      numberCell(row, view.encoding.value),
    ]),
  );

  return (
    <ViewCard context={view.context} title={view.title}>
      <div className={styles.body}>
        <div
          className={styles.heatmap}
          style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${xValues.length}, 1fr)` }}
        >
          <span />
          {xValues.map((value) => (
            <span className={styles.axisLabel} key={value} style={{ textAlign: 'center' }}>
              {value}
            </span>
          ))}
          {yValues.map((y) => (
            <Fragment key={y}>
              <span className={styles.axisLabel}>{y}</span>
              {xValues.map((x) => {
                const value = byCoordinate.get(`${x}\0${y}`);
                const intensity =
                  typeof value === 'number' ? 0.14 + ((value - minimum) / span) * 0.76 : 0;
                return (
                  <span
                    className={styles.heatmapCell}
                    key={`${x}-${y}`}
                    style={{
                      background: `color-mix(in srgb, ${cssVar.colorInfo} ${intensity * 100}%, ${cssVar.colorBgContainer})`,
                      color: intensity > 0.58 ? cssVar.colorTextLightSolid : cssVar.colorText,
                    }}
                  >
                    {typeof value === 'number' ? formatValue(value) : '–'}
                  </span>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </ViewCard>
  );
});

HeatmapRenderer.displayName = 'HeatmapRenderer';

const BarChartRenderer = memo<{
  dataset: VerifyVisualizationDataset;
  view: VerifyBarChartView;
}>(({ dataset, view }) => {
  const categories = dataset.rows
    .map((row) => stringCell(row, view.encoding.category))
    .filter((value): value is string => value !== null);
  const values = dataset.rows.flatMap((row) =>
    view.encoding.series
      .map((series) => numberCell(row, series.field))
      .filter((value): value is number => value !== null),
  );
  if (categories.length === 0 || values.length === 0) return null;
  const maximum = Math.max(...values, 0.000_001);
  const plotWidth = 552;
  const groupWidth = plotWidth / dataset.rows.length;
  const barWidth = Math.min(30, (groupWidth - 12) / view.encoding.series.length);

  return (
    <ViewCard context={view.context} title={view.title}>
      <div className={styles.body}>
        <svg
          aria-label={view.title ?? 'Bar chart'}
          className={styles.chart}
          role={'img'}
          viewBox={'0 0 640 250'}
        >
          <line stroke={cssVar.colorBorderSecondary} x1={56} x2={608} y1={205} y2={205} />
          {dataset.rows.map((row, rowIndex) => {
            const groupStart = 56 + rowIndex * groupWidth;
            return (
              <g key={`${categories[rowIndex]}-${rowIndex}`}>
                {view.encoding.series.map((series, seriesIndex) => {
                  const value = numberCell(row, series.field);
                  if (value === null) return null;
                  const height = (value / maximum) * 172;
                  return (
                    <rect
                      fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                      height={height}
                      key={series.field}
                      rx={3}
                      width={barWidth}
                      x={groupStart + 6 + seriesIndex * barWidth}
                      y={205 - height}
                    >
                      <title>{`${categories[rowIndex]} · ${series.label ?? fieldLabel(dataset, series.field)}: ${formatValue(value, fieldUnit(dataset, series.field))}`}</title>
                    </rect>
                  );
                })}
                <text
                  className={styles.barChartLabel}
                  fill={cssVar.colorTextSecondary}
                  textAnchor={'middle'}
                  x={groupStart + groupWidth / 2}
                  y={224}
                >
                  {categories[rowIndex]}
                </text>
              </g>
            );
          })}
          {view.encoding.series.map((series, index) => (
            <text
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              fontSize={11}
              key={series.field}
              x={58 + index * 140}
              y={16}
            >
              {series.label ?? fieldLabel(dataset, series.field)}
            </text>
          ))}
          {view.encoding.valueLabel && (
            <text fill={cssVar.colorTextTertiary} fontSize={10} x={4} y={112}>
              {view.encoding.valueLabel}
            </text>
          )}
        </svg>
      </div>
    </ViewCard>
  );
});

BarChartRenderer.displayName = 'BarChartRenderer';

const TableRenderer = memo<{
  dataset: VerifyVisualizationDataset;
  view: VerifyTableView;
}>(({ dataset, view }) => {
  const requested = view.encoding?.columns;
  const fields = requested
    ? requested.flatMap((key) => dataset.fields.filter((field) => field.key === key))
    : dataset.fields;
  const highlightedRows = new Map(
    view.encoding?.highlights?.map((highlight) => [
      highlight.field,
      tableHighlightRows(dataset, highlight.field, highlight.mode),
    ]),
  );
  return (
    <ViewCard context={view.context} title={view.title}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.key}>{field.label ?? field.key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.rows.map((row, index) => (
              <tr key={index}>
                {fields.map((field) => {
                  const isBest = highlightedRows.get(field.key)?.has(index) ?? false;
                  return (
                    <td className={isBest ? styles.tableBest : undefined} key={field.key}>
                      {String(row[field.key] ?? '–')}
                      {isBest && <span className={styles.tableBestBadge}>SOTA</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ViewCard>
  );
});

TableRenderer.displayName = 'TableRenderer';

export const VisualizationDeltaBadge = memo<{
  manifest: VerifyVisualizationManifest;
}>(({ manifest }) => {
  const view = manifest.views.find((item) => item.type === 'metric-comparison');
  if (!view || view.type !== 'metric-comparison') return null;
  const dataset = datasetForView(manifest, view);
  if (!dataset) return null;
  const delta = metricComparisonDelta(dataset, view);
  if (!delta) return null;
  const improved = delta.improvement >= 0;
  const DeltaIcon = delta.after <= delta.before ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={cx(styles.badge, !improved && styles.badgeWorse)}>
      <Icon icon={DeltaIcon} size={11} />
      {Math.abs(delta.improvement).toFixed(1)}%
    </span>
  );
});

VisualizationDeltaBadge.displayName = 'VisualizationDeltaBadge';

export const VisualizationRenderer = memo<{
  manifest: VerifyVisualizationManifest;
}>(({ manifest }) => (
  <Flexbox gap={12}>
    {manifest.views.map((view) => {
      const dataset = datasetForView(manifest, view);
      if (!dataset) return null;
      switch (view.type) {
        case 'bar-chart': {
          return <BarChartRenderer dataset={dataset} key={view.id} view={view} />;
        }
        case 'heatmap': {
          return <HeatmapRenderer dataset={dataset} key={view.id} view={view} />;
        }
        case 'line-chart': {
          return <LineChartRenderer dataset={dataset} key={view.id} view={view} />;
        }
        case 'metric-comparison': {
          return <MetricComparisonRenderer dataset={dataset} key={view.id} view={view} />;
        }
        case 'scatter-plot': {
          return <ScatterPlotRenderer dataset={dataset} key={view.id} view={view} />;
        }
        case 'table': {
          return <TableRenderer dataset={dataset} key={view.id} view={view} />;
        }
      }
    })}
  </Flexbox>
));

VisualizationRenderer.displayName = 'VisualizationRenderer';
