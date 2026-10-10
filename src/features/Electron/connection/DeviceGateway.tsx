import { type GatewayConnectionErrorCode, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Popover, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { HardDrive, SettingsIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  getScopedConnectionCount,
  getWorkspaceConnectionState,
} from '@/features/DeviceManager/connectionCount';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

/** Why the last attempt ended, phrased with the next step. */
const ERROR_MESSAGE_KEYS = {
  auth_failed: 'gateway.error.authFailed',
  config_unavailable: 'gateway.error.configUnavailable',
  invalid_gateway_url: 'gateway.error.invalidUrl',
  not_signed_in: 'gateway.error.notSignedIn',
} as const satisfies Record<GatewayConnectionErrorCode, string>;

const styles = createStaticStyles(({ css, cssVar }) => ({
  errorDot: css`
    position: absolute;
    inset-block-end: 0;
    inset-inline-end: 0;

    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    background: ${cssVar.colorError};
  `,
  errorHint: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorError};
  `,
  greenDot: css`
    position: absolute;
    inset-block-end: 0;
    inset-inline-end: 0;

    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    background: #52c41a;
  `,
  popoverContent: css`
    width: 250px;
  `,
  scopeHint: css`
    font-size: 11px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
    white-space: nowrap;
  `,
  statusTitle: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface DeviceGatewayProps {
  workspaceScoped: boolean;
}

const DeviceGateway = memo<DeviceGatewayProps>(({ workspaceScoped }) => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const [
    gatewayStatus,
    gatewayError,
    connectGateway,
    disconnectGateway,
    setGatewayConnectionState,
    useFetchGatewayStatus,
  ] = useElectronStore((s) => [
    s.gatewayConnectionStatus,
    s.gatewayConnectionError,
    s.connectGateway,
    s.disconnectGateway,
    s.setGatewayConnectionState,
    s.useFetchGatewayStatus,
  ]);

  useFetchGatewayStatus();
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const { data: devices, error: deviceListError, isLoading: isDeviceListLoading } = useDeviceList();

  useWatchBroadcast('gatewayConnectionStatusChanged', setGatewayConnectionState);

  const isConnected = gatewayStatus === 'connected';
  const isConnecting =
    gatewayStatus === 'authenticating' ||
    gatewayStatus === 'connecting' ||
    gatewayStatus === 'reconnecting';

  // Only the personal connection is toggled from here; workspace rows have their own status.
  const failure = !workspaceScoped && !isConnected && !isConnecting ? gatewayError : undefined;

  const [open, setOpen] = useState(false);

  const openDeviceSettings = () => {
    setOpen(false);
    navigate('/settings/devices');
  };

  const handleSwitchChange = useCallback(
    async (checked: boolean) => {
      if (checked) {
        await connectGateway();
      } else {
        await disconnectGateway();
      }
    },
    [connectGateway, disconnectGateway],
  );

  const connectionCount = getScopedConnectionCount(
    devices,
    workspaceScoped ? 'workspace' : 'personal',
    workspaceScoped ? undefined : gatewayDeviceInfo?.deviceId,
  );
  const workspaceConnectionState = getWorkspaceConnectionState(
    devices,
    isDeviceListLoading,
    deviceListError,
  );
  const scopeConnected = workspaceScoped ? workspaceConnectionState === 'connected' : isConnected;
  const connectionHint = workspaceScoped
    ? workspaceConnectionState === 'unavailable'
      ? t('gateway.workspaceStatusUnavailable')
      : workspaceConnectionState === 'connecting'
        ? t('gateway.statusConnecting')
        : workspaceConnectionState === 'connected'
          ? t('gateway.workspaceStatusConnections', { count: connectionCount })
          : t('gateway.workspaceStatusDisconnected')
    : isConnecting
      ? t('gateway.statusConnecting')
      : isConnected && connectionCount
        ? t('gateway.statusConnectedConnections', { count: connectionCount })
        : t(isConnected ? 'gateway.statusConnected' : 'gateway.statusDisconnected');

  const popoverContent = (
    <Flexbox className={styles.popoverContent} gap={4}>
      <Flexbox horizontal align="center" justify="space-between">
        <span className={styles.statusTitle}>{t('gateway.title')}</span>
        <Flexbox horizontal align="center" gap={6}>
          <ActionIcon
            aria-label={t('gateway.manageDevices')}
            icon={SettingsIcon}
            size="small"
            title={t('gateway.manageDevices')}
            onClick={openDeviceSettings}
          />
          {!workspaceScoped && (
            <Switch
              aria-label={t('gateway.enableConnection')}
              checked={isConnected || isConnecting}
              loading={isConnecting}
              size="small"
              onChange={handleSwitchChange}
            />
          )}
        </Flexbox>
      </Flexbox>
      <span className={styles.scopeHint}>{connectionHint}</span>
      {failure && (
        <Flexbox align="flex-start" gap={4}>
          <span className={styles.errorHint} title={failure.detail}>
            {t(ERROR_MESSAGE_KEYS[failure.code])}
          </span>
          <Flexbox horizontal gap={4}>
            {failure.code !== 'not_signed_in' && failure.code !== 'invalid_gateway_url' && (
              <Button outdent size="small" type="text" onClick={() => void connectGateway()}>
                {t('gateway.retry')}
              </Button>
            )}
            {/* A saved address beats the server's, so a wrong one is fixed there. */}
            {(failure.code === 'invalid_gateway_url' || failure.code === 'auth_failed') && (
              <Button outdent size="small" type="text" onClick={openDeviceSettings}>
                {t('gateway.error.configure')}
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={popoverContent}
      open={open}
      placement="bottomRight"
      styles={{ content: { padding: 8 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div style={{ position: 'relative' }}>
        <ActionIcon
          icon={HardDrive}
          loading={isConnecting}
          size="small"
          title={t('gateway.title')}
          tooltipProps={{ placement: 'bottomRight' }}
        />
        {scopeConnected ? (
          <div className={styles.greenDot} />
        ) : (
          failure && <div className={styles.errorDot} />
        )}
      </div>
    </Popover>
  );
});

const DeviceGatewayWithAuth = memo(() => {
  const isSyncActive = useElectronStore(electronSyncSelectors.isSyncActive);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  if (!isSyncActive) return null;

  return <DeviceGateway workspaceScoped={!!activeWorkspaceSlug} />;
});

export default DeviceGatewayWithAuth;
