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

const GpuProcessWidget = memo(() => {
  const gpu = useAppProcessMetrics()?.gpu;

  if (!gpu) return null;

  return (
    <span
      {...stylex.props(
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
