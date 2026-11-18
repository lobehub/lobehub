'use client';

import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentStatusTag from './AgentStatusTag';
import { useAgentMarketTags } from './useAgentMarketTags';

/**
 * Agent Version Review Tag Component
 * Displays "Under Review" tag when the latest version is not validated
 */
const AgentVersionReviewTag = memo(({ submitted = false }: { submitted?: boolean }) => {
  const { t } = useTranslation('setting');
  const { isUnderReview: showReviewTag } = useAgentMarketTags();

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
