'use client';

import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

import AgentStatusTag from './AgentStatusTag';

/**
 * Agent Version Review Tag Component
 * Displays "Under Review" tag when the latest version is not validated
 */
const AgentVersionReviewTag = memo(({ submitted = false }: { submitted?: boolean }) => {
  const { t } = useTranslation('setting');
  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const useMarketAgentStatus = useDiscoverStore((s) => s.useMarketAgentStatus);
  const { queryKey } = useMarketAgentStatus(meta?.marketIdentifier);
  const showReviewTag = !!useDiscoverStore(marketSelectors.agentStatus(queryKey))
    ?.latestVersionUnderReview;

  // A successful submission is authoritative even when the detail endpoint
  // omits pending versions. Do not infer review status from "unpublished" alone.
  if (!submitted && !showReviewTag) return <AgentStatusTag />;

  return (
    <Tag color="orange" style={{ marginRight: 8 }}>
      {t('marketPublish.status.underReview', { defaultValue: 'Under Review' })}
    </Tag>
  );
});

AgentVersionReviewTag.displayName = 'AgentVersionReviewTag';

export default AgentVersionReviewTag;
