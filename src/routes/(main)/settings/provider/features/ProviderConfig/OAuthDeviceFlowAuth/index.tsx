'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { ProviderIcon } from '@lobehub/icons';
import { CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { App, Avatar, Button, Typography } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import { ExternalLinkIcon, Loader2Icon, LogOutIcon, UnplugIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

import { useOAuthDeviceFlow } from './useOAuthDeviceFlow';

const { Text, Link } = Typography;

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    overflow: hidden;

    width: 100%;
    margin-block-end: 24px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
  `,
  codeBox: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    padding-block: 16px;
    padding-inline: 24px;
    border-radius: 12px;

    font-family: monospace;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: 6px;

    background: ${token.colorFillTertiary};
  `,
  content: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: center;

    margin-block: 0 40px;
    padding-inline: 48px;
  `,
  errorText: css`
    color: ${token.colorError};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  hero: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: center;

    padding-block: 48px 32px;
    padding-inline: 24px;
    border-radius: 16px 16px 0 0;
  `,
  pollingHint: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding-block: 12px;
    padding-inline: 16px;
    border-radius: 8px;

    font-size: 13px;
    color: ${token.colorTextSecondary};

    background: ${token.colorFillQuaternary};
  `,
  serviceNote: css`
    font-size: 13px;
    color: ${token.colorTextDescription};
    text-align: center;
  `,
  successBadge: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 13px;
    color: ${token.colorSuccess};
  `,
  userAvatar: css`
    border: 2px solid ${token.colorBorderSecondary};
    box-shadow: 0 4px 12px ${token.colorFillSecondary};
  `,
  userInfo: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
  `,
  username: css`
    font-size: 16px;
    font-weight: 600;
    color: ${token.colorText};
  `,
}));

export interface OAuthDeviceFlowAuthProps {
  extra?: ReactNode;
  name: string;
  onAuthChange?: () => void;
  providerId: string;
  title?: ReactNode;
}

const OAuthDeviceFlowAuth = memo<OAuthDeviceFlowAuthProps>(
  ({ providerId, name, onAuthChange, title, extra }) => {
    const { t } = useTranslation('modelProvider');
    const { modal } = App.useApp();
    const { styles } = useStyles();

    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const hasAutoClosedRef = useRef(false);

    const utils = lambdaQuery.useUtils();

    const { data: authStatus } = lambdaQuery.oauthDeviceFlow.getAuthStatus.useQuery(
      { providerId },
      { refetchOnWindowFocus: true },
    );
    const isAuthenticated = authStatus?.isAuthenticated ?? false;
    const username = authStatus?.username;
    const avatarUrl = authStatus?.avatarUrl;

    const revokeAuth = lambdaQuery.oauthDeviceFlow.revokeAuth.useMutation({
      onSuccess: () => {
        utils.oauthDeviceFlow.getAuthStatus.invalidate({ providerId });
        onAuthChange?.();
      },
    });

    const handleSuccess = useCallback(async () => {
      // First invalidate and refetch the auth status
      await utils.oauthDeviceFlow.getAuthStatus.invalidate({ providerId });
      // Then notify parent and reset authenticating state
      onAuthChange?.();
      setIsAuthenticating(false);
    }, [onAuthChange, providerId, utils.oauthDeviceFlow.getAuthStatus]);

    const { state, deviceCodeInfo, error, startAuth, cancelAuth } = useOAuthDeviceFlow({
      onSuccess: handleSuccess,
      providerId,
    });

    const handleDisconnect = useCallback(() => {
      modal.confirm({
        centered: true,
        content: t('providerModels.config.oauth.disconnectConfirm'),
        okButtonProps: { danger: true },
        okText: t('providerModels.config.oauth.disconnect'),
        onOk: async () => {
          await revokeAuth.mutateAsync({ providerId });
        },
        title: t('providerModels.config.oauth.disconnect'),
      });
    }, [modal, providerId, revokeAuth, t]);

    const handleStartAuth = useCallback(async () => {
      hasAutoClosedRef.current = false;
      setIsAuthenticating(true);
      await startAuth();
    }, [startAuth]);

    const handleCancelAuth = useCallback(() => {
      setIsAuthenticating(false);
      cancelAuth();
    }, [cancelAuth]);

    const handleOpenBrowser = useCallback(() => {
      if (deviceCodeInfo?.verificationUri) {
        window.open(deviceCodeInfo.verificationUri, '_blank');
      }
    }, [deviceCodeInfo?.verificationUri]);

    // Reset hasAutoClosedRef when starting new auth
    useEffect(() => {
      if (state === 'success' && !hasAutoClosedRef.current) {
        hasAutoClosedRef.current = true;
      }
    }, [state]);

    // Render Hero section with provider logo
    const renderHero = () => (
      <div className={styles.hero}>
        <ProviderIcon provider={providerId} size={72} type={'avatar'} />
      </div>
    );

    // Render content based on authentication state
    const renderContent = () => {
      // Authenticated state - show user info
      // Show when authenticated and not in the middle of authenticating process
      if (isAuthenticated && !isAuthenticating) {
        return (
          <div className={styles.content}>
            <Flexbox align="center" gap={16}>
              {avatarUrl && <Avatar className={styles.userAvatar} size={56} src={avatarUrl} />}
              <div className={styles.userInfo}>
                {username && <span className={styles.username}>{username}</span>}
                <div className={styles.successBadge}>
                  <CheckCircleFilled />
                  <span>{t('providerModels.config.oauth.connected')}</span>
                </div>
              </div>
            </Flexbox>
            <Button
              icon={<Icon icon={LogOutIcon} />}
              loading={revokeAuth.isPending}
              onClick={handleDisconnect}
            >
              {t('providerModels.config.oauth.disconnect')}
            </Button>
            <div className={styles.serviceNote}>
              {t('providerModels.config.oauth.serviceNote', { name })}
            </div>
          </div>
        );
      }

      // Authenticating state - show device code
      if (isAuthenticating) {
        // Loading state
        if (state === 'requesting' || !deviceCodeInfo) {
          return (
            <div className={styles.content}>
              <Icon spin icon={Loader2Icon} size={24} />
              <Text type="secondary">{t('providerModels.config.oauth.connecting')}</Text>
            </div>
          );
        }

        // Error state
        if (state === 'error' && error) {
          const errorKey = `providerModels.config.oauth.${error}`;
          return (
            <div className={styles.content}>
              <Flexbox horizontal align="center" gap={8}>
                <Icon color={cssVar.colorError} icon={UnplugIcon} size={20} />
                <Text className={styles.errorText}>{t(errorKey as any)}</Text>
              </Flexbox>
              <Flexbox gap={12} style={{ width: '100%' }} width={280}>
                <Button block type="primary" onClick={handleStartAuth}>
                  {t('providerModels.config.oauth.retry')}
                </Button>
                <Button block type="text" onClick={handleCancelAuth}>
                  {t('providerModels.config.oauth.cancel')}
                </Button>
              </Flexbox>
            </div>
          );
        }

        // Device code display
        return (
          <div className={styles.content}>
            <Flexbox align="center" gap={12} style={{ width: '100%' }} width={320}>
              <Text type="secondary">{t('providerModels.config.oauth.enterCode')}</Text>
              <Flexbox horizontal align="center" gap={12} style={{ width: '100%' }}>
                <div className={styles.codeBox}>{deviceCodeInfo.userCode}</div>
                <CopyButton content={deviceCodeInfo.userCode} />
              </Flexbox>
            </Flexbox>

            <Flexbox gap={12} style={{ width: '100%' }} width={280}>
              <Button
                block
                icon={<Icon icon={ExternalLinkIcon} />}
                size="large"
                type="primary"
                onClick={handleOpenBrowser}
              >
                {t('providerModels.config.oauth.openBrowser')}
              </Button>
            </Flexbox>

            <Link
              href={deviceCodeInfo.verificationUri}
              style={{ fontSize: 13 }}
              target="_blank"
              type="secondary"
            >
              {deviceCodeInfo.verificationUri}
            </Link>

            <div className={styles.pollingHint}>
              <Icon spin icon={Loader2Icon} />
              <span>{t('providerModels.config.oauth.polling')}</span>
            </div>

            <Button type="text" onClick={handleCancelAuth}>
              {t('providerModels.config.oauth.cancel')}
            </Button>
          </div>
        );
      }

      // Error state (not authenticating)
      if (state === 'error' && error) {
        const errorKey = `providerModels.config.oauth.${error}`;
        return (
          <div className={styles.content}>
            <Flexbox horizontal align="center" gap={8}>
              <Icon color={cssVar.colorError} icon={UnplugIcon} size={18} />
              <Text className={styles.errorText}>{t(errorKey as any)}</Text>
            </Flexbox>
            <Button size="large" type="primary" onClick={handleStartAuth}>
              {t('providerModels.config.oauth.connect', { name })}
            </Button>
            <div className={styles.serviceNote}>
              {t('providerModels.config.oauth.serviceNote', { name })}
            </div>
          </div>
        );
      }

      // Default state - show connect button
      return (
        <div className={styles.content}>
          <Button size="large" type="primary" onClick={handleStartAuth}>
            {t('providerModels.config.oauth.connect', { name })}
          </Button>
          <div className={styles.serviceNote}>
            {t('providerModels.config.oauth.serviceNote', { name })}
          </div>
        </div>
      );
    };

    return (
      <div className={styles.card}>
        {(title || extra) && (
          <div className={styles.header}>
            <div>{title}</div>
            <div>{extra}</div>
          </div>
        )}
        {renderHero()}
        {renderContent()}
      </div>
    );
  },
);

OAuthDeviceFlowAuth.displayName = 'OAuthDeviceFlowAuth';

export default OAuthDeviceFlowAuth;
