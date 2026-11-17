'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Flexbox, Icon, Popover } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Building2Icon, LockKeyholeIcon, MonitorSmartphoneIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { summarizeDeviceGroup } from './deviceGroupSummary';
import OptionRow from './OptionRow';
import SubmenuHeader from './SubmenuHeader';

const styles = stylex.create({
  list: {
    overflowY: 'auto',
    maxHeight: '360px',
  },
});

/**
 * The list can grow after the submenu opens (a reconnect, a fresh device list),
 * so the positioner is left to size itself again rather than keep its first
 * measurement — same as the work-location submenus.
 */
const SUBMENU_STYLES = {
  content: { padding: 4 },
  root: { height: 'auto', width: 'auto' },
};

/** Which pool the group is: a workspace's private or shared devices, or the caller's own. */
export type DeviceGroupKind = 'devices' | 'private' | 'workspace';

const GROUP_ICONS = {
  devices: MonitorSmartphoneIcon,
  private: LockKeyholeIcon,
  workspace: Building2Icon,
} as const;

interface DeviceGroupSubmenuProps {
  /** The device the agent is set to run on, when it is one of this group's. */
  activeDeviceId?: string;
  devices: DeviceListItem[];
  kind: DeviceGroupKind;
  label: string;
  renderDevice: (device: DeviceListItem) => ReactNode;
}

/**
 * One device group in the execution environment menu, as a second level: the
 * first level keeps a single row per group — how many machines are online, and
 * the current pick by name — and the machines themselves open beside it. A
 * growing fleet then lengthens the submenu, not the menu the built-in
 * environments live in.
 */
const DeviceGroupSubmenu = memo<DeviceGroupSubmenuProps>(
  ({ activeDeviceId, devices, kind, label, renderDevice }) => {
    const { t } = useTranslation('chat');
    const { activeDevice, online, presenceUnknown, total } = summarizeDeviceGroup(
      devices,
      activeDeviceId,
    );

    return (
      <Popover
        arrow={false}
        closeDelay={150}
        placement={'rightBottom'}
        styles={SUBMENU_STYLES}
        trigger={['hover', 'click']}
        content={
          <Flexbox gap={2} style={{ maxWidth: 320, minWidth: 280 }}>
            <SubmenuHeader title={label} />
            <div {...stylex.props(styles.list)}>{devices.map((d) => renderDevice(d))}</div>
          </Flexbox>
        }
      >
        <div data-testid={`device-group-${kind}`}>
          <OptionRow
            arrow
            active={!!activeDevice}
            hint={activeDevice ? activeDevice.friendlyName || activeDevice.hostname : undefined}
            icon={<Icon icon={GROUP_ICONS[kind]} size={14} />}
            label={label}
            desc={
              // Until presence is confirmed the count would read "0 online";
              // say it is still checking, as the device rows themselves do.
              presenceUnknown
                ? t('heteroAgent.executionTarget.presenceChecking')
                : t('heteroAgent.executionTarget.deviceGroupSummary', { online, total })
            }
            onClick={() => {}}
          />
        </div>
      </Popover>
    );
  },
);

DeviceGroupSubmenu.displayName = 'DeviceGroupSubmenu';

export default DeviceGroupSubmenu;
