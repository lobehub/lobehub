'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useAppProcessMetrics } from './appProcessMetrics';

const styles = stylex.create({
  high: { color: cssVar.colorError },
  mid: { color: cssVar.colorWarning },
  text: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    color: cssVar.colorTextTertiary,
  },
});

const CpuUsageWidget = memo(() => {
  const metrics = useAppProcessMetrics();

  if (!metrics) return null;

  const percent = metrics.cpuPercent;

  return (
    <span
      title={'App CPU usage (sum across processes, 100% = one core)'}
      {...stylex.props(
        styles.text,
        percent >= 200 ? styles.high : percent >= 100 ? styles.mid : undefined,
      )}
    >
      CPU {percent.toFixed(1)}%
    </span>
  );
});

CpuUsageWidget.displayName = 'DevDockCpuUsageWidget';

export default CpuUsageWidget;
