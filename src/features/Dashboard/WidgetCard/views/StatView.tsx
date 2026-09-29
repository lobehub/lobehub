'use client';

import type { WidgetStatOutput } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import type { DashboardTrendSeries } from '@/services/dashboard';

import { formatDelta, formatWidgetValue } from '../../utils/format';
import TrendSparkline from './TrendSparkline';

const styles = createStaticStyles(({ css }) => ({
  value: css`
    font-size: 32px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: ${cssVar.colorText};
  `,
}));

const TREND_COLOR = {
  down: cssVar.colorError,
  flat: cssVar.colorTextTertiary,
  up: cssVar.colorSuccess,
};

interface StatViewProps {
  output: WidgetStatOutput;
  trend?: DashboardTrendSeries[];
}

const StatView = memo<StatViewProps>(({ output, trend }) => {
  const delta = formatDelta(output.delta);
  const values = trend?.[0]?.points.map((point) => point.value) ?? [];

  return (
    <Flexbox gap={4} height={'100%'} justify={'space-between'}>
      <Flexbox gap={4}>
        {output.label && (
          <Text fontSize={12} type={'secondary'}>
            {output.label}
          </Text>
        )}
        <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
          <span data-widget-value className={styles.value}>
            {formatWidgetValue(output.value)}
          </span>
          {output.unit && <Text type={'secondary'}>{output.unit}</Text>}
          {delta && (
            <Text fontSize={12} style={{ color: TREND_COLOR[output.trend ?? 'flat'] }} weight={500}>
              {delta}
            </Text>
          )}
        </Flexbox>
        {output.description && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {output.description}
          </Text>
        )}
      </Flexbox>
      <TrendSparkline values={values} />
    </Flexbox>
  );
});

StatView.displayName = 'DashboardStatView';

export default StatView;
