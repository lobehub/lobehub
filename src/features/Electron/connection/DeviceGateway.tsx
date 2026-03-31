import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Input, Popover, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { HardDrive } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
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
  input: css`
    border: none;
    background: ${cssVar.colorFillTertiary};

    &:hover,
    &:focus {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  popoverContent: css`
    width: 280px;
    padding-block: 4px;
    padding-inline: 0;
  `,
  statusTitle: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

const DeviceGateway = memo(() => {
  const { t } = useTranslation('electron');
  const [
    gatewayStatus,
    connectGateway,
    disconnectGateway,
    setGatewayConnectionStatus,
    useFetchGatewayStatus,
    useFetchGatewayDeviceInfo,
    updateDeviceName,
    updateDeviceDescription,
    gatewayDeviceInfo,
  ] = useElectronStore((s) => [
    s.gatewayConnectionStatus,
    s.connectGateway,
    s.disconnectGateway,
    s.setGatewayConnectionStatus,
    s.useFetchGatewayStatus,
    s.useFetchGatewayDeviceInfo,
    s.updateDeviceName,
    s.updateDeviceDescription,
    s.gatewayDeviceInfo,
  ]);

  useFetchGatewayStatus();
  useFetchGatewayDeviceInfo();

  useWatchBroadcast('gatewayConnectionStatusChanged', ({ status }) => {
    setGatewayConnectionStatus(status);
  });

  const isConnected = gatewayStatus === 'connected';
  const isConnecting = gatewayStatus === 'connecting' || gatewayStatus === 'reconnecting';

  const [localName, setLocalName] = useState<string | undefined>();
  const [localDescription, setLocalDescription] = useState<string | undefined>();

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

  const handleNameBlur = useCallback(() => {
    if (localName !== undefined && localName !== gatewayDeviceInfo?.name) {
      updateDeviceName(localName);
    }
    setLocalName(undefined);
  }, [localName, gatewayDeviceInfo?.name, updateDeviceName]);

  const handleDescriptionBlur = useCallback(() => {
    if (localDescription !== undefined && localDescription !== gatewayDeviceInfo?.description) {
      updateDeviceDescription(localDescription);
    }
    setLocalDescription(undefined);
  }, [localDescription, gatewayDeviceInfo?.description, updateDeviceDescription]);

  const popoverContent = (
    <Flexbox className={styles.popoverContent} gap={16}>
      <Flexbox horizontal align="center" justify="space-between">
        <span className={styles.statusTitle}>{t('gateway.enableConnection')}</span>
        <Switch
          checked={isConnected || isConnecting}
          loading={isConnecting}
          size="small"
          onChange={handleSwitchChange}
        />
      </Flexbox>

      <Flexbox gap={4}>
        <span className={styles.fieldLabel}>{t('gateway.deviceName')}</span>
        <Input
          className={styles.input}
          placeholder={t('gateway.deviceNamePlaceholder')}
          size="small"
          value={localName ?? gatewayDeviceInfo?.name ?? ''}
          variant="filled"
          onBlur={handleNameBlur}
          onChange={(e) => setLocalName(e.target.value)}
          onPressEnter={handleNameBlur}
        />
      </Flexbox>

      <Flexbox gap={4}>
        <span className={styles.fieldLabel}>{t('gateway.description')}</span>
        <Input.TextArea
          autoSize={{ maxRows: 3, minRows: 2 }}
          className={styles.input}
          placeholder={t('gateway.descriptionPlaceholder')}
          size="small"
          value={localDescription ?? gatewayDeviceInfo?.description ?? ''}
          variant="filled"
          onBlur={handleDescriptionBlur}
          onChange={(e) => setLocalDescription(e.target.value)}
        />
      </Flexbox>
    </Flexbox>
  );

  return (
    <Popover arrow={false} content={popoverContent} placement="bottomRight" trigger="click">
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

  if (!isSyncActive) return null;

  return <DeviceGateway />;
});

export default DeviceGatewayWithAuth;
