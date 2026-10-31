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
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import {
  datasetForView,
  fieldLabel,
  fieldUnit,
  metricComparisonDelta,
  numberCell,
  stringCell,
  tableHighlightRows,
} from './visualization';

const styles = stylex.create({
  axisLabel: { fontSize: '11px', color: cssVar.colorTextTertiary },
  badge: {
    display: 'inline-flex',
    gap: '3px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '5px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
  badgeWorse: {
    color: cssVar.colorError,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
  bar: {
    overflow: 'hidden',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  barChartLabel: { fontSize: '11px', color: cssVar.colorTextSecondary },
  barAfter: {
    height: '100%',
    borderRadius: 'inherit',
    backgroundColor: cssVar.colorInfo,
    backgroundImage: 'none',
  },
  barBefore: {
    height: '100%',
    borderRadius: 'inherit',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  body: { minWidth: '0', padding: '14px' },
  card: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  chart: { display: 'block', width: '100%', minHeight: '180px' },
  context: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '10px',
    paddingInline: '14px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  delta: {
    display: 'inline-flex',
    gap: '3px',
    alignItems: 'center',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorSuccess,
  },
  deltaWorse: { color: cssVar.colorError },
  header: {
    paddingBlock: '10px',
    paddingInline: '14px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  heatmap: { display: 'grid', gap: '3px', alignItems: 'center' },
  heatmapCell: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '34px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '11px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  metric: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(120px, 1fr) minmax(240px, 2.4fr) auto',
      '@media (width <= 640px)': '1fr auto',
    },
    gap: '16px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '14px',
    borderBlockStartWidth: { default: null, [stylex.when.siblingBefore(':is(*)')]: '1px' },
    borderBlockStartStyle: { default: null, [stylex.when.siblingBefore(':is(*)')]: 'solid' },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)')]: cssVar.colorBorderSecondary,
    },
  },
  metricName: { minWidth: '0', fontWeight: 500 },
  sample: { fontSize: '11px', color: cssVar.colorTextTertiary },
  table: { borderCollapse: 'collapse', width: '100%' },
  /* The table cells are styled per element: StyleX has no descendant selectors. */
  cell: {
    paddingBlock: '8px',
    paddingInline: '10px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    textAlign: 'start',
    whiteSpace: 'nowrap',
  },
  th: {
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  td: { fontSize: '12px', fontVariantNumeric: 'tabular-nums' },
  tableBest: {
    fontWeight: 700,
    color: cssVar.colorInfo,
    backgroundColor: cssVar.colorInfoBg,
    backgroundImage: 'none',
  },
  tableBestBadge: {
    marginInlineStart: '5px',
    paddingBlock: '1px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: 700,
    color: cssVar.colorInfo,
    backgroundColor: cssVar.colorInfoBgHover,
    backgroundImage: 'none',
  },
  tableScroll: { overflowX: 'auto' },
  target: { fontSize: '11px', color: cssVar.colorTextSecondary },
  values: {
    display: 'flex',
    flexDirection: 'column',
    gap: '9px',
    gridColumn: { 'default': null, '@media (width <= 640px)': '1 / -1' },
    gridRow: { 'default': null, '@media (width <= 640px)': 2 },
  },
  valueText: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
  },
});

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
    <div {...stylex.props(styles.card)}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <Icon icon={ChartNoAxesCombined} size={15} />
        <Text strong>{title ?? t('report.visualization.title')}</Text>
      </Flexbox>
      {children}
      {context && <div {...stylex.props(styles.context)}>{context}</div>}
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
          <div
            {...stylex.props(styles.metric, stylex.defaultMarker())}
            key={`${stringCell(row, view.encoding.label)}-${index}`}
          >
            <Flexbox gap={2}>
              <span {...stylex.props(styles.metricName)}>
                {stringCell(row, view.encoding.label) ?? t('report.visualization.unnamed')}
              </span>
              <Flexbox horizontal gap={8}>
                {view.encoding.statistic && (
                  <span {...stylex.props(styles.sample)}>
                    {stringCell(row, view.encoding.statistic)}
                  </span>
                )}
                {(view.encoding.beforeSamples || view.encoding.afterSamples) && (
                  <span {...stylex.props(styles.sample)}>
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
            <div {...stylex.props(styles.values)}>
              {(
                [
                  ['before', before, styles.barBefore],
                  ['after', after, styles.barAfter],
                ] as const
              ).map(([role, value, barStyle]) => (
                <Flexbox gap={5} key={role}>
                  <span {...stylex.props(styles.valueText)}>
                    <span>{t(`report.visualization.${role}`)}</span>
                    <strong>{formatValue(value, unit)}</strong>
                  </span>
                  <div {...stylex.props(styles.bar)}>
                    <div
                      {...sx([barStyle], undefined, {
                        width: `${Math.max(3, (Math.abs(value) / maximum) * 100)}%`,
                      })}
                    />
                  </div>
                </Flexbox>
              ))}
            </div>
            <Flexbox align={'flex-end'} gap={2}>
              {improvement !== null && (
                <span {...stylex.props(styles.delta, !improved && styles.deltaWorse)}>
                  <Icon icon={DeltaIcon} size={13} />
                  {Math.abs(improvement).toFixed(1)}%
                </span>
              )}
              {target !== null && (
                <span {...stylex.props(styles.target)}>
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
      <div {...stylex.props(styles.body)}>
        <svg
          aria-label={view.title ?? 'Line chart'}
          {...stylex.props(styles.chart)}
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
      <div {...stylex.props(styles.body)}>
        <svg
          aria-label={view.title ?? 'Scatter plot'}
          {...stylex.props(styles.chart)}
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
      <div {...stylex.props(styles.body)}>
        <div
          {...sx([styles.heatmap], undefined, {
            gridTemplateColumns: `minmax(64px, auto) repeat(${xValues.length}, 1fr)`,
          })}
        >
          <span />
          {xValues.map((value) => (
            <span {...sx([styles.axisLabel], undefined, { textAlign: 'center' })} key={value}>
              {value}
            </span>
          ))}
          {yValues.map((y) => (
            <Fragment key={y}>
              <span {...stylex.props(styles.axisLabel)}>{y}</span>
              {xValues.map((x) => {
                const value = byCoordinate.get(`${x}\0${y}`);
                const intensity =
                  typeof value === 'number' ? 0.14 + ((value - minimum) / span) * 0.76 : 0;
                return (
                  <span
                    key={`${x}-${y}`}
                    {...sx([styles.heatmapCell], undefined, {
                      background: `color-mix(in srgb, ${cssVar.colorInfo} ${intensity * 100}%, ${cssVar.colorBgContainer})`,
                      color: intensity > 0.58 ? cssVar.colorTextLightSolid : cssVar.colorText,
                    })}
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
      <div {...stylex.props(styles.body)}>
        <svg
          aria-label={view.title ?? 'Bar chart'}
          {...stylex.props(styles.chart)}
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
                  {...stylex.props(styles.barChartLabel)}
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
      <div {...stylex.props(styles.tableScroll)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              {fields.map((field) => (
                <th {...stylex.props(styles.cell, styles.th)} key={field.key}>
                  {field.label ?? field.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.rows.map((row, index) => (
              <tr key={index}>
                {fields.map((field) => {
                  const isBest = highlightedRows.get(field.key)?.has(index) ?? false;
                  return (
                    <td
                      {...stylex.props(styles.cell, styles.td, isBest && styles.tableBest)}
                      key={field.key}
                    >
                      {String(row[field.key] ?? '–')}
                      {isBest && <span {...stylex.props(styles.tableBestBadge)}>SOTA</span>}
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
    <span {...stylex.props(styles.badge, !improved && styles.badgeWorse)}>
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
