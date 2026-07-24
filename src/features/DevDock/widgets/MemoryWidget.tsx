'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useEffect, useState } from 'react';

const styles = createStaticStyles(({ css }) => ({
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
  const percent = ((heap.used / heap.limit) * 100).toFixed(1);

  return (
    <span className={styles.text} title={'JS heap used / limit'}>
      {usedMB} MB · {percent}%
    </span>
  );
});

MemoryWidget.displayName = 'DevDockMemoryWidget';

export default MemoryWidget;
