'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useEffect, useState } from 'react';

import { type LayoutShiftEntry, sumLayoutShifts } from './metricUtils';

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

const ClsWidget = memo(() => {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    const Observer = globalThis.PerformanceObserver;
    if (!Observer?.supportedEntryTypes.includes('layout-shift')) return;

    setValue(0);
    const observer = new Observer((list) => {
      const shift = sumLayoutShifts(list.getEntries() as unknown as LayoutShiftEntry[]);
      if (shift > 0) setValue((current) => (current ?? 0) + shift);
    });
    observer.observe({ buffered: true, type: 'layout-shift' });

    return () => observer.disconnect();
  }, []);

  if (value === null) return null;

  return (
    <span
      className={cx(styles.text, value > 0.25 ? styles.high : value > 0.1 ? styles.mid : undefined)}
      title={'Cumulative Layout Shift (warning > 0.1, red > 0.25)'}
    >
      CLS {value.toFixed(3)}
    </span>
  );
});

ClsWidget.displayName = 'DevDockClsWidget';

export default ClsWidget;
