'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useGroupMarketTags } from './useGroupMarketTags';

/**
 * Group Fork Tag Component
 * Displays fork source information if the group is forked from another group
 */
const GroupForkTag = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const { forkSource } = useGroupMarketTags();

  if (!forkSource) return null;

  const handleClick = () => {
    if (forkSource?.identifier) {
      navigate(`/community/group_agent/${forkSource.identifier}`);
    }
  };

  return (
    <Tag
      color="default"
      icon={<Icon icon={GitFork} />}
      style={{ cursor: 'pointer' }}
      title={t('marketPublish.forkFrom.tooltip', {
        agent: forkSource.name,
        defaultValue: `Forked from ${forkSource.name}`,
      })}
      onClick={handleClick}
    >
      {t('marketPublish.forkFrom.label', { defaultValue: 'Forked from' })} {forkSource.name}
    </Tag>
  );
});

GroupForkTag.displayName = 'GroupForkTag';

export default GroupForkTag;
