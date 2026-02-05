'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CateTag from '@/app/[variants]/(main)/memory/features/CateTag';
import DetailLoading from '@/app/[variants]/(main)/memory/features/DetailLoading';
import DetailPanel from '@/app/[variants]/(main)/memory/features/DetailPanel';
import HashTags from '@/app/[variants]/(main)/memory/features/HashTags';
import HighlightedContent from '@/app/[variants]/(main)/memory/features/HighlightedContent';
import SourceLink from '@/app/[variants]/(main)/memory/features/SourceLink';
import Time from '@/app/[variants]/(main)/memory/features/Time';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

import ActivityDropdown from './ActivityDropdown';

const formatTime = (value?: Date | string | null) => {
  if (!value) return null;
  const time = dayjs(value);
  if (!time.isValid()) return null;
  return time.format('YYYY-MM-DD HH:mm');
};

const ActivityRightPanel = memo(() => {
  const { t } = useTranslation('memory');
  const [activityId] = useQueryState('activityId', { clearOnDefault: true });
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const { data: activity, isLoading } = useFetchMemoryDetail(activityId, LayersEnum.Activity);

  const schedule = useMemo(() => {
    if (!activity) return null;
    const start = formatTime(activity.startsAt);
    const end = formatTime(activity.endsAt);
    if (!start && !end) return null;
    if (start && end) return `${start} → ${end}`;
    return start || end;
  }, [activity]);

  if (!activityId) return null;

  let content;
  if (isLoading) content = <DetailLoading />;
  if (activity) {
    const capturedAt =
      activity.startsAt ||
      activity.capturedAt ||
      activity.updatedAt ||
      activity.createdAt ||
      undefined;

    content = (
      <>
        <CateTag cate={activity.type} />
        <Text
          as={'h1'}
          fontSize={20}
          weight={'bold'}
          style={{
            lineHeight: 1.4,
            marginBottom: 0,
          }}
        >
          {activity.title || t('activity.defaultType')}
        </Text>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          {activity.status && <Tag>{activity.status}</Tag>}
          <SourceLink source={activity.source} />
        </Flexbox>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <Time capturedAt={capturedAt} />
          {activity.timezone && (
            <Text fontSize={12} type="secondary">
              {activity.timezone}
            </Text>
          )}
        </Flexbox>

        {schedule && <HighlightedContent>{schedule}</HighlightedContent>}
        {activity.narrative && (
          <HighlightedContent title={t('activity.narrative')}>{activity.narrative}</HighlightedContent>
        )}
        {activity.notes && (
          <HighlightedContent title={t('activity.notes')}>{activity.notes}</HighlightedContent>
        )}
        {activity.feedback && (
          <HighlightedContent title={t('activity.feedback')}>{activity.feedback}</HighlightedContent>
        )}

        <HashTags hashTags={activity.tags} />
      </>
    );
  }

  return (
    <DetailPanel
      header={{
        right: activityId ? (
          <ActivityDropdown id={activityId} size={DESKTOP_HEADER_ICON_SIZE} />
        ) : undefined,
      }}
    >
      {content}
    </DetailPanel>
  );
});

export default ActivityRightPanel;
