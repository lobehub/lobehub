'use client';

import '../resultStyles.css';

import { FluentEmoji, Result, Text } from '@lobehub/ui';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

const DeviceSuccess = memo(() => {
  const { t } = useTranslation('oauth');

  return (
    <Result
      className={'lobe-result-styles-cb01c08e-full-width-sub-title'}
      icon={<FluentEmoji emoji={'✅'} size={96} type={'anim'} />}
      status="success"
      subTitle={
        <Text align="center" as="span" fontSize={16} style={{ display: 'block' }} type="secondary">
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
