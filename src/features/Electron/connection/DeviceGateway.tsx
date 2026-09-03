import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Popover, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { HardDrive, SettingsIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
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

const DeviceGateway = memo(() => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const [
    gatewayStatus,
    connectGateway,
    disconnectGateway,
    setGatewayConnectionStatus,
    useFetchGatewayStatus,
  ] = useElectronStore((s) => [
    s.gatewayConnectionStatus,
    s.connectGateway,
    s.disconnectGateway,
    s.setGatewayConnectionStatus,
    s.useFetchGatewayStatus,
  ]);

  useFetchGatewayStatus();

  useWatchBroadcast('gatewayConnectionStatusChanged', ({ status }) => {
    setGatewayConnectionStatus(status);
  });

  const isConnected = gatewayStatus === 'connected';
  const isConnecting =
    gatewayStatus === 'authenticating' ||
    gatewayStatus === 'connecting' ||
    gatewayStatus === 'reconnecting';

  const [open, setOpen] = useState(false);

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

  const connectionHint = t(
    isConnecting
      ? 'gateway.statusConnecting'
      : isConnected
        ? 'gateway.statusConnected'
        : 'gateway.statusDisconnected',
  );

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
            onClick={() => {
              setOpen(false);
              navigate('/settings/devices', { escape: true });
            }}
          />
          <Switch
            aria-label={t('gateway.enableConnection')}
            checked={isConnected || isConnecting}
            loading={isConnecting}
            size="small"
            onChange={handleSwitchChange}
          />
        </Flexbox>
      </Flexbox>
      <span className={styles.scopeHint}>{connectionHint}</span>
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
        {isConnected && <div className={styles.greenDot} />}
      </div>
    </Popover>
  );
});

const DeviceGatewayWithAuth = memo(() => {
  const isSyncActive = useElectronStore(electronSyncSelectors.isSyncActive);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  if (!isSyncActive || activeWorkspaceSlug) return null;

  return <DeviceGateway />;
});

export default DeviceGatewayWithAuth;
