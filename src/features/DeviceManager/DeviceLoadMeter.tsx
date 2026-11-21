'use client';

import type { DeviceListItem } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { formatPercent } from './DeviceHealth/format';
import { USAGE_COLOR, useDeviceMetricSeries } from './DeviceHealth/shared';
import { currentUsage } from './DeviceHealth/viewState';
import { LOAD_HINT_SEGMENTS, type LoadHint, loadHint, type LoadHintMetric } from './deviceLoadHint';

const styles = stylex.create({
  lit: (color: string) => ({ backgroundColor: color }),
  // Bottom segment first in the DOM, stacked upwards.
  root: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column-reverse',
    gap: 1,
  },
  segment: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 1,
    height: 2,
    width: 8,
  },
});

const LABEL_KEY = {
  cpu: 'devices.health.cpu',
  load: 'devices.health.loadShort',
  memory: 'devices.health.memory',
} as const satisfies Record<LoadHintMetric, string>;

export interface DeviceLoad {
  hint: LoadHint;
  /** Every reading on one line, e.g. "CPU 4% · Memory 29% · Load 12%". */
  summary: string;
}

/**
 * The current load of the device a chip names, or `null` while the device is
 * offline or its newest reading is stale — an old load must not read as
 * current. The readings are returned as text so the chip can carry them on
 * its own tooltip, rather than nesting a second tooltip inside the chip.
 */
export const useDeviceLoad = (device: DeviceListItem | undefined): DeviceLoad | null => {
  const { t } = useTranslation('setting');
  const online = !!device?.online;
  const { data } = useDeviceMetricSeries(device?.deviceId ?? '', device?.scope, online);
  const hint = loadHint(online ? currentUsage(data) : null);
  if (!hint) return null;

  const summary = hint.readings
    .map(({ metric, value }) => `${t(LABEL_KEY[metric])} ${formatPercent(value)}`)
    .join(' · ');
  return { hint, summary };
};

/**
 * A five-segment level meter for inside a device chip, between the name and
 * the chevron, so a busy machine shows before a run is sent there. It rises
 * with the busiest of CPU, memory and load, colored by the device page's
 * thresholds.
 */
const DeviceLoadMeter = ({ load }: { load: DeviceLoad }) => {
  const color = USAGE_COLOR[load.hint.level];

  return (
    <div aria-label={load.summary} role={'img'} {...stylex.props(styles.root)}>
      {Array.from({ length: LOAD_HINT_SEGMENTS }, (_, i) => (
        <span key={i} {...stylex.props(styles.segment, i < load.hint.lit && styles.lit(color))} />
      ))}
    </div>
  );
};

export default DeviceLoadMeter;
