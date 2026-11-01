'use client';

import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';

import ActivityDetail from './ActivityDetail';
import ActivityDropdown from './ActivityDropdown';

const ActivityRightPanel = memo(() => {
  const [activityId] = useQueryState('activityId', { clearOnDefault: true });

  if (!activityId) return null;

  return (
    <DetailPanel
      header={{
        right: <ActivityDropdown id={activityId} size={DESKTOP_HEADER_ICON_SIZE} />,
      }}
    >
      <ActivityDetail id={activityId} />
    </DetailPanel>
  );
});

export default ActivityRightPanel;
