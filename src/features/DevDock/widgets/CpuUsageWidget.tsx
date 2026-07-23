'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useEffect, useState } from 'react';

import { electronDevtoolsService } from '@/services/electron/devtools';

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

const CpuUsageWidget = memo(() => {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    // Electron reports usage since the previous getAppMetrics call, so the
    // first sample is meaningless — prime once and only render from the second.
    let primed = false;

    const tick = async () => {
      try {
        const usage = await electronDevtoolsService.getAppCpuUsage();
        if (disposed) return;
        if (!primed) {
          primed = true;
          return;
        }
        setPercent(usage.percent);
      } catch {
        /* ipc unavailable — keep the widget hidden */
      }
    };

    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  if (percent === null) return null;

  return (
    <span
      title={'App CPU usage (sum across processes, 100% = one core)'}
      className={cx(
        styles.text,
        percent >= 200 ? styles.high : percent >= 100 ? styles.mid : undefined,
      )}
    >
      CPU {percent.toFixed(1)}%
    </span>
  );
});

CpuUsageWidget.displayName = 'DevDockCpuUsageWidget';

export default CpuUsageWidget;
