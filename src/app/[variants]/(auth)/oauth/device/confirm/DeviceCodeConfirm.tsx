'use client';

import { Block, Button, Flexbox, Text } from '@lobehub/ui';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

interface DeviceCodeConfirmProps {
  clientName: string;
  userCode: string;
  xsrf?: string;
}

const DeviceCodeConfirm = memo<DeviceCodeConfirmProps>(({ xsrf, userCode, clientName }) => {
  const { t } = useTranslation('oauth');
  const [isLoading, setIsLoading] = useState(false);

  return (
    <AuthCard
      subtitle={t('device.confirm.description', { clientName })}
      title={t('device.confirm.title')}
      footer={
        <form action="/oidc/device" method="post" style={{ width: '100%' }}>
          {xsrf && <input name="xsrf" type="hidden" value={xsrf} />}
          <input name="user_code" type="hidden" value={userCode} />
          <input name="confirm" type="hidden" value="yes" />
          <Flexbox gap={12}>
            <Button
              block
              htmlType="submit"
              loading={isLoading}
              size="large"
              type="primary"
              onClick={() => setIsLoading(true)}
            >
              {t('device.confirm.authorize')}
            </Button>
            <Button block htmlType="submit" name="abort" size="large" value="yes">
              {t('device.confirm.deny')}
            </Button>
          </Flexbox>
        </form>
      }
    >
      <Block padding={16} variant="filled">
        <Text
          style={{
            fontFamily: 'monospace',
            fontSize: 24,
            fontWeight: 'bold',
            letterSpacing: '0.15em',
            textAlign: 'center',
          }}
        >
          {userCode}
        </Text>
      </Block>
      <Text style={{ marginTop: 8 }} type="secondary">
        {t('device.confirm.codeHint')}
      </Text>
    </AuthCard>
  );
});

DeviceCodeConfirm.displayName = 'DeviceCodeConfirm';

export default DeviceCodeConfirm;
