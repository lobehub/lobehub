'use client';

import { Alert, Flexbox, FormItem } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';

import QrCodeAuth from './QrCodeAuth';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-end: 16px;
  `,
}));

const ReadOnlyField = memo<{
  description?: string;
  divider?: boolean;
  label: string;
  password?: boolean;
  tag: string;
  value?: string;
}>(({ description, divider, label, password, tag, value }) => {
  const InputComponent = password ? FormPassword : FormInput;

  return (
    <FormItem
      desc={description}
      divider={divider}
      label={label}
      minWidth={'max(50%, 400px)'}
      tag={tag}
      variant="borderless"
    >
      <InputComponent readOnly value={value || ''} />
    </FormItem>
  );
});

interface WechatConnectedInfoProps {
  currentConfig: {
    applicationId: string;
    credentials: Record<string, string>;
  };
  onQrAuthenticated?: (credentials: { botId: string; botToken: string; userId: string }) => void;
}

const WechatConnectedInfo = memo<WechatConnectedInfoProps>(
  ({ currentConfig, onQrAuthenticated }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    const shouldShowApplicationId =
      !!currentConfig.applicationId &&
      currentConfig.applicationId !== currentConfig.credentials.botId;

    return (
      <>
        <div className={styles.header}>
          <Flexbox gap={4}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t('channel.wechatConnectedInfo')}</div>
            <div style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
              {t('channel.wechatManagedCredentials')}
            </div>
          </Flexbox>
          {onQrAuthenticated && (
            <QrCodeAuth
              buttonLabel={t('channel.wechatRebind')}
              buttonType="default"
              showTips={false}
              onAuthenticated={onQrAuthenticated}
            />
          )}
        </div>
        <Alert
          showIcon
          message={t('channel.wechatIdleNotice')}
          style={{ marginBlockEnd: 16 }}
          type="info"
        />
        {shouldShowApplicationId && (
          <ReadOnlyField
            description={t('channel.applicationIdHint')}
            label={t('channel.applicationId')}
            tag="applicationId"
            value={currentConfig.applicationId}
          />
        )}
        {process.env.NODE_ENV === 'development' && (
          <>
            <ReadOnlyField
              description={t('channel.wechatBotIdHint')}
              divider={shouldShowApplicationId}
              label={t('channel.wechatBotId')}
              tag="botId"
              value={currentConfig.credentials.botId}
            />
            <ReadOnlyField
              divider
              password
              description={t('channel.botTokenEncryptedHint')}
              label={t('channel.botToken')}
              tag="botToken"
              value={currentConfig.credentials.botToken}
            />
            <ReadOnlyField
              divider
              description={t('channel.wechatUserIdHint')}
              label={t('channel.wechatUserId')}
              tag="userId"
              value={currentConfig.credentials.userId}
            />
          </>
        )}
      </>
    );
  },
);

export default WechatConnectedInfo;
