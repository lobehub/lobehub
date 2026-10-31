'use client';

import type { GpuStatus } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo, useEffect, useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import { electronDevtoolsService } from '@/services/electron/devtools';

const styles = stylex.create({
  device: {
    display: 'grid',
    gridTemplateColumns: '96px 1fr',
    flexShrink: 0,
    rowGap: '4px',
    columnGap: '8px',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
  },
  empty: {
    padding: '24px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  error: { color: cssVar.colorError },
  key: { color: cssVar.colorTextQuaternary },
  legend: {
    flexShrink: 0,
    paddingBlockStart: '8px',
    paddingBlockEnd: '12px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '10px',
    lineHeight: 1.6,
    color: cssVar.colorTextQuaternary,
  },
  muted: { color: cssVar.colorTextTertiary },
  ok: { color: cssVar.colorSuccess },
  rows: { overflow: 'auto', flex: '1', minHeight: '0' },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 200px',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '5px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
  },
  value: { overflowWrap: 'anywhere' },
  warn: { color: cssVar.colorWarning },
});

const statusStyle = (status: string) => {
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
      <div {...stylex.props(devDockPanelStyles.root)}>
        <div {...stylex.props(styles.empty)}>GPU status unavailable over ipc.</div>
      </div>
    );
  if (!status) return null;

  const features = Object.entries(status.featureStatus).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Flexbox className={stylex.props(devDockPanelStyles.root).className}>
      <div {...stylex.props(styles.device)}>
        {DEVICE_LABELS.map(([label, key]) => (
          <Fragment key={key}>
            <span {...stylex.props(styles.key)}>{label}</span>
            <span {...stylex.props(styles.value, !status[key] && styles.muted)}>
              {status[key] ?? '—'}
            </span>
          </Fragment>
        ))}
      </div>
      <div {...stylex.props(styles.rows)}>
        {features.map(([feature, value]) => (
          <div {...stylex.props(styles.row)} key={feature}>
            <span {...stylex.props(styles.muted)}>{feature}</span>
            <span {...stylex.props(statusStyle(value))}>{value}</span>
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.legend)}>
        `enabled_*` runs on the GPU, `*_software` fell back to the CPU renderer, `*_off_ok` is
        switched off by design, and anything else is a hard disable worth investigating on
        chrome://gpu. Read once when the panel opens — reopen it to re-sample.
      </div>
    </Flexbox>
  );
});

GpuStatusPanel.displayName = 'DevGpuStatusPanel';

export default GpuStatusPanel;
