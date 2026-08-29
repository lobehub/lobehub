'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useEffect, useState } from 'react';

import { formatSize } from '@/utils/format';

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

  useEffect(() => {
    if (!readHeap()) return;
    const getRendererMemoryInfo = window.electronAPI?.getRendererMemoryInfo;

    let disposed = false;
    const update = async () => {
      let privateBytes: number | undefined;

      try {
        privateBytes = (await getRendererMemoryInfo?.())?.privateBytes;
      } catch {
        /* native process metrics unavailable — JS heap remains useful */
      }

      const heap = readHeap();
      if (heap && !disposed) setMemory({ ...heap, privateBytes });
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

  return (
    <span
      className={cx(
        styles.text,
        percent >= 90 ? styles.high : percent >= 70 ? styles.mid : undefined,
      )}
      title={
        memory.privateBytes === undefined
          ? 'JS heap used / limit'
          : 'Renderer private memory · JS heap used / limit'
      }
    >
      {memory.privateBytes !== undefined && `Renderer ${formatSize(memory.privateBytes)} · `}
      JS {formatSize(memory.jsHeapUsedBytes)} · {percent.toFixed(1)}%
    </span>
  );
});

MemoryWidget.displayName = 'DevDockMemoryWidget';

export default MemoryWidget;
