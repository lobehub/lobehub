'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useEffect, useState } from 'react';

import { formatSize } from '@/utils/format';

import { useAppProcessMetrics } from './appProcessMetrics';
import { isMemoryHigh } from './metricUtils';

const formatCompactSize = (bytes: number) => formatSize(bytes).replace(' ', '').replace('B', '');

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

interface HeapSample {
  jsHeapLimitBytes: number;
  jsHeapUsedBytes: number;
  privateBytes?: number;
  sharedBytes?: number;
}

const readHeap = (): HeapSample | null => {
  const memory = (
    performance as Performance & {
      memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
    }
  ).memory;
  if (!memory) return null;
  return {
    jsHeapLimitBytes: memory.jsHeapSizeLimit,
    jsHeapUsedBytes: memory.usedJSHeapSize,
  };
};

const MemoryWidget = memo(() => {
  const [memory, setMemory] = useState<HeapSample | null>(null);
  const residentMB = useAppProcessMetrics()?.rendererResidentMB ?? null;

  useEffect(() => {
    if (!readHeap()) return;
    const getRendererMemoryInfo = window.electronAPI?.getRendererMemoryInfo;

    let disposed = false;
    const update = async () => {
      let privateBytes: number | undefined;
      let sharedBytes: number | undefined;

      try {
        const info = await getRendererMemoryInfo?.();
        privateBytes = info?.privateBytes;
        sharedBytes = info?.sharedBytes;
      } catch {
        /* native process metrics unavailable — JS heap remains useful */
      }

      const heap = readHeap();
      if (heap && !disposed) setMemory({ ...heap, privateBytes, sharedBytes });
    };

    void update();
    const timer = setInterval(update, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  if (!memory) return null;

  const percent = (memory.jsHeapUsedBytes / memory.jsHeapLimitBytes) * 100;
  const high = isMemoryHigh(percent, memory.privateBytes);
  // macOS keeps madvise(MADV_FREE_REUSABLE) pages in the resident set until it needs
  // them, so resident minus private footprint is what the allocator already gave back.
  const reclaimableBytes =
    residentMB !== null && memory.privateBytes !== undefined
      ? Math.max(0, residentMB * 1024 * 1024 - memory.privateBytes - (memory.sharedBytes ?? 0))
      : undefined;

  return (
    <span
      className={cx(styles.text, high ? styles.high : percent >= 70 ? styles.mid : undefined)}
      title={
        memory.privateBytes === undefined
          ? 'JS heap used / limit'
          : 'R = Renderer private footprint (red at 1 GiB) · F = freed pages the OS has not reclaimed yet (plus some read-only library pages) · J = JS heap used / limit'
      }
    >
      {memory.privateBytes !== undefined && `R${formatCompactSize(memory.privateBytes)} · `}
      {reclaimableBytes !== undefined && `F${formatCompactSize(reclaimableBytes)} · `}J
      {formatCompactSize(memory.jsHeapUsedBytes)} · {percent.toFixed(1)}%
    </span>
  );
});

MemoryWidget.displayName = 'DevDockMemoryWidget';

export default MemoryWidget;
