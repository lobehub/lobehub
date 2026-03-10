import { ActionIcon } from '@lobehub/ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { checkOwnership } from '@/hooks/useAgentOwnershipCheck';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { resolveMarketAuthError } from '@/layout/AuthProvider/MarketAuth/errors';
import { useServerConfigStore } from '@/store/serverConfig';

import { type MarketPublishAction } from './types';
import { useMarketPublish } from './useMarketPublish';

interface MarketPublishButtonProps {
  action: MarketPublishAction;
  marketIdentifier?: string;
  onPublishSuccess?: (identifier: string) => void;
}

const PublishButton = memo<MarketPublishButtonProps>(
  ({ action, marketIdentifier, onPublishSuccess }) => {
    const { t } = useTranslation(['setting', 'marketAuth']);

    const mobile = useServerConfigStore((s) => s.isMobile);

    const { isAuthenticated, isLoading, session, signIn } = useMarketAuth();
    const { isPublishing, publish } = useMarketPublish({
      action,
      onSuccess: onPublishSuccess,
    });

    const buttonConfig = useMemo(() => {
      if (action === 'upload') {
        return {
          authSuccessMessage: t('messages.success.upload', { ns: 'marketAuth' }),
          authenticated: t('marketPublish.upload.tooltip'),
          unauthenticated: t('marketPublish.upload.tooltip'),
        } as const;
      }

      const submitText = t('submitAgentModal.tooltips');

      return {
        authSuccessMessage: t('messages.success.submit', { ns: 'marketAuth' }),
        authenticated: submitText,
        unauthenticated: t('marketPublish.submit.tooltip'),
      } as const;
    }, [action, t]);

    const handleButtonClick = useCallback(async () => {
      if (!isAuthenticated) {
        try {
          message.loading({
            content: t('messages.loading', { ns: 'marketAuth' }),
            key: 'market-auth',
          });
          const accountId = await signIn();
          message.success({ content: buttonConfig.authSuccessMessage, key: 'market-auth' });

          // Check ownership after authentication if marketIdentifier exists
          if (marketIdentifier && accountId !== null) {
            let accessToken = session?.accessToken;

            if (!accessToken && typeof window !== 'undefined') {
              const storedSession = sessionStorage.getItem('market_auth_session');
              if (storedSession) {
                try {
                  const parsed = JSON.parse(storedSession) as { accessToken?: string };
                  accessToken = parsed.accessToken;
                } catch (parseError) {
                  console.error(
                    '[MarketPublishButton] Failed to parse stored session:',
                    parseError,
                  );
                }
              }
            }

            if (accessToken) {
              try {
                const isOwner = await checkOwnership({
                  accessToken,
                  accountId,
                  marketIdentifier,
                  skipCache: true,
                });

                // If user is not the owner and trying to upload, just return
                // The parent component should handle the action switch
                if (!isOwner && action === 'upload') {
                  return;
                }
              } catch (ownershipError) {
                console.error('[MarketPublishButton] Failed to confirm ownership:', ownershipError);
              }
            }
          }

          // After authentication, proceed with publish
          await publish();
        } catch (error) {
          console.error(`[MarketPublishButton][${action}] Authorization failed:`, error);
          const normalizedError = resolveMarketAuthError(error);
          message.error({
            content: t(`errors.${normalizedError.code}`, { ns: 'marketAuth' }),
            key: 'market-auth',
          });
        }
        return;
      }

      // User is authenticated, directly publish
      await publish();
    }, [
      action,
      buttonConfig.authSuccessMessage,
      isAuthenticated,
      marketIdentifier,
      publish,
      session?.accessToken,
      signIn,
      t,
    ]);

    const buttonTitle = isAuthenticated ? buttonConfig.authenticated : buttonConfig.unauthenticated;
    const loading = isLoading || isPublishing;

    return (
      <ActionIcon
        icon={ShapesUploadIcon}
        loading={loading}
        size={HEADER_ICON_SIZE(mobile)}
        title={buttonTitle}
        onClick={handleButtonClick}
      />
    );
  },
);

PublishButton.displayName = 'MarketPublishButton';

export default PublishButton;
