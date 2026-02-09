import { Button } from '@lobehub/ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import { Popconfirm } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { resolveMarketAuthError } from '@/layout/AuthProvider/MarketAuth/errors';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useVersionReviewStatus } from '../AgentVersionReviewTag';
import ForkConfirmModal from './ForkConfirmModal';
import type { MarketPublishAction } from './types';
import { type OriginalAgentInfo, useMarketPublish } from './useMarketPublish';

interface MarketPublishButtonProps {
  action: MarketPublishAction;
  onPublishSuccess?: (identifier: string) => void;
}

const PublishButton = memo<MarketPublishButtonProps>(({ action, onPublishSuccess }) => {
  const { t } = useTranslation(['setting', 'marketAuth']);

  const { isAuthenticated, isLoading, signIn } = useMarketAuth();
  const { checkOwnership, isCheckingOwnership, isPublishing, publish } = useMarketPublish({
    action,
    onSuccess: onPublishSuccess,
  });

  // Check if latest version is under review
  const { isUnderReview, loading: reviewStatusLoading } = useVersionReviewStatus();

  // Agent data for validation
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);

  // Fork confirmation modal state
  const [showForkModal, setShowForkModal] = useState(false);
  const [originalAgentInfo, setOriginalAgentInfo] = useState<OriginalAgentInfo | null>(null);

  // Publish confirmation popconfirm state
  const [confirmOpened, setConfirmOpened] = useState(false);

  const buttonConfig = useMemo(() => {
    if (action === 'upload') {
      return {
        authenticated: t('marketPublish.upload.tooltip'),
        unauthenticated: t('marketPublish.upload.tooltip'),
      } as const;
    }

    const submitText = t('submitAgentModal.tooltips');

    return {
      authenticated: submitText,
      unauthenticated: t('marketPublish.submit.tooltip'),
    } as const;
  }, [action, t]);

  const doPublish = useCallback(async () => {
    // Check ownership before publishing
    const { needsForkConfirm, originalAgent } = await checkOwnership();

    if (needsForkConfirm && originalAgent) {
      // Show fork confirmation modal
      setOriginalAgentInfo(originalAgent);
      setShowForkModal(true);
      return;
    }

    // No confirmation needed, proceed with publish
    await publish();
  }, [checkOwnership, publish]);

  const handleButtonClick = useCallback(() => {
    // Check if version is under review
    if (isUnderReview) {
      message.warning({
        content: t('marketPublish.validation.underReview', {
          defaultValue: 'Your new version is currently under review. Please wait for approval before publishing a new version.',
        }),
      });
      return;
    }

    // Validate name and systemRole
    if (!meta?.title || meta.title.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptyName') });
      return;
    }

    if (!systemRole || systemRole.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptySystemRole') });
      return;
    }

    // Open popconfirm for user confirmation
    setConfirmOpened(true);
  }, [isUnderReview, meta?.title, systemRole, t]);

  const handleConfirmPublish = useCallback(async () => {
    setConfirmOpened(false);

    if (!isAuthenticated) {
      try {
        await signIn();
        // After authentication, proceed with ownership check and publish
        await doPublish();
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

    // User is authenticated, check ownership and publish
    await doPublish();
  }, [action, doPublish, isAuthenticated, signIn, t]);

  const handleForkConfirm = useCallback(async () => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
    // User confirmed, proceed with publish
    await publish();
  }, [publish]);

  const handleForkCancel = useCallback(() => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
  }, []);

  const buttonTitle = isAuthenticated ? buttonConfig.authenticated : buttonConfig.unauthenticated;
  const loading = isLoading || isCheckingOwnership || isPublishing || reviewStatusLoading;

  return (
    <>
      <Popconfirm
        arrow={false}
        okButtonProps={{ type: 'primary' }}
        onCancel={() => setConfirmOpened(false)}
        onConfirm={handleConfirmPublish}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmOpened(false);
          }
        }}
        open={confirmOpened}
        placement="bottomRight"
        title={t('marketPublish.validation.confirmPublish')}
      >
        <Button
          icon={ShapesUploadIcon}
          loading={loading}
          onClick={handleButtonClick}
          title={buttonTitle}
        >
          {t('publishToCommunity')}
        </Button>
      </Popconfirm>
      <ForkConfirmModal
        loading={isPublishing}
        onCancel={handleForkCancel}
        onConfirm={handleForkConfirm}
        open={showForkModal}
        originalAgent={originalAgentInfo}
      />
    </>
  );
});

PublishButton.displayName = 'MarketPublishButton';

export default PublishButton;
