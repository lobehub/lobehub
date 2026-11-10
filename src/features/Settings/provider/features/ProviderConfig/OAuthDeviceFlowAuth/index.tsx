'use client';

import { MAX_WIDTH } from '@lobechat/const';
import {
  Avatar,
  Button,
  confirmModal,
  CopyButton,
  cssVar,
  Flexbox,
  Icon,
  Modal,
  Spin,
  Text,
} from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheckIcon, LogOutIcon, UnplugIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { lambdaQuery } from '@/libs/trpc/client';
import { sx } from '@/styles/sx';

import { useOAuthDeviceFlow } from './useOAuthDeviceFlow';

// matches the borderless form below so both boxes end on the same edge
const cardWidth = { maxWidth: MAX_WIDTH };

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: sxVar.colorBorderSecondary,
    borderRadius: '12px',
  },
  codeBox: {
    display: 'flex',
    flex: '1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '16px',
    paddingInline: '24px',
    borderRadius: '12px',
    fontFamily: 'monospace',
    fontSize: '28px',
    fontWeight: 600,
    letterSpacing: '6px',
    backgroundColor: sxVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
    paddingBlockStart: '8px',
    paddingBlockEnd: '4px',
  },
  errorText: {
    color: sxVar.colorError,
  },
  header: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '12px',
    paddingInline: '16px',
  },
  // Prose, so it reads from the left edge rather than being centred with the
  // code box below it.
  hint: {
    width: '100%',
    fontSize: '13px',
    lineHeight: 1.6,
    color: sxVar.colorTextSecondary,
    textAlign: 'start',
  },
  pollingHint: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderRadius: '8px',
    fontSize: '13px',
    color: sxVar.colorTextSecondary,
    backgroundColor: sxVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  successBadge: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '13px',
    color: sxVar.colorSuccess,
  },
  username: {
    fontSize: '13px',
    color: sxVar.colorTextSecondary,
  },
});

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
                <span {...stylex.props(styles.username)}>{username}</span>
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
          <div {...stylex.props(styles.content)}>
            <Spin size="middle" />
            <Text as={'span'} type={'secondary'}>
              {t('providerModels.config.oauth.connecting')}
            </Text>
          </div>
        );

      // Error state
      if (state === 'error' && error) {
        const errorKey = `providerModels.config.oauth.${error}`;
        return (
          <div {...stylex.props(styles.content)}>
            <Flexbox horizontal align="center" gap={8}>
              <Icon color={cssVar.colorError} icon={UnplugIcon} size={20} />
              <Text as={'span'} className={stylex.props(styles.errorText).className}>
                {t(errorKey as any)}
              </Text>
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
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.hint)}>
            {t('providerModels.config.oauth.enterCode')}{' '}
            <a href={deviceCodeInfo.verificationUri} rel="noopener noreferrer" target="_blank">
              {deviceCodeInfo.verificationUri}
            </a>
          </div>

          <Flexbox horizontal align="center" gap={12} style={{ width: '100%' }}>
            <div {...stylex.props(styles.codeBox)}>{deviceCodeInfo.userCode}</div>
            <CopyButton content={deviceCodeInfo.userCode} />
          </Flexbox>

          <div {...stylex.props(styles.pollingHint)}>
            <Spin size="small" />
            <span>{t('providerModels.config.oauth.polling')}</span>
          </div>
        </div>
      );
    };

    return (
      <>
        <div {...sx(styles.card, cardWidth)}>
          <div {...stylex.props(styles.header)}>
            {/* The badge is a property of the provider, not an action on it, so
                it sits with the name rather than among the controls. */}
            <Flexbox horizontal align={'center'} gap={8}>
              {title}
              {enabled && isAuthenticated && (
                <div {...stylex.props(styles.successBadge)}>
                  <Icon icon={CircleCheckIcon} />
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
