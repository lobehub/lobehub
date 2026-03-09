import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import { Modal } from 'antd';
import isEqual from 'fast-deep-equal';
import { BotMessageSquareIcon, MoreHorizontal, Settings2Icon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { resolveMarketAuthError } from '@/layout/AuthProvider/MarketAuth/errors';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import AgentForkTag from './AgentForkTag';
import ForkConfirmModal from './AgentPublishButton/ForkConfirmModal';
import PublishResultModal from './AgentPublishButton/PublishResultModal';
import { type OriginalAgentInfo, useMarketPublish } from './AgentPublishButton/useMarketPublish';
import AgentStatusTag from './AgentStatusTag';
import { useVersionReviewStatus } from './AgentVersionReviewTag';
import AgentVersionReviewTag from './AgentVersionReviewTag';
import AutoSaveHint from './AutoSaveHint';

const Header = memo(() => {
  const { t } = useTranslation(['setting', 'marketAuth']);

  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
  const { isAuthenticated, isLoading: isAuthLoading, signIn } = useMarketAuth();
  const { isUnderReview } = useVersionReviewStatus();

  const action = meta?.marketIdentifier ? 'upload' : 'submit';

  const [showResultModal, setShowResultModal] = useState(false);
  const [publishedIdentifier, setPublishedIdentifier] = useState<string>();
  const [showForkModal, setShowForkModal] = useState(false);
  const [originalAgentInfo, setOriginalAgentInfo] = useState<OriginalAgentInfo | null>(null);

  const handlePublishSuccess = useCallback((identifier: string) => {
    setPublishedIdentifier(identifier);
    setShowResultModal(true);
  }, []);

  const { checkOwnership, isPublishing, publish } = useMarketPublish({
    action,
    onSuccess: handlePublishSuccess,
  });

  const doPublish = useCallback(async () => {
    const { needsForkConfirm, originalAgent } = await checkOwnership();
    if (needsForkConfirm && originalAgent) {
      setOriginalAgentInfo(originalAgent);
      setShowForkModal(true);
      return;
    }
    await publish();
  }, [checkOwnership, publish]);

  const handlePublishClick = useCallback(async () => {
    if (isUnderReview) {
      message.warning({
        content: t('marketPublish.validation.underReview', {
          defaultValue:
            'Your new version is currently under review. Please wait for approval before publishing a new version.',
          ns: 'setting',
        }),
      });
      return;
    }

    if (!meta?.title || meta.title.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptyName', { ns: 'setting' }) });
      return;
    }

    if (!systemRole || systemRole.trim() === '') {
      message.error({
        content: t('marketPublish.validation.emptySystemRole', { ns: 'setting' }),
      });
      return;
    }

    Modal.confirm({
      okButtonProps: { type: 'primary' },
      onOk: async () => {
        if (!isAuthenticated) {
          try {
            await signIn();
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
        await doPublish();
      },
      title: t('marketPublish.validation.confirmPublish', { ns: 'setting' }),
    });
  }, [action, doPublish, isAuthenticated, isUnderReview, meta?.title, signIn, systemRole, t]);

  const handleForkConfirm = useCallback(async () => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
    await publish();
  }, [publish]);

  const menuItems = useMemo(
    () => [
      {
        icon: <Icon icon={Settings2Icon} />,
        key: 'advanced-settings',
        label: t('advancedSettings', { ns: 'setting' }),
        onClick: () => useAgentStore.setState({ showAgentSetting: true }),
      },
      { type: 'divider' as const },
      {
        icon: <Icon icon={ShapesUploadIcon} />,
        key: 'publish',
        label: t('publishToCommunity', { ns: 'setting' }),
        onClick: handlePublishClick,
      },
    ],
    [handlePublishClick, t],
  );

  return (
    <>
      <NavHeader
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            <DropdownMenu items={menuItems}>
              <ActionIcon
                icon={MoreHorizontal}
                loading={isPublishing || isAuthLoading}
                size={DESKTOP_HEADER_ICON_SIZE}
              />
            </DropdownMenu>
            <ToggleRightPanelButton icon={BotMessageSquareIcon} showActive={true} />
          </Flexbox>
        }
        left={
          <Flexbox horizontal gap={8}>
            <AutoSaveHint />
            <AgentStatusTag />
            <AgentVersionReviewTag />
            <AgentForkTag />
          </Flexbox>
        }
      />
      <ForkConfirmModal
        loading={isPublishing}
        open={showForkModal}
        originalAgent={originalAgentInfo}
        onCancel={() => {
          setShowForkModal(false);
          setOriginalAgentInfo(null);
        }}
        onConfirm={handleForkConfirm}
      />
      <PublishResultModal
        identifier={publishedIdentifier}
        open={showResultModal}
        onCancel={() => setShowResultModal(false)}
      />
    </>
  );
});

export default Header;
