'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceListItem, DeviceScope } from '@lobechat/types';
import { Button, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { ArrowLeftIcon, MonitorXIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useElectronStore } from '@/store/electron';

import DeviceDetail from './DeviceDetail';
import { useDeviceList } from './useDeviceList';

const DetailSkeleton = memo(() => (
  <Flexbox gap={24}>
    <Skeleton height={24} width={120} />
    <Flexbox horizontal align={'center'} gap={16}>
      <Skeleton.Avatar shape={'square'} size={56} />
      <Flexbox flex={1} gap={8}>
        <Skeleton height={20} width={200} />
        <Skeleton height={14} width={120} />
      </Flexbox>
    </Flexbox>
    <Skeleton height={32} width={'100%'} />
    <Skeleton.Text rows={6} />
  </Flexbox>
));

interface DeviceDetailPageProps {
  deviceId: string;
  /** Leave the detail for the list. Receives the resolved device when there is one. */
  onBack: (device?: DeviceListItem) => void;
  scope: DeviceScope;
}

/**
 * Resolves a `:sub` device id against the shared device list, then renders the
 * detail page — or a not-found state for a removed device or a stale link.
 */
const DeviceDetailPage = memo<DeviceDetailPageProps>(({ deviceId, onBack, scope }) => {
  const { t } = useTranslation('setting');
  const { data, isLoading, error, mutate } = useDeviceList();
  const device = data?.find((d) => d.deviceId === deviceId && d.scope === scope);

  // The machine the user is on right now (desktop only) — personal pool only.
  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const isCurrent =
    scope === 'personal' && isDesktop && !!device && gatewayDeviceInfo?.deviceId === deviceId;

  const notFound = (
    <Flexbox align={'center'} gap={12} paddingBlock={64} style={{ textAlign: 'center' }}>
      <Icon icon={MonitorXIcon} size={32} style={{ opacity: 0.45 }} />
      <Text fontSize={16} weight={600}>
        {t('devices.detail.notFound.title')}
      </Text>
      <Text type={'secondary'}>{t('devices.detail.notFound.desc')}</Text>
      <Button
        icon={<Icon icon={ArrowLeftIcon} />}
        style={{ marginBlockStart: 8 }}
        onClick={() => onBack()}
      >
        {t('devices.detail.back')}
      </Button>
    </Flexbox>
  );

  return (
    <AsyncBoundary
      data={data}
      empty={notFound}
      error={error}
      errorVariant={'block'}
      isEmpty={!device}
      isLoading={isLoading}
      loading={<DetailSkeleton />}
      onRetry={() => mutate()}
    >
      {device && (
        // keyed on deviceId so the form drafts reset when the route moves to another device
        <DeviceDetail
          device={device}
          isCurrent={isCurrent}
          key={device.deviceId}
          onBack={() => onBack(device)}
        />
      )}
    </AsyncBoundary>
  );
});

DeviceDetailPage.displayName = 'DeviceDetailPage';

export default DeviceDetailPage;
