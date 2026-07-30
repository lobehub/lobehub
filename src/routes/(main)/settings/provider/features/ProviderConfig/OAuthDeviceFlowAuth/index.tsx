'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { MAX_WIDTH } from '@lobechat/const';
import { Avatar, CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { Typography } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ExternalLinkIcon, Loader2Icon, LogOutIcon, UnplugIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { lambdaQuery } from '@/libs/trpc/client';

import { useOAuthDeviceFlow } from './useOAuthDeviceFlow';

const { Text, Link } = Typography;

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;

    /* matches the borderless form below so both boxes end on the same edge */
    width: 100%;
    max-width: ${MAX_WIDTH}px;
    border: 1px solid ${cssVar.colorBorderSecondary};
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

    background: ${cssVar.colorFillTertiary};
  `,
  content: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;

    padding-block: 24px 28px;
    padding-inline: 24px;
  `,
  divider: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  errorText: css`
    color: ${cssVar.colorError};
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
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
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  successBadge: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 13px;
    color: ${cssVar.colorSuccess};
  `,
  username: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export interface OAuthDeviceFlowAuthProps {
  /**
   * Whether the provider is switched on. The connect action only shows up once
   * the provider is enabled, so the row stays a single toggle until then.
   */
  enabled?: boolean;
  extra?: ReactNode;
  onAuthChange?: () => void;
  providerId: string;
  title?: ReactNode;
}

const OAuthDeviceFlowAuth = memo<OAuthDeviceFlowAuthProps>(
  ({ providerId, onAuthChange, title, extra, enabled }) => {
    const { t } = useTranslation('modelProvider');
    const { allowed: canManageProvider } = usePermission('manage_provider_key');
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    const utils = lambdaQuery.useUtils();

    const { data: authStatus } = lambdaQuery.oauthDeviceFlow.getAuthStatus.useQuery(
      { providerId },
      { refetchOnWindowFocus: true },
    );
    const isAuthenticated = authStatus?.status === 'ACTIVE';
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
      if (!canManageProvider) return;

      confirmModal({
        content: t('providerModels.config.oauth.disconnectConfirm'),
        okButtonProps: { danger: true },
        okText: t('providerModels.config.oauth.disconnect'),
        onOk: async () => {
          await revokeAuth.mutateAsync({ providerId });
        },
        title: t('providerModels.config.oauth.disconnect'),
      });
    }, [canManageProvider, providerId, revokeAuth, t]);

    const handleStartAuth = useCallback(async () => {
      if (!canManageProvider) return;

      setIsAuthenticating(true);
      const info = await startAuth();

      // Auto-open the verification page right away — the Connect click still
      // counts as transient user activation, so popup blockers normally allow
      // it. The manual "open browser" button stays as a fallback when blocked.
      const uri = info?.verificationUriComplete || info?.verificationUri;
      if (uri) window.open(uri, '_blank');
    }, [canManageProvider, startAuth]);

    const handleCancelAuth = useCallback(() => {
      setIsAuthenticating(false);
      cancelAuth();
    }, [cancelAuth]);

    const handleOpenBrowser = useCallback(() => {
      // Prefer the code-prefilled URI so the user doesn't need to type the code
      const uri = deviceCodeInfo?.verificationUriComplete || deviceCodeInfo?.verificationUri;
      if (uri) {
        window.open(uri, '_blank');
      }
    }, [deviceCodeInfo?.verificationUri, deviceCodeInfo?.verificationUriComplete]);

    // The inline action that trails the enable switch in the header row.
    // The whole device-code flow lives in the expandable panel below, so the
    // row keeps a single action at any time.
    const renderAction = () => {
      if (!enabled || isAuthenticating) return null;

      if (isAuthenticated)
        return (
          <>
            {username ? (
              <Flexbox horizontal align={'center'} gap={6}>
                {avatarUrl && <Avatar avatar={avatarUrl} size={20} title={username} />}
                <span className={styles.username}>{username}</span>
              </Flexbox>
            ) : (
              <div className={styles.successBadge}>
                <CheckCircleFilled />
                <span>{t('providerModels.config.oauth.connected')}</span>
              </div>
            )}
            <Button
              disabled={!canManageProvider}
              icon={LogOutIcon}
              loading={revokeAuth.isPending}
              size={'small'}
              onClick={handleDisconnect}
            >
              {t('providerModels.config.oauth.disconnect')}
            </Button>
          </>
        );

      return (
        <Button
          disabled={!canManageProvider}
          size={'small'}
          type={'primary'}
          onClick={handleStartAuth}
        >
          {t('providerModels.config.oauth.connect')}
        </Button>
      );
    };

    // Device-code flow panel, only mounted while an authorization is in flight
    const renderAuthPanel = () => {
      // Loading state
      if (state === 'requesting' || !deviceCodeInfo)
        return (
          <div className={styles.content}>
            <Icon spin icon={Loader2Icon} size={24} />
            <Text type="secondary">{t('providerModels.config.oauth.connecting')}</Text>
          </div>
        );

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
              <Button block disabled={!canManageProvider} type="primary" onClick={handleStartAuth}>
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
    };

    return (
      <div className={styles.card}>
        <div className={cx(styles.header, isAuthenticating && styles.divider)}>
          {title}
          <Flexbox horizontal align={'center'} gap={8}>
            {extra}
            {renderAction()}
          </Flexbox>
        </div>
        {isAuthenticating && renderAuthPanel()}
      </div>
    );
  },
);

OAuthDeviceFlowAuth.displayName = 'OAuthDeviceFlowAuth';

export default OAuthDeviceFlowAuth;
