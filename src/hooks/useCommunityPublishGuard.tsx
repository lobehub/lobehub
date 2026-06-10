import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import { message } from '@/components/AntdStaticMethods';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * Guards Community publishing inside a workspace. A workspace can only publish
 * to the Community after its owner has set up the workspace's Community
 * organization identity. Returns a checker that surfaces an actionable prompt
 * and returns `false` when setup is still required.
 *
 * Outside a workspace (`isWorkspaceScope` is false) the checker is always a
 * no-op that returns `true`, so open-source builds are unaffected.
 */
export const useCommunityPublishGuard = () => {
  const { t } = useTranslation('setting');
  const { modal } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const { canEdit, isLoading, isWorkspaceScope, profile } = useCommunityWorkspaceProfile();

  return useCallback((): boolean => {
    // Not in a workspace, still loading, or the org identity already exists.
    if (!isWorkspaceScope || isLoading || profile) return true;

    if (canEdit) {
      modal.confirm({
        centered: true,
        content: t('marketPublish.validation.communitySetupRequired.desc'),
        okButtonProps: { type: 'primary' },
        okText: t('marketPublish.validation.communitySetupRequired.action'),
        onOk: () => navigate('/community/workspace'),
        title: t('marketPublish.validation.communitySetupRequired.title'),
      });
    } else {
      message.warning(t('marketPublish.validation.communitySetupRequired.memberHint'));
    }

    return false;
  }, [canEdit, isLoading, isWorkspaceScope, profile, modal, navigate, t]);
};
