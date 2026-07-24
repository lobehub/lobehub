'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  critical: css`
    color: ${cssVar.colorError};
  `,
  serious: css`
    color: ${cssVar.colorWarning};
  `,
  text: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const STATE_CLASS: Partial<Record<PressureState, string>> = {
  critical: styles.critical,
  serious: styles.serious,
};

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
    <span className={cx(styles.text, STATE_CLASS[state])} title={'Compute Pressure (CPU)'}>
      CPU {state}
    </span>
  );
});

CpuPressureWidget.displayName = 'DevDockCpuPressureWidget';

export default CpuPressureWidget;
