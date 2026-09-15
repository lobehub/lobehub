'use client';

import type { GpuStatus } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Fragment, memo, useEffect, useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import { electronDevtoolsService } from '@/services/electron/devtools';

const styles = createStaticStyles(({ css }) => ({
  device: css`
    display: grid;
    grid-template-columns: 96px 1fr;
    flex-shrink: 0;
    gap: 4px 8px;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
  empty: css`
    padding: 24px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  error: css`
    color: ${cssVar.colorError};
  `,
  key: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  legend: css`
    flex-shrink: 0;

    padding-block: 8px 12px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 10px;
    line-height: 1.6;
    color: ${cssVar.colorTextQuaternary};
  `,
  muted: css`
    color: ${cssVar.colorTextTertiary};
  `,
  ok: css`
    color: ${cssVar.colorSuccess};
  `,
  rows: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  row: css`
    display: grid;
    grid-template-columns: 1fr 200px;
    gap: 8px;
    align-items: center;

    padding-block: 5px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
  `,
  value: css`
    overflow-wrap: anywhere;
  `,
  warn: css`
    color: ${cssVar.colorWarning};
  `,
}));

const statusClass = (status: string): string => {
  if (status.startsWith('enabled')) return styles.ok;
  if (status.includes('software')) return styles.warn;
  if (status.endsWith('_ok')) return styles.muted;
  return styles.error;
};

const DEVICE_LABELS: [label: string, key: keyof Omit<GpuStatus, 'featureStatus'>][] = [
  ['renderer', 'renderer'],
  ['vendor', 'vendor'],
  ['gl version', 'version'],
  ['display', 'displayType'],
  ['skia', 'skiaBackend'],
  ['machine', 'machineModel'],
];

const GpuStatusPanel = memo(() => {
  const [status, setStatus] = useState<GpuStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    electronDevtoolsService
      .getGpuStatus()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  if (failed)
    return (
      <div className={devDockPanelStyles.root}>
        <div className={styles.empty}>GPU status unavailable over ipc.</div>
      </div>
    );
  if (!status) return null;

  const features = Object.entries(status.featureStatus).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Flexbox className={devDockPanelStyles.root}>
      <div className={styles.device}>
        {DEVICE_LABELS.map(([label, key]) => (
          <Fragment key={key}>
            <span className={styles.key}>{label}</span>
            <span className={cx(styles.value, !status[key] && styles.muted)}>
              {status[key] ?? '—'}
            </span>
          </Fragment>
        ))}
      </div>
      <div className={styles.rows}>
        {features.map(([feature, value]) => (
          <div className={styles.row} key={feature}>
            <span className={styles.muted}>{feature}</span>
            <span className={statusClass(value)}>{value}</span>
          </div>
        ))}
      </div>
      <div className={styles.legend}>
        `enabled_*` runs on the GPU, `*_software` fell back to the CPU renderer, `*_off_ok` is
        switched off by design, and anything else is a hard disable worth investigating on
        chrome://gpu. Read once when the panel opens — reopen it to re-sample.
      </div>
    </Flexbox>
  );
});

GpuStatusPanel.displayName = 'DevGpuStatusPanel';

export default GpuStatusPanel;
