'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { MAX_WIDTH } from '@lobechat/const';
import { CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Button, confirmModal, Modal } from '@lobehub/ui/base-ui';
import { Typography } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon, LogOutIcon, UnplugIcon } from 'lucide-react';
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

    padding-block: 8px 4px;
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
  // Prose, so it reads from the left edge rather than being centred with the
  // code box below it.
  hint: css`
    width: 100%;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    text-align: start;
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
      // Retry re-enters from the dialog's error state, where isAuthenticating
      // is still true — so only a genuinely in-flight attempt blocks a restart.
      if (isAuthenticating && state !== 'error') return;

      setIsAuthenticating(true);
      const info = await startAuth();

      // Auto-open the verification page right away — the Connect click still
      // counts as transient user activation, so popup blockers normally allow
      // it. The manual "open browser" button stays as a fallback when blocked.
      const uri = info?.verificationUriComplete || info?.verificationUri;
      if (uri) window.open(uri, '_blank');
    }, [canManageProvider, isAuthenticating, startAuth, state]);

    const handleCancelAuth = useCallback(() => {
      setIsAuthenticating(false);
      cancelAuth();
    }, [cancelAuth]);

    // The inline action that trails the enable switch in the header row. The
    // device-code flow runs in a dialog, so the button stays put and spins
    // rather than being swapped out while pairing is in flight.
    const renderAction = () => {
      if (!enabled) return null;

      if (isAuthenticated)
        return (
          <>
            {username && (
              <Flexbox horizontal align={'center'} gap={6}>
                {avatarUrl && <Avatar avatar={avatarUrl} size={20} title={username} />}
                <span className={styles.username}>{username}</span>
              </Flexbox>
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
          loading={isAuthenticating}
          size={'small'}
          type={'primary'}
          onClick={handleStartAuth}
        >
          {t('providerModels.config.oauth.connect')}
        </Button>
      );
    };

    // Dialog body for the device-code flow. The dialog itself owns dismissal,
    // so only the error branch needs an explicit way out.
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
            <Flexbox gap={12} style={{ width: '100%' }}>
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

      // Device code display. The authorization page is opened for the user on
      // Connect, so the link is the fallback for when a popup blocker ate it —
      // and the only route when authorizing on a second device.
      return (
        <div className={styles.content}>
          <div className={styles.hint}>
            {t('providerModels.config.oauth.enterCode')}{' '}
            <Link href={deviceCodeInfo.verificationUri} target="_blank">
              {deviceCodeInfo.verificationUri}
            </Link>
          </div>

          <Flexbox horizontal align="center" gap={12} style={{ width: '100%' }}>
            <div className={styles.codeBox}>{deviceCodeInfo.userCode}</div>
            <CopyButton content={deviceCodeInfo.userCode} />
          </Flexbox>

          <div className={styles.pollingHint}>
            <Icon spin icon={Loader2Icon} />
            <span>{t('providerModels.config.oauth.polling')}</span>
          </div>
        </div>
      );
    };

    return (
      <>
        <div className={styles.card}>
          <div className={styles.header}>
            {/* The badge is a property of the provider, not an action on it, so
                it sits with the name rather than among the controls. */}
            <Flexbox horizontal align={'center'} gap={8}>
              {title}
              {enabled && isAuthenticated && (
                <div className={styles.successBadge}>
                  <CheckCircleFilled />
                  <span>{t('providerModels.config.oauth.connected')}</span>
                </div>
              )}
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={8}>
              {extra}
              {renderAction()}
            </Flexbox>
          </div>
        </div>
        {/* Dismissing the dialog abandons the pairing, which is what a user
            closing it means — the code is dead once we stop polling for it. */}
        <Modal
          centered
          destroyOnHidden
          footer={null}
          open={isAuthenticating}
          title={t('providerModels.config.oauth.title')}
          width={420}
          onCancel={handleCancelAuth}
        >
          {renderAuthPanel()}
        </Modal>
      </>
    );
  },
);

OAuthDeviceFlowAuth.displayName = 'OAuthDeviceFlowAuth';

export default OAuthDeviceFlowAuth;
