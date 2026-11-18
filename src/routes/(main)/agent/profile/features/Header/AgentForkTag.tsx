'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useAgentMarketTags } from './useAgentMarketTags';

/**
 * Agent Fork Tag Component
 * Displays fork source information if the agent is forked from another agent
 */
const AgentForkTag = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const { forkSource } = useAgentMarketTags();

  if (!forkSource) return null;

  const handleClick = () => {
    if (forkSource?.identifier) {
      navigate(`/community/agent/${forkSource.identifier}`);
    }
  };

  return (
    <Tag
      color="default"
      icon={<Icon icon={GitFork} />}
      style={{ cursor: 'pointer', marginRight: 8 }}
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

AgentForkTag.displayName = 'AgentForkTag';

export default AgentForkTag;
