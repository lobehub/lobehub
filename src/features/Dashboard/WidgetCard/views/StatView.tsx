'use client';

import type { WidgetStatOutput } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

import type { DashboardTrendSeries } from '@/services/dashboard';

import { formatDelta, formatWidgetValue } from '../../utils/format';
import TrendSparkline from './TrendSparkline';

const styles = stylex.create({
  delta: {
    display: 'inline-flex',
    gap: '2px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInlineStart: '4px',
    paddingInlineEnd: '6px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '18px',
  },
  label: { display: { 'default': null, '@container (max-height: 96px)': 'none' } },
  sparkline: {
    flex: '1',
    minHeight: '28px',
    maxHeight: '96px',
    marginBlockStart: '4px',
    paddingBlock: '4px',
    paddingInlineEnd: '4px',
  },
  unit: { fontSize: '14px', fontWeight: 500, color: cssVar.colorTextTertiary },
  value: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: 'clamp(20px, min(calc(160cqi / var(--chars)), 16cqi, 40cqh), 44px)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.05,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
  },
});

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
        <Text
          ellipsis
          className={stylex.props(styles.label).className}
          fontSize={12}
          type={'secondary'}
        >
          {output.label}
        </Text>
      )}
      <Flexbox horizontal align={'baseline'} gap={6} style={{ minWidth: 0 }}>
        <span
          data-widget-value
          className={stylex.props(styles.value).className}
          style={{ '--chars': Math.max(value.length, 4) } as CSSProperties}
        >
          {value}
        </span>
        {output.unit && <span {...stylex.props(styles.unit)}>{output.unit}</span>}
      </Flexbox>
      {(delta || output.description) && (
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {delta && (
            <span
              className={stylex.props(styles.delta).className}
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
        <div {...stylex.props(styles.sparkline)}>
          <TrendSparkline values={values} />
        </div>
      )}
    </Flexbox>
  );
});

StatView.displayName = 'DashboardStatView';

export default StatView;
