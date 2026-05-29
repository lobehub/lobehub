'use client';

import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

import DeviceItem from './DeviceItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  empty: css`
    padding-block: 48px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
}));

const DeviceList = memo(() => {
  const { t } = useTranslation('setting');
  const { data: devices, isLoading } = lambdaQuery.device.listDevices.useQuery(undefined, {
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} title={false} />;

  if (!devices || devices.length === 0)
    return (
      <Flexbox align={'center'} className={styles.empty} justify={'center'}>
        <Text type={'secondary'}>{t('devices.empty')}</Text>
      </Flexbox>
    );

  return (
    <Flexbox className={styles.container} padding={4}>
      {devices.map((device) => (
        <DeviceItem device={device} key={device.deviceId} />
      ))}
    </Flexbox>
  );
});

DeviceList.displayName = 'DeviceList';

export default DeviceList;
