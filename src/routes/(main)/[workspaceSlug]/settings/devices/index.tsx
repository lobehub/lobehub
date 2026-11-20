'use client';

import { memo, useState } from 'react';
import { useParams } from 'react-router';

import { DeviceConnectModal, DeviceDetailPage, DeviceManager } from '@/features/DeviceManager';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * Workspace device settings: one list of the shared pool every member sees
 * and the caller's own private enrollments, the private ones marked with a
 * lock. A device enrolled from here registers as private
 * (`lh connect … --workspace <id>` without `--public`); its card menu
 * publishes it to the workspace.
 */
const WorkspaceDevicesSetting = memo(() => {
  const [open, setOpen] = useState(false);
  const { sub: deviceId } = useParams<{ sub?: string }>();
  const navigate = useWorkspaceAwareNavigate();

  if (deviceId)
    return (
      <DeviceDetailPage
        deviceId={deviceId}
        scope={'workspace'}
        onBack={() => navigate('/settings/devices')}
      />
    );

  return (
    <>
      <DeviceManager
        scope={'workspace'}
        onConnect={() => setOpen(true)}
        onOpenDevice={(id) => navigate(`/settings/devices/${encodeURIComponent(id)}`)}
      />

      <DeviceConnectModal
        open={open}
        scope={'workspace'}
        visibility={'private'}
        onClose={() => setOpen(false)}
      />
    </>
  );
});

WorkspaceDevicesSetting.displayName = 'WorkspaceDevicesSetting';

export default WorkspaceDevicesSetting;
