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

const GpuProcessWidget = memo(() => {
  const gpu = useAppProcessMetrics()?.gpu;

  if (!gpu) return null;

  return (
    <span
      className={cx(
        styles.text,
        gpu.cpuPercent >= 100 ? styles.high : gpu.cpuPercent >= 50 ? styles.mid : undefined,
      )}
      title={
        'GPU process CPU usage and resident memory — Chromium exposes no GPU utilisation figure'
      }
    >
      GPU {gpu.cpuPercent.toFixed(1)}% · {Math.round(gpu.memoryMB)}M
    </span>
  );
});

GpuProcessWidget.displayName = 'DevDockGpuProcessWidget';

export default GpuProcessWidget;
