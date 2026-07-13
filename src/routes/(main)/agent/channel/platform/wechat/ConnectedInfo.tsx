'use client';

import { Alert, Flexbox, FormItem, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Fingerprint, KeyRound, type LucideIcon, UserRound } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';

import QrCodeAuth from './QrCodeAuth';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    display: flex;
    align-items: center;
    margin-block-end: 16px;
  `,
}));

const ReadOnlyField = memo<{
  divider?: boolean;
  icon: LucideIcon;
  label: string;
  password?: boolean;
  value?: string;
}>(({ divider, icon, label, password, value }) => {
  const InputComponent = password ? FormPassword : FormInput;

  return (
    <FormItem
      avatar={<Icon className={styles.fieldIcon} icon={icon} size={20} />}
      divider={divider}
      label={label}
      minWidth={'max(50%, 400px)'}
      variant="outlined"
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
        <div className={styles.header}>
          <Flexbox gap={4}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t('channel.wechatConnectedInfo')}</div>
            <div style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
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
        <Alert
          showIcon
          message={t('channel.wechatIdleNotice')}
          style={{ marginBlock: '16px' }}
          type="info"
        />
        {shouldShowApplicationId && (
          <ReadOnlyField
            icon={Fingerprint}
            label={t('channel.applicationId')}
            value={currentConfig.applicationId}
          />
        )}
        {__DEV__ && (
          <>
            <ReadOnlyField
              divider={shouldShowApplicationId}
              icon={Fingerprint}
              label={t('channel.wechatBotId')}
              value={currentConfig.credentials.botId}
            />
            <ReadOnlyField
              divider
              password
              icon={KeyRound}
              label={t('channel.botToken')}
              value={currentConfig.credentials.botToken}
            />
            <ReadOnlyField
              divider
              icon={UserRound}
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
