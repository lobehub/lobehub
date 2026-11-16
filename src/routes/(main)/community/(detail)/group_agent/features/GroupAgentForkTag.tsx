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
 * Group Agent Fork Tag Component
 * Displays fork source information if the group agent is forked from another group agent
 */
const GroupAgentForkTag = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const { identifier, forkedFromGroupId } = useDetailContext();

  const useAgentGroupForkSource = useDiscoverStore((s) => s.useAgentGroupForkSource);
  const { queryKey } = useAgentGroupForkSource(identifier, !!forkedFromGroupId);
  const source = useDiscoverStore(marketSelectors.agentGroupForkSource(queryKey));

  if (!source) return null;

  const handleClick = () => {
    if (source?.identifier) {
      navigate(urlJoin('/community/group_agent', source.identifier));
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

GroupAgentForkTag.displayName = 'GroupAgentForkTag';

export default GroupAgentForkTag;
