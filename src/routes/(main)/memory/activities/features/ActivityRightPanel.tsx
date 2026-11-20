'use client';

import { memo } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';
import { useHeaderActionSize } from '@/styles/density';

import ActivityDetail from './ActivityDetail';
import ActivityDropdown from './ActivityDropdown';

const ActivityRightPanel = memo(() => {
  const [activityId] = useQueryState('activityId', { clearOnDefault: true });
  const headerActionSize = useHeaderActionSize();

  if (!activityId) return null;

  return (
    <DetailPanel
      header={{
        right: <ActivityDropdown id={activityId} size={headerActionSize} />,
      }}
    >
      <ActivityDetail id={activityId} />
    </DetailPanel>
  );
});

export default ActivityRightPanel;
