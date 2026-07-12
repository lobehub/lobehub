'use client';

import type { DeviceVisibility } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeviceConnectModal, DeviceManager } from '@/features/DeviceManager';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

/**
 * Workspace device settings: two pools behind tabs (LOBE-11690) —
 * - Workspace: the shared (public-visibility) pool every member sees.
 * - Private: the caller's own private enrollments in this workspace.
 * The tab also parameterises the connect wizard, so a device enrolled from the
 * Private tab registers as private (`lh connect … --private`).
 */
const WorkspaceDevicesSetting = memo(() => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<DeviceVisibility>('public');

  return (
    <>
      <SettingHeader title={t('tab.devices')} />

      {/* Tabs and the device list form one unit: group them so the settings
          Container's 36px section gap applies once, instead of stacking
          between the tabs and the list they control. */}
      <Flexbox gap={16}>
        <Tabs
          activeKey={visibility}
          items={[
            {
              icon: <Icon icon={UsersIcon} />,
              key: 'public',
              label: t('devices.visibilityTabs.workspace'),
            },
            {
              icon: <Icon icon={LockIcon} />,
              key: 'private',
              label: t('devices.visibilityTabs.private'),
            },
          ]}
          onChange={(key) => setVisibility(key as DeviceVisibility)}
        />

        <DeviceManager
          key={visibility}
          scope={'workspace'}
          visibility={visibility}
          onConnect={() => setOpen(true)}
        />
      </Flexbox>

      <DeviceConnectModal
        open={open}
        scope={'workspace'}
        visibility={visibility}
        onClose={() => setOpen(false)}
      />
    </>
  );
});

WorkspaceDevicesSetting.displayName = 'WorkspaceDevicesSetting';

export default WorkspaceDevicesSetting;
