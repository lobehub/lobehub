'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

/**
 * Agent Fork Tag Component
 * Displays fork source information if the agent is forked from another agent
 */
const AgentForkTag = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const marketIdentifier = meta?.marketIdentifier;

  // The fork marker comes from the header's shared Market status read; the
  // fork source is only asked for once the agent is known to be a fork.
  const useMarketAgentStatus = useDiscoverStore((s) => s.useMarketAgentStatus);
  const { queryKey: statusKey } = useMarketAgentStatus(marketIdentifier);
  const isFork = !!useDiscoverStore(marketSelectors.agentStatus(statusKey))?.forkedFromAgentId;
  const useAgentForkSource = useDiscoverStore((s) => s.useAgentForkSource);
  const { queryKey } = useAgentForkSource(marketIdentifier, isFork);
  const forkSource = useDiscoverStore(marketSelectors.agentForkSource(queryKey));

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
