'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useState } from 'react';

import { type LayoutShiftEntry, sumLayoutShifts } from './metricUtils';

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
      {...stylex.props(
        styles.text,
        value > 0.25 ? styles.high : value > 0.1 ? styles.mid : undefined,
      )}
      title={'Cumulative Layout Shift (warning > 0.1, red > 0.25)'}
    >
      CLS {value.toFixed(3)}
    </span>
  );
});

ClsWidget.displayName = 'DevDockClsWidget';

export default ClsWidget;
