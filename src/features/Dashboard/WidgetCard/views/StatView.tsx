'use client';

import type { WidgetStatOutput } from '@lobechat/types';
import { createStaticStyles, cssVar,Flexbox, Icon, Text   } from '@lobehub/ui';
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

import type { DashboardTrendSeries } from '@/services/dashboard';

import { formatDelta, formatWidgetValue } from '../../utils/format';
import TrendSparkline from './TrendSparkline';

const styles = createStaticStyles(({ css }) => ({
  delta: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 4px 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 18px;
  `,
  label: css`
    @container (max-height: 96px) {
      display: none;
    }
  `,
  sparkline: css`
    flex: 1;

    min-height: 28px;
    max-height: 96px;
    margin-block-start: 4px;

    /* Room for the latest-point marker, which sits on the plot edge. */
    padding-block: 4px;
    padding-inline-end: 4px;
  `,
  unit: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    overflow: hidden;

    min-width: 0;

    /* Fit the card both ways: long strings (versions, ids) shrink by their length. */
    font-size: clamp(20px, min(calc(160cqi / var(--chars)), 16cqi, 40cqh), 44px);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    letter-spacing: -0.02em;
    white-space: nowrap;
  `,
}));

const TREND = {
  down: {
    background: `color-mix(in srgb, ${cssVar.colorError} 12%, transparent)`,
    color: cssVar.colorError,
    icon: ArrowDownRightIcon,
  },
  flat: {
    background: cssVar.colorFillTertiary,
    color: cssVar.colorTextSecondary,
    icon: ArrowRightIcon,
  },
  up: {
    background: `color-mix(in srgb, ${cssVar.colorSuccess} 12%, transparent)`,
    color: cssVar.colorSuccess,
    icon: ArrowUpRightIcon,
  },
};

interface StatViewProps {
  output: WidgetStatOutput;
  trend?: DashboardTrendSeries[];
}

const StatView = memo<StatViewProps>(({ output, trend }) => {
  const delta = formatDelta(output.delta);
  const values = trend?.[0]?.points.map((point) => point.value) ?? [];
  const tone = TREND[output.trend ?? 'flat'];
  const value = formatWidgetValue(output.value);

  return (
    <Flexbox gap={6} height={'100%'}>
      {output.label && (
        <Text ellipsis className={styles.label} fontSize={12} type={'secondary'}>
          {output.label}
        </Text>
      )}
      <Flexbox horizontal align={'baseline'} gap={6} style={{ minWidth: 0 }}>
        <span
          data-widget-value
          className={styles.value}
          style={{ '--chars': Math.max(value.length, 4) } as CSSProperties}
        >
          {value}
        </span>
        {output.unit && <span className={styles.unit}>{output.unit}</span>}
      </Flexbox>
      {(delta || output.description) && (
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {delta && (
            <span
              className={styles.delta}
              data-widget-delta={output.trend ?? 'flat'}
              style={{ background: tone.background, color: tone.color }}
            >
              <Icon icon={tone.icon} size={12} />
              {delta}
            </span>
          )}
          {output.description && (
            <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
              {output.description}
            </Text>
          )}
        </Flexbox>
      )}
      {values.length > 1 && (
        <div className={styles.sparkline}>
          <TrendSparkline values={values} />
        </div>
      )}
    </Flexbox>
  );
});

StatView.displayName = 'DashboardStatView';

export default StatView;
