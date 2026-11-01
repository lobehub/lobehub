'use client';

import type { DeviceVisibility } from '@lobechat/types';
import { Icon, Tabs } from '@lobehub/ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { DeviceConnectModal, DeviceDetailPage, DeviceManager } from '@/features/DeviceManager';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * Workspace device settings: two pools behind tabs —
 * - Workspace: the shared (public-visibility) pool every member sees.
 * - Private: the caller's own private enrollments in this workspace.
 * The tab also parameterises the connect wizard, so a device enrolled from the
 * Private tab registers as private (`lh connect … --private`).
 * The tab lives in `?visibility=` so leaving a device's detail page
 * (`devices/:sub`) lands back on the tab that device belongs to.
 */
const WorkspaceDevicesSetting = memo(() => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const { sub: deviceId } = useParams<{ sub?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const visibility: DeviceVisibility =
    searchParams.get('visibility') === 'private' ? 'private' : 'public';
  const navigate = useWorkspaceAwareNavigate();

  const setVisibility = (next: DeviceVisibility) =>
    setSearchParams(next === 'private' ? { visibility: next } : {}, { replace: true });

  if (deviceId)
    return (
      <DeviceDetailPage
        deviceId={deviceId}
        scope={'workspace'}
        onBack={(device) =>
          navigate(
            (device?.visibility ?? visibility) === 'private'
              ? '/settings/devices?visibility=private'
              : '/settings/devices',
          )
        }
      />
    );

  return (
    <>
      {/* DeviceManager owns the refresh + connect toolbar; the tabs fill its
          leading slot (same header pattern as the workspace credential page). */}
      <DeviceManager
        scope={'workspace'}
        visibility={visibility}
        toolbarLeading={
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
        }
        onConnect={() => setOpen(true)}
        onOpenDevice={(id) =>
          navigate(
            `/settings/devices/${encodeURIComponent(id)}${
              visibility === 'private' ? '?visibility=private' : ''
            }`,
          )
        }
      />

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
