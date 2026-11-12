'use client';

import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupMarketTags } from './useGroupMarketTags';

/**
 * Group Version Review Tag Component
 * Displays "Under Review" tag when the latest version is not validated
 */
const GroupVersionReviewTag = memo(() => {
  const { t } = useTranslation('setting');
  const { isUnderReview: showReviewTag } = useGroupMarketTags();

  if (!showReviewTag) return null;

  return (
    <Tag color="orange">
      {t('marketPublish.status.underReview', { defaultValue: 'Under Review' })}
    </Tag>
  );
});

GroupVersionReviewTag.displayName = 'GroupVersionReviewTag';

export default GroupVersionReviewTag;
