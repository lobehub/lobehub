'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import { useAppProcessMetrics } from './appProcessMetrics';

const styles = createStaticStyles(({ css }) => ({
  high: css`
    color: ${cssVar.colorError};
  `,
  mid: css`
    color: ${cssVar.colorWarning};
  `,
  text: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextTertiary};
  `,
}));

const CpuUsageWidget = memo(() => {
  const metrics = useAppProcessMetrics();

  if (!metrics) return null;

  const percent = metrics.cpuPercent;

  return (
    <span
      title={'App CPU usage (sum across processes, 100% = one core)'}
      className={cx(
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
