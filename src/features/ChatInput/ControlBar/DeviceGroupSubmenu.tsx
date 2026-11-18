'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Building2Icon, LockKeyholeIcon, MonitorSmartphoneIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { summarizeDeviceGroup } from './deviceGroupSummary';
import GroupSubmenu from './GroupSubmenu';

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
 * One device group in the execution environment menu: the first level keeps a
 * single row per group — its title, and the current pick by name — and the machines themselves open beside it. A growing fleet then
 * lengthens the submenu, not the menu the other environments live in.
 */
const DeviceGroupSubmenu = memo<DeviceGroupSubmenuProps>(
  ({ activeDeviceId, devices, kind, label, renderDevice }) => {
    const { activeDevice } = summarizeDeviceGroup(devices, activeDeviceId);

    return (
      <GroupSubmenu
        active={!!activeDevice}
        hint={activeDevice ? activeDevice.friendlyName || activeDevice.hostname : undefined}
        icon={<Icon icon={GROUP_ICONS[kind]} size={14} />}
        label={label}
        testId={`device-group-${kind}`}
      >
        {devices.map((d) => renderDevice(d))}
      </GroupSubmenu>
    );
  },
);

DeviceGroupSubmenu.displayName = 'DeviceGroupSubmenu';

export default DeviceGroupSubmenu;
