import { Button } from '@lobehub/ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import { Popconfirm } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { resolveMarketAuthError } from '@/layout/AuthProvider/MarketAuth/errors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { useGroupVersionReviewStatus } from '../../GroupProfile/GroupVersionReviewTag';
import GroupForkConfirmModal from './GroupForkConfirmModal';
import { type MarketPublishAction, type OriginalGroupInfo } from './types';
import { useMarketGroupPublish } from './useMarketGroupPublish';

interface GroupPublishButtonProps {
  action: MarketPublishAction;
  onPublishSuccess?: (identifier: string) => void;
}

const PublishButton = memo<GroupPublishButtonProps>(({ action, onPublishSuccess }) => {
  const { t } = useTranslation(['setting', 'marketAuth']);

  const { isAuthenticated, isLoading, signIn } = useMarketAuth();
  const { checkOwnership, isCheckingOwnership, isPublishing, publish } = useMarketGroupPublish({
    action,
    onSuccess: onPublishSuccess,
  });

  // Check if the latest version is under review
  const { isUnderReview } = useGroupVersionReviewStatus();

  // Group data for validation
  const currentGroupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta, isEqual);
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);

  // Fork confirmation modal state
  const [showForkModal, setShowForkModal] = useState(false);
  const [originalGroupInfo, setOriginalGroupInfo] = useState<OriginalGroupInfo | null>(null);

  // Publish confirmation popconfirm state
  const [confirmOpened, setConfirmOpened] = useState(false);

  const buttonConfig = useMemo(() => {
    if (action === 'upload') {
      return {
        authenticated: t('marketPublish.uploadGroup.tooltip'),
        unauthenticated: t('marketPublish.uploadGroup.tooltip'),
      } as const;
    }

    const submitText = t('submitGroupModal.tooltips');

    return {
      authenticated: submitText,
      unauthenticated: t('marketPublish.submitGroup.tooltip'),
    } as const;
  }, [action, t]);

  const doPublish = useCallback(async () => {
    // Check ownership before publishing
    const { needsForkConfirm, originalGroup } = await checkOwnership();

    if (needsForkConfirm && originalGroup) {
      // Show fork confirmation modal
      setOriginalGroupInfo(originalGroup);
      setShowForkModal(true);
      return;
    }

    // No confirmation needed, proceed with publish
    await publish();
  }, [checkOwnership, publish]);

  const handleButtonClick = useCallback(() => {
    // Check if the latest version is under review
    if (isUnderReview) {
      message.warning({
        content: t('marketPublish.validation.underReview', {
          defaultValue:
            'Your new version is currently under review. Please wait for the review to complete before publishing a new version.',
        }),
      });
      return;
    }

    // Validate name and systemRole (stored in content)
    if (!currentGroupMeta?.title || currentGroupMeta.title.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptyName') });
      return;
    }

    if (!currentGroup?.content || currentGroup.content.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptySystemRole') });
      return;
    }

    // Open popconfirm for user confirmation
    setConfirmOpened(true);
  }, [currentGroupMeta?.title, currentGroup?.content, isUnderReview, t]);

  const handleConfirmPublish = useCallback(async () => {
    setConfirmOpened(false);

    if (!isAuthenticated) {
      try {
        await signIn();
        // After authentication, proceed with ownership check and publish
        await doPublish();
      } catch (error) {
        console.error(`[GroupPublishButton][${action}] Authorization failed:`, error);
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
    setOriginalGroupInfo(null);
    // User confirmed, proceed with publish
    await publish();
  }, [publish]);

  const handleForkCancel = useCallback(() => {
    setShowForkModal(false);
    setOriginalGroupInfo(null);
  }, []);

  const buttonTitle = isAuthenticated ? buttonConfig.authenticated : buttonConfig.unauthenticated;
  const loading = isLoading || isCheckingOwnership || isPublishing;

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
      <GroupForkConfirmModal
        loading={isPublishing}
        onCancel={handleForkCancel}
        onConfirm={handleForkConfirm}
        open={showForkModal}
        originalGroup={originalGroupInfo}
      />
    </>
  );
});

PublishButton.displayName = 'GroupPublishButton';

export default PublishButton;
