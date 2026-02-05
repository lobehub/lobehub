'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import urlJoin from 'url-join';

import { marketApiService } from '@/services/marketApi';

import { useDetailContext } from './DetailProvider';

/**
 * Agent Fork Tag Component
 * Displays fork source information if the agent is forked from another agent
 */
const AgentForkTag = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();
  const { identifier, forkedFromAgentId } = useDetailContext();

  console.log('forkedFromAgentId', forkedFromAgentId);

  // Fetch fork source info
  const { data: forkSource } = useSWR(
    identifier && forkedFromAgentId ? ['fork-source', identifier] : null,
    () => marketApiService.getAgentForkSource(identifier!),
    { revalidateOnFocus: false },
  );

  if (!forkSource?.source) return null;

  const handleClick = () => {
    if (forkSource?.source?.identifier) {
      navigate(urlJoin('/community/agent', forkSource.source.identifier));
    }
  };

  return (
    <Tag
      bordered={false}
      color="default"
      icon={<Icon icon={GitFork} />}
      style={{ cursor: 'pointer' }}
      title={t('fork.forkedFrom', {
        defaultValue: `Forked from ${forkSource.source.name}`,
      })}
      onClick={handleClick}
    >
      {t('fork.forkedFrom')}: {forkSource.source.name}
    </Tag>
  );
});

AgentForkTag.displayName = 'AgentForkTag';

export default AgentForkTag;
