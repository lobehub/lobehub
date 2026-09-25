'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { CONNECTABLE_PROVIDERS } from '@/features/ConnectAgent/providers';
import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';

import FieldLabel from '../FieldLabel';
import { partitionScan } from './partitionScan';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

/**
 * The agent runtimes installed on the device (Claude Code, Codex, …), probed
 * live over the device connection. Only an online device can answer, so an
 * offline one says so instead of showing a stale or empty list.
 */
const AgentRuntimes = ({ device }: { device: DeviceListItem }) => {
  const { t } = useTranslation('setting');
  const online = (device.channels ?? []).length > 0;

  const { data, error, isLoading, isValidating, mutate } = useClientDataSWR(
    online ? ['device/agentScan', device.deviceId] : null,
    () => deviceService.scanAgents({ deviceId: device.deviceId }),
    { revalidateOnFocus: false },
  );

  if (!online) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('devices.agents.offline')}
      </Text>
    );
  }

  if (isLoading) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('devices.agents.scanning')}
      </Text>
    );
  }

  const failure = error?.message ?? data?.error;
  const rescan = (
    <Button loading={isValidating} size={'small'} onClick={() => mutate()}>
      {t('devices.agents.rescan')}
    </Button>
  );

  if (failure || !data) {
    return (
      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'}>
          {t('devices.agents.error', { error: failure ?? '' })}
        </Text>
        <Flexbox horizontal>{rescan}</Flexbox>
      </Flexbox>
    );
  }

  // Only what is installed for now; the not-found list read as noise.
  const { installed } = partitionScan(data.agents, CONNECTABLE_PROVIDERS);

  return (
    <Flexbox gap={8}>
      <FieldLabel extra={rescan}>{t('devices.agents.installed')}</FieldLabel>
      {installed.length === 0 ? (
        <Text fontSize={12} type={'secondary'}>
          {t('devices.agents.empty')}
        </Text>
      ) : (
        installed.map(({ provider, version }) => (
          <Flexbox horizontal align={'center'} className={styles.row} gap={10} key={provider.type}>
            <provider.brand.Avatar size={24} />
            <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
              {provider.title}
            </Text>
            {version && <Tag size={'small'}>{version}</Tag>}
          </Flexbox>
        ))
      )}
    </Flexbox>
  );
};

export default AgentRuntimes;
