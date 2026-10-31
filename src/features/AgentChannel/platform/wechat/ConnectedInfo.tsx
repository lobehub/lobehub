'use client';

import { Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';

import QrCodeAuth from './QrCodeAuth';

const styles = stylex.create({
  header: { display: 'flex', alignItems: 'center', marginBlockEnd: '16px' },
});

const ReadOnlyField = memo<{
  divider?: boolean;
  label: string;
  password?: boolean;
  value?: string;
}>(({ divider, label, password, value }) => {
  const InputComponent = password ? FormPassword : FormInput;

  return (
    <Form.Field divider={divider} label={label} layout="vertical">
      <InputComponent readOnly value={value || ''} />
    </Form.Field>
  );
});

interface WechatConnectedInfoProps {
  currentConfig: {
    applicationId: string;
    credentials: Record<string, string>;
  };
  disabled?: boolean;
  onQrAuthenticated?: (credentials: { botId: string; botToken: string; userId: string }) => void;
}

const WechatConnectedInfo = memo<WechatConnectedInfoProps>(
  ({ currentConfig, disabled, onQrAuthenticated }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    const shouldShowApplicationId =
      !!currentConfig.applicationId &&
      currentConfig.applicationId !== currentConfig.credentials.botId;

    return (
      <>
        <div {...stylex.props(styles.header)}>
          <Flexbox gap={4}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t('channel.wechatConnectedInfo')}</div>
            <div style={{ color: 'var(--lobe-color-text-secondary)', fontSize: 13 }}>
              {t('channel.wechatManagedCredentials')}
            </div>
          </Flexbox>
        </div>
        {onQrAuthenticated && (
          <QrCodeAuth
            buttonType="default"
            disabled={disabled}
            showTips={false}
            onAuthenticated={onQrAuthenticated}
          />
        )}
        {shouldShowApplicationId && (
          <ReadOnlyField label={t('channel.applicationId')} value={currentConfig.applicationId} />
        )}
        {__DEV__ && (
          <>
            <ReadOnlyField
              divider={shouldShowApplicationId}
              label={t('channel.wechatBotId')}
              value={currentConfig.credentials.botId}
            />
            <ReadOnlyField
              divider
              password
              label={t('channel.botToken')}
              value={currentConfig.credentials.botToken}
            />
            <ReadOnlyField
              divider
              label={t('channel.wechatUserId')}
              value={currentConfig.credentials.userId}
            />
          </>
        )}
      </>
    );
  },
);

export default WechatConnectedInfo;
