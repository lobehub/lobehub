import type { DeviceListItem } from '@lobechat/types';
import type { SelectOptions } from '@lobehub/ui';
import { Select } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import {
  ExecutionTargetLabel,
  executionTargetSelectClassNames,
  groupExecutionTargetDevices,
} from '@/features/ExecutionTargetPicker';
import { useDeviceList } from '@/store/device';

const AUTO = 'auto';
const STATUS_PREFIX = 'status:';

/**
 * The devices an MCP server of the current scope may be bound to, grouped as
 * the picker lists them. They follow who runs the server, the same split as
 * connector loading:
 *
 * - personal server: the user's personal devices;
 * - shared workspace server: the workspace's public devices (a private
 *   enrollment only resolves for the member who enrolled it, while every
 *   member's runs use the server);
 * - private workspace server (`privateConnector`): also the user's own private
 *   devices of the workspace, since only their private agents run it. A device
 *   list only ever carries the caller's own private rows, and only the creator
 *   sees a private connector, so these are the creator's.
 *
 * The server checks the same rule on save (`assertConnectorDeviceBindingAllowed`).
 */
export const bindableMcpDeviceGroups = (
  devices: DeviceListItem[] | undefined,
  workspaceScoped: boolean,
  privateConnector = false,
): { private: DeviceListItem[]; shared: DeviceListItem[] } => {
  const groups = groupExecutionTargetDevices(devices);
  if (!workspaceScoped) return { private: [], shared: groups.personal };
  return {
    private: privateConnector ? groups.privateWorkspace : [],
    shared: groups.publicWorkspace,
  };
};

interface BoundDeviceSelectProps {
  onChange?: (value: string | undefined) => void;
  /** The server is a private workspace connector: its creator's private devices are bindable too. */
  privateConnector?: boolean;
  /** The bound device id; `undefined` picks a device automatically. */
  value?: string;
}

/**
 * Pick the device an MCP server that runs on the user's device always runs on,
 * or leave it automatic. A bound device that is no longer listed (removed,
 * unshared) stays selected as unavailable, so the user sees why its calls fail
 * instead of the binding silently reading as automatic.
 */
const BoundDeviceSelect = memo<BoundDeviceSelectProps>(({ onChange, privateConnector, value }) => {
  const { t } = useTranslation(['plugin', 'chat']);
  const workspaceScoped = !!useActiveWorkspaceId();
  const { data, error, isConfirmed, isLoading, mutate } = useDeviceList();
  const groups = useMemo(
    () => bindableMcpDeviceGroups(data, workspaceScoped, privateConnector),
    [data, privateConnector, workspaceScoped],
  );
  const devices = useMemo(() => [...groups.private, ...groups.shared], [groups]);
  const deviceName = (device: DeviceListItem) =>
    device.friendlyName || device.hostname || device.deviceId;

  const renderAuto = useCallback(
    (compact = false) => (
      <ExecutionTargetLabel
        compact={compact}
        description={t('dev.mcp.boundDevice.autoDesc')}
        label={t('dev.mcp.boundDevice.auto')}
        offlineLabel={t('chat:heteroAgent.executionTarget.offline')}
        onlineLabel={t('chat:heteroAgent.executionTarget.online')}
        target={'auto'}
        unknownLabel={t('chat:heteroAgent.executionTarget.presenceChecking')}
      />
    ),
    [t],
  );

  const renderDevice = useCallback(
    (device: DeviceListItem, compact = false) => (
      <ExecutionTargetLabel
        compact={compact}
        description=""
        device={device}
        label={device.friendlyName || device.hostname || device.deviceId}
        offlineLabel={t('chat:heteroAgent.executionTarget.offline')}
        onlineLabel={t('chat:heteroAgent.executionTarget.online')}
        target={'device'}
        unknownLabel={t('chat:heteroAgent.executionTarget.presenceChecking')}
      />
    ),
    [t],
  );

  const isMissing = !!value && isConfirmed && !devices.some((d) => d.deviceId === value);

  const options = useMemo<SelectOptions<string>>(() => {
    const toOption = (device: DeviceListItem) => ({
      disabled: !isConfirmed,
      label: renderDevice(device),
      title: deviceName(device),
      value: device.deviceId,
    });
    // Until the server confirms the list, the stored copy may hold devices
    // since removed or unshared: show its rows, but only pick from the
    // confirmed list.
    const deviceOptions =
      isLoading || (!isConfirmed && devices.length === 0)
        ? [
            {
              disabled: true,
              label: t('chat:heteroAgent.executionTarget.loading'),
              value: `${STATUS_PREFIX}loading`,
            },
          ]
        : groups.shared.length > 0
          ? groups.shared.map(toOption)
          : [
              {
                disabled: true,
                label: workspaceScoped
                  ? t('dev.mcp.boundDevice.emptyWorkspace')
                  : t('dev.mcp.boundDevice.empty'),
                value: `${STATUS_PREFIX}empty`,
              },
            ];

    return [
      { label: renderAuto(), title: t('dev.mcp.boundDevice.auto'), value: AUTO },
      ...(isMissing
        ? [
            {
              disabled: true,
              label: t('dev.mcp.boundDevice.unavailable'),
              title: t('dev.mcp.boundDevice.unavailable'),
              value: value!,
            },
          ]
        : []),
      // Only the caller's own private devices reach this list, so the group
      // is simply absent for anyone without one
      ...(error || isLoading || groups.private.length === 0
        ? []
        : [
            {
              label: t('chat:heteroAgent.executionTarget.personalGroup'),
              options: groups.private.map(toOption),
            },
          ]),
      ...(error
        ? []
        : [
            {
              label: workspaceScoped
                ? t('chat:heteroAgent.executionTarget.workspaceGroup')
                : t('chat:heteroAgent.executionTarget.personalGroup'),
              options: deviceOptions,
            },
          ]),
    ];
  }, [
    devices,
    error,
    groups,
    isConfirmed,
    isLoading,
    isMissing,
    renderAuto,
    renderDevice,
    t,
    value,
    workspaceScoped,
  ]);

  return (
    <>
      <Select
        classNames={executionTargetSelectClassNames}
        optionRender={(option) => option.label}
        options={options}
        popupMatchSelectWidth={true}
        style={{ width: '100%' }}
        value={value ?? AUTO}
        labelRender={(option) => {
          if (option.value === AUTO) return renderAuto(true);
          const device = devices.find((item) => item.deviceId === option.value);
          return device ? renderDevice(device, true) : option.label;
        }}
        onChange={(next) => {
          if (typeof next !== 'string' || next.startsWith(STATUS_PREFIX)) return;
          onChange?.(next === AUTO ? undefined : next);
        }}
      />
      {error ? <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} /> : null}
    </>
  );
});

BoundDeviceSelect.displayName = 'BoundDeviceSelect';

export default BoundDeviceSelect;
