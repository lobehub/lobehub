'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDevicePresenceUnknown, useDeviceList } from '@/store/device';

import { useAgentDeviceBinding } from './useAgentDeviceBinding';

const styles = stylex.create({
  dot: {
    borderColor: cssVar.colorBgLayout,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 1.5,
    height: 8,
    insetBlockEnd: -2,
    insetInlineEnd: -2,
    position: 'absolute',
    width: 8,
  },
  offline: { backgroundColor: cssVar.colorTextQuaternary },
  online: { backgroundColor: cssVar.colorSuccess },
});

interface DevicePresenceDotProps {
  agentId: string;
}

/**
 * Presence of the machine an agent runs on. An agent routed to a device
 * follows that device. Anything else — no binding, cloud / sandbox targets, or
 * a binding absent from the caller-scoped device list (a shared/legacy binding
 * can point at the author's personal device, so absence is not proof of
 * offline, same rule as `useRemoteAgentDeviceGuard`) — defaults to online.
 */
export const resolveAgentPresence = (
  boundDeviceId: string | null | undefined,
  devices: DeviceListItem[],
): { device?: DeviceListItem; online: boolean } => {
  const device = boundDeviceId ? devices.find((d) => d.deviceId === boundDeviceId) : undefined;
  return { device, online: device ? !!device.online : true };
};

/**
 * Presence dot anchored to the bottom-right of the (relatively positioned)
 * avatar it sits in: green when the agent's machine is online, gray when it is
 * offline. Independent of the topic list — it only reads where the agent
 * routes for the caller and the device list.
 */
const DevicePresenceDot = memo<DevicePresenceDotProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  // Where this agent routes for the caller, resolved server-side and fetched
  // for every group in one batched read (see `useAgentDeviceBinding`).
  const { data: boundDeviceId } = useAgentDeviceBinding(agentId);
  const { data: devices, isConfirmed } = useDeviceList();

  // Wait for every source: painting the "online" default first would flash
  // green on an agent whose device is offline, and a reload paints the
  // persisted device list first, whose `online: false` is a placeholder.
  if (boundDeviceId === undefined || !devices || !isConfirmed) return null;

  const { device, online } = resolveAgentPresence(boundDeviceId, devices);
  if (device && isDevicePresenceUnknown(device)) return null;
  const deviceName = device?.friendlyName || device?.hostname;
  const status = t(online ? 'devices.status.online' : 'devices.status.offline');

  return (
    <Tooltip title={deviceName ? `${deviceName} · ${status}` : status}>
      <span
        data-online={online ? 'true' : 'false'}
        data-testid="agent-device-presence"
        {...stylex.props(styles.dot, online ? styles.online : styles.offline)}
      />
    </Tooltip>
  );
});

DevicePresenceDot.displayName = 'AgentDevicePresenceDot';

export default DevicePresenceDot;
