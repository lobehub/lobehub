'use client';

import type { WidgetSeriesOutput, WidgetView } from '@lobechat/types';
import { AreaChart, BarChart, LineChart } from '@lobehub/charts';
import { Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardTrendSeries } from '@/services/dashboard';

import { formatWidgetValue } from '../../utils/format';
import { buildSeriesChartData } from '../../utils/series';

const CHARTS = { area: AreaChart, bar: BarChart, line: LineChart };

interface SeriesViewProps {
  chart?: WidgetView['chart'];
  height?: number | string;
  output: WidgetSeriesOutput;
  trend?: DashboardTrendSeries[];
}

const SeriesView = memo<SeriesViewProps>(({ output, trend, chart = 'line', height = '100%' }) => {
  const { t } = useTranslation('dashboard');
  const data = useMemo(() => buildSeriesChartData(output, trend), [output, trend]);
  const Chart = CHARTS[chart] ?? LineChart;

  if (data.rows.length === 0) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('widget.view.seriesEmpty')}
      </Text>
    );
  }

  return (
    <div data-series-source={data.fromHistory ? 'metric' : 'output'} style={{ height }}>
      <Chart
        categories={data.categories}
        data={data.rows}
        height={'100%'}
        index={'t'}
        showLegend={data.categories.length > 1}
        startEndOnly={data.rows.length > 12}
        yAxisWidth={48}
        valueFormatter={(value: number) =>
          output.unit ? `${formatWidgetValue(value)} ${output.unit}` : formatWidgetValue(value)
        }
      />
    </div>
  );
});

SeriesView.displayName = 'DashboardSeriesView';

export default SeriesView;
