'use client';

import { Block, Button, Flexbox, Input, Text } from '@lobehub/ui';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

interface DeviceCodeInputProps {
  errorKey?: string;
  userCode?: string;
  xsrf?: string;
}

const DeviceCodeInput = memo<DeviceCodeInputProps>(({ xsrf, errorKey, userCode }) => {
  const { t } = useTranslation('oauth');

  return (
    <AuthCard
      subtitle={t('device.input.description')}
      title={t('device.input.title')}
      footer={
        <form action="/oidc/device" method="post" style={{ width: '100%' }}>
          {xsrf && <input name="xsrf" type="hidden" value={xsrf} />}
          <Flexbox gap={16}>
            <Input
              autoFocus
              autoComplete="off"
              defaultValue={userCode}
              name="user_code"
              placeholder={t('device.input.placeholder')}
              size="large"
              style={{ fontFamily: 'monospace', letterSpacing: '0.15em', textAlign: 'center' }}
            />
            <Button block htmlType="submit" size="large" type="primary">
              {t('device.input.submit')}
            </Button>
          </Flexbox>
        </form>
      }
    >
      {errorKey && (
        <Block padding={16} variant="filled">
          <Text style={{ color: 'red' }}>{t(errorKey as any)}</Text>
        </Block>
      )}
    </AuthCard>
  );
});

DeviceCodeInput.displayName = 'DeviceCodeInput';

export default DeviceCodeInput;
