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
 * Group Agent Fork Tag Component
 * Displays fork source information if the group agent is forked from another group agent
 */
const GroupAgentForkTag = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();
  const { identifier, forkedFromGroupId } = useDetailContext();

  // Fetch fork source info
  const { data: forkSource } = useSWR(
    identifier && forkedFromGroupId ? ['group-fork-source', identifier] : null,
    () => marketApiService.getAgentGroupForkSource(identifier!),
    { revalidateOnFocus: false },
  );

  if (!forkSource?.source) return null;

  const handleClick = () => {
    if (forkSource?.source?.identifier) {
      navigate(urlJoin('/community/group_agent', forkSource.source.identifier));
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

GroupAgentForkTag.displayName = 'GroupAgentForkTag';

export default GroupAgentForkTag;
