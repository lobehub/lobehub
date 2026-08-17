'use client';

import { ActionIcon } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useAccessLevelOptions } from '@/features/ResourcePermission/useAccessLevelOptions';
import { useResourcePermission } from '@/features/ResourcePermission/useResourcePermission';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface KnowledgeBasePermissionActionProps {
  knowledgeBaseId: string;
}

const KnowledgeBasePermissionAction = memo<KnowledgeBasePermissionActionProps>(
  ({ knowledgeBaseId }) => {
    const { t } = useTranslation('setting');
    const hasActiveWorkspace = useHasActiveWorkspace();
    const navigate = useWorkspaceAwareNavigate();
    const { data } = useResourcePermission(
      'knowledgeBase',
      hasActiveWorkspace ? knowledgeBaseId : undefined,
    );
    const accessOptions = useAccessLevelOptions({
      accessLevel: data?.accessLevel,
      isPrivate: data?.visibility === 'private',
      resourceType: 'knowledgeBase',
    });
    const activeOption = accessOptions.find(({ value }) => value === data?.accessLevel);

    if (!data?.canManage || !activeOption) return null;

    const title = t('permission.generalAccess.trigger', { level: activeOption.label });

    return (
      <ActionIcon
        aria-label={title}
        icon={LockIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={title}
        onClick={() => navigate(`/resource/library/${knowledgeBaseId}/permission`)}
      />
    );
  },
);

KnowledgeBasePermissionAction.displayName = 'KnowledgeBasePermissionAction';

export default KnowledgeBasePermissionAction;
