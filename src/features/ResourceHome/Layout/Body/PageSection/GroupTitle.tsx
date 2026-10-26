'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTimeGroupId } from '@/features/AgentSidebar/Topic/TopicListContent/ByTimeMode/timeGroupTitle';

/** Label above one group of section rows: a time bucket, or Pages / Artifacts. */
const GroupTitle = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation(['file', 'topic']);

  const label =
    id === 'page' || id === 'artifact'
      ? t(`docs.sectionView.type.${id}`)
      : (formatTimeGroupId(id) ?? t(`groupTitle.byTime.${id}` as any, { ns: 'topic' }));

  return (
    <Text
      ellipsis
      fontSize={12}
      style={{ paddingBlock: '8px 2px', paddingInline: 8 }}
      type={'secondary'}
    >
      {label}
    </Text>
  );
});

GroupTitle.displayName = 'PageSectionGroupTitle';

export default GroupTitle;
