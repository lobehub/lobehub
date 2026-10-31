import { type GatewayConnectionErrorCode, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { ActionIcon, Button, Flexbox, Popover, Switch } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { HardDrive, SettingsIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  getScopedConnectionCount,
  getWorkspaceConnectionState,
} from '@/features/DeviceManager/connectionCount';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

/** Why the last attempt ended, phrased with the next step. */
const ERROR_MESSAGE_KEYS = {
  auth_failed: 'gateway.error.authRejected',
  config_unavailable: 'gateway.error.configUnavailable',
  invalid_gateway_url: 'gateway.error.invalidAddress',
  not_signed_in: 'gateway.error.notSignedIn',
} as const satisfies Record<GatewayConnectionErrorCode, string>;

const styles = stylex.create({
  errorDot: {
    position: 'absolute',
    insetBlockEnd: '0',
    insetInlineEnd: '0',
    width: '8px',
    height: '8px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
  },
  errorHint: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorError },
  greenDot: {
    position: 'absolute',
    insetBlockEnd: '0',
    insetInlineEnd: '0',
    width: '8px',
    height: '8px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    backgroundColor: '#52c41a',
    backgroundImage: 'none',
  },
  popoverContent: { width: '250px' },
  scopeHint: {
    fontSize: '11px',
    lineHeight: 1.4,
    color: cssVar.colorTextDescription,
    whiteSpace: 'nowrap',
  },
  statusTitle: { fontSize: '13px', fontWeight: 500, color: cssVar.colorText },
});

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
  const deviceList = useDeviceList();
  const devices = deviceList.data;

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
  const workspaceConnectionState = getWorkspaceConnectionState(deviceList);
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
    <Flexbox className={stylex.props(styles.popoverContent).className} gap={4}>
      <Flexbox horizontal align="center" justify="space-between">
        <span {...stylex.props(styles.statusTitle)}>{t('gateway.title')}</span>
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
      <span {...stylex.props(styles.scopeHint)}>{connectionHint}</span>
      {failure && (
        <Flexbox align="flex-start" gap={4}>
          <span {...stylex.props(styles.errorHint)} title={failure.detail}>
            {t(ERROR_MESSAGE_KEYS[failure.code])}
          </span>
          <Flexbox horizontal gap={4}>
            {failure.code !== 'not_signed_in' && failure.code !== 'invalid_gateway_url' && (
              <Button outdent size="small" type="text" onClick={() => void connectGateway()}>
                {t('gateway.retry')}
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
          <div {...stylex.props(styles.greenDot)} />
        ) : (
          failure && <div {...stylex.props(styles.errorDot)} />
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
