'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

import { useDetailContext } from './DetailProvider';

/**
 * Agent Fork Tag Component
 * Displays fork source information if the agent is forked from another agent
 */
const AgentForkTag = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const { identifier, forkedFromAgentId } = useDetailContext();

  const useAgentForkSource = useDiscoverStore((s) => s.useAgentForkSource);
  const { queryKey } = useAgentForkSource(identifier, !!forkedFromAgentId);
  const source = useDiscoverStore(marketSelectors.agentForkSource(queryKey));

  if (!source) return null;

  const handleClick = () => {
    if (source?.identifier) {
      navigate(urlJoin('/community/agent', source.identifier));
    }
  };

  return (
    <Tag
      color="default"
      icon={<Icon icon={GitFork} />}
      style={{ cursor: 'pointer' }}
      title={t('fork.forkedFrom', {
        defaultValue: `Forked from ${source.name}`,
      })}
      onClick={handleClick}
    >
      {t('fork.forkedFrom')}: {source.name}
    </Tag>
  );
});

AgentForkTag.displayName = 'AgentForkTag';

export default AgentForkTag;
