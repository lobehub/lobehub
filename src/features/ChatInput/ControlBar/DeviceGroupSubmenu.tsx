'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Building2Icon, LockKeyholeIcon, MonitorSmartphoneIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';

import { isDeviceOffline } from '@/features/DeviceManager/devicePicker';
import { OfflineDevicesToggle } from '@/features/DeviceManager/OfflineDevicesToggle';

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
    const [showOffline, setShowOffline] = useState(false);
    // Reachable machines first; offline ones fold away unless one is the pick.
    const folds = (d: DeviceListItem) => isDeviceOffline(d) && d.deviceId !== activeDeviceId;
    const visible = devices.filter((d) => !folds(d));
    const folded = devices.filter(folds);

    return (
      <GroupSubmenu
        active={!!activeDevice}
        hint={activeDevice ? activeDevice.friendlyName || activeDevice.hostname : undefined}
        icon={<Icon icon={GROUP_ICONS[kind]} size={14} />}
        label={label}
        testId={`device-group-${kind}`}
      >
        {visible.map((d) => renderDevice(d))}
        {folded.length > 0 && (
          <OfflineDevicesToggle
            count={folded.length}
            expanded={showOffline}
            onToggle={() => setShowOffline((v) => !v)}
          />
        )}
        {showOffline && folded.map((d) => renderDevice(d))}
      </GroupSubmenu>
    );
  },
);

DeviceGroupSubmenu.displayName = 'DeviceGroupSubmenu';

export default DeviceGroupSubmenu;
