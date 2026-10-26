import {
  AreaChart,
  BarChart,
  BarList,
  DonutChart,
  FunnelChart,
  Heatmaps,
  Legend,
  LineChart,
  RadarChart,
  ScatterChart,
  SparkAreaChart,
  SparkBarChart,
  SparkLineChart,
  Tracker,
} from '@lobehub/charts';
import { Flexbox, useTheme } from '@lobehub/ui';
import { memo } from 'react';

import type { CanvasView } from '../element';
import { formatValue, heatmapLevel } from '../format';
import { donutLegendCategories, showsDonutTotal } from './donut';

type Props = Record<string, any>;

const usePaletteColors = (names: unknown): string[] | undefined => {
  const theme = useTheme() as unknown as Record<string, string>;
  if (!Array.isArray(names)) return;
  const colors = names.map((name) => theme[String(name)]).filter(Boolean);
  return colors.length > 0 ? colors : undefined;
};

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const baseChartProps = (props: Props) => ({
  categories: asArray(props.categories),
  data: asArray(props.data),
  height: props.height ?? 280,
  index: props.index,
  showLegend: props['show-legend'] ?? true,
  valueFormatter: (value: number) => formatValue(value, props['value-format'], props.unit),
});

const Area = memo<{ props: Props }>(({ props }) => (
  <AreaChart
    {...baseChartProps(props)}
    colors={usePaletteColors(props.colors)}
    stack={props.stack}
  />
));

const Bar = memo<{ props: Props }>(({ props }) => (
  <BarChart
    {...baseChartProps(props)}
    colors={usePaletteColors(props.colors)}
    layout={props.layout === 'horizontal' ? 'vertical' : 'horizontal'}
    stack={props.stack}
  />
));

const Line = memo<{ props: Props }>(({ props }) => (
  <LineChart {...baseChartProps(props)} colors={usePaletteColors(props.colors)} />
));

const Radar = memo<{ props: Props }>(({ props }) => (
  <RadarChart {...baseChartProps(props)} colors={usePaletteColors(props.colors)} />
));

const Scatter = memo<{ props: Props }>(({ props }) => (
  <ScatterChart
    category={props.category}
    colors={usePaletteColors(props.colors)}
    data={asArray(props.data)}
    height={props.height ?? 280}
    showLegend={props['show-legend'] ?? true}
    size={props.size}
    x={props.x}
    y={props.y}
  />
));

const Donut = memo<{ props: Props }>(({ props }) => {
  const colors = usePaletteColors(props.colors);
  const data = asArray(props.data);
  return (
    <Flexbox align={'center'} gap={12}>
      <DonutChart
        category={props.category}
        colors={colors}
        data={data}
        index={props.index}
        showLabel={showsDonutTotal(props)}
        valueFormatter={(value: number) => formatValue(value, props['value-format'], props.unit)}
        variant={props.variant ?? 'donut'}
      />
      <Legend categories={donutLegendCategories(data, props.index)} colors={colors} />
    </Flexbox>
  );
});

const Spark = memo<{ props: Props }>(({ props }) => {
  const colors = usePaletteColors(props.colors);
  const common = {
    categories: asArray(props.categories),
    colors,
    data: asArray(props.data),
    index: props.index,
  };
  if (props.kind === 'bar') return <SparkBarChart {...common} />;
  if (props.kind === 'line') return <SparkLineChart {...common} />;
  return <SparkAreaChart {...common} />;
});

const TrackerView = memo<{ props: Props }>(({ props }) => {
  const theme = useTheme() as unknown as Record<string, string>;
  const data = asArray(props.data).map((item: Props, index) => ({
    color: theme[item.color] ?? item.color,
    key: String(index),
    tooltip: item.tooltip,
  }));
  return <Tracker data={data} />;
});

const Heatmap = memo<{ props: Props }>(({ props }) => {
  const rows = asArray(props.data) as Props[];
  const max = Math.max(0, ...rows.map((row) => Number(row.count) || 0));
  const data = rows.map((row) => ({
    count: Number(row.count) || 0,
    date: String(row.date),
    level: typeof row.level === 'number' ? row.level : heatmapLevel(Number(row.count) || 0, max),
  }));
  return <Heatmaps data={data} />;
});

export const chartViews: Record<string, CanvasView> = {
  'lobe-area-chart': ({ props }) => <Area props={props} />,
  'lobe-bar-chart': ({ props }) => <Bar props={props} />,
  'lobe-bar-list': ({ props }) => (
    <BarList
      data={asArray(props.data)}
      valueFormatter={(value: number) => formatValue(value, props['value-format'], props.unit)}
    />
  ),
  'lobe-donut-chart': ({ props }) => <Donut props={props} />,
  'lobe-funnel-chart': ({ props }) => <FunnelChart data={asArray(props.data)} />,
  'lobe-heatmap': ({ props }) => <Heatmap props={props} />,
  'lobe-line-chart': ({ props }) => <Line props={props} />,
  'lobe-radar-chart': ({ props }) => <Radar props={props} />,
  'lobe-scatter-chart': ({ props }) => <Scatter props={props} />,
  'lobe-spark-chart': ({ props }) => <Spark props={props} />,
  'lobe-tracker': ({ props }) => <TrackerView props={props} />,
};
