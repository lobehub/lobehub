'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useEffect, useState } from 'react';

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
  limit: number;
  used: number;
}

const readHeap = (): HeapSample | null => {
  const memory = (
    performance as Performance & {
      memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
    }
  ).memory;
  if (!memory) return null;
  return { limit: memory.jsHeapSizeLimit, used: memory.usedJSHeapSize };
};

const MemoryWidget = memo(() => {
  const [heap, setHeap] = useState<HeapSample | null>(() => readHeap());

  useEffect(() => {
    if (!readHeap()) return;
    const timer = setInterval(() => setHeap(readHeap()), 2000);
    return () => clearInterval(timer);
  }, []);

  if (!heap) return null;

  const usedMB = Math.round(heap.used / 1_048_576);
  const percent = (heap.used / heap.limit) * 100;

  return (
    <span
      title={'JS heap used / limit'}
      className={cx(
        styles.text,
        percent >= 90 ? styles.high : percent >= 70 ? styles.mid : undefined,
      )}
    >
      {usedMB} MB · {percent.toFixed(1)}%
    </span>
  );
});

MemoryWidget.displayName = 'DevDockMemoryWidget';

export default MemoryWidget;
