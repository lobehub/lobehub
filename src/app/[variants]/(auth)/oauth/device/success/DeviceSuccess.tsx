'use client';

import { FluentEmoji, Text } from '@lobehub/ui';
import { Result } from 'antd';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

const DeviceSuccess = memo(() => {
  const { t } = useTranslation('oauth');

  return (
    <Result
      icon={<FluentEmoji emoji={'✅'} size={96} type={'anim'} />}
      status="success"
      subTitle={
        <Text fontSize={16} type="secondary">
          {t('device.success.description')}
        </Text>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {t('device.success.title')}
        </Text>
      }
    />
  );
});

DeviceSuccess.displayName = 'DeviceSuccess';

export default DeviceSuccess;
