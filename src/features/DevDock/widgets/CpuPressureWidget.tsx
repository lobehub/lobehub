'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useState } from 'react';

type PressureState = 'critical' | 'fair' | 'nominal' | 'serious';

interface PressureRecord {
  source: string;
  state: PressureState;
  time: number;
}

interface PressureObserverLike {
  disconnect: () => void;
  observe: (source: string, options?: { sampleInterval?: number }) => Promise<void>;
}

type PressureObserverConstructor = new (
  callback: (records: PressureRecord[]) => void,
) => PressureObserverLike;

const getPressureObserverCtor = (): PressureObserverConstructor | undefined =>
  (globalThis as { PressureObserver?: PressureObserverConstructor }).PressureObserver;

const styles = stylex.create({
  critical: { color: cssVar.colorError },
  serious: { color: cssVar.colorWarning },
  text: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
});

const CpuPressureWidget = memo(() => {
  const [state, setState] = useState<PressureState | null>(null);

  useEffect(() => {
    const PressureObserverCtor = getPressureObserverCtor();
    if (!PressureObserverCtor) return;

    let disposed = false;
    const observer = new PressureObserverCtor((records) => {
      const latest = records.at(-1);
      if (latest && !disposed) setState(latest.state);
    });
    void observer.observe('cpu', { sampleInterval: 2000 }).catch(() => {});

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, []);

  if (!state) return null;

  return (
    <span
      {...stylex.props(
        styles.text,
        state === 'critical' ? styles.critical : state === 'serious' ? styles.serious : undefined,
      )}
      title={'Compute Pressure (CPU)'}
    >
      CPU {state}
    </span>
  );
});

CpuPressureWidget.displayName = 'DevDockCpuPressureWidget';

export default CpuPressureWidget;
