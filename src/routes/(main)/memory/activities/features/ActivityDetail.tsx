'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import CateTag from '@/routes/(main)/memory/features/CateTag';
import DetailLoading from '@/routes/(main)/memory/features/DetailLoading';
import DetailNotFound from '@/routes/(main)/memory/features/DetailNotFound';
import HashTags from '@/routes/(main)/memory/features/HashTags';
import HighlightedContent from '@/routes/(main)/memory/features/HighlightedContent';
import SourceLink from '@/routes/(main)/memory/features/SourceLink';
import Time from '@/routes/(main)/memory/features/Time';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

const formatTime = (value?: Date | string | null) => {
  if (!value) return null;
  const time = dayjs(value);
  if (!time.isValid()) return null;
  return time.format('YYYY-MM-DD HH:mm');
};

interface ActivityDetailProps {
  /** Layer-specific row id (`activityId`). */
  id: string;
}

/**
 * The activity memory detail body, shared by the memory page's right panel and the chat Portal.
 */
const ActivityDetail = memo<ActivityDetailProps>(({ id: activityId }) => {
  const { t } = useTranslation('memory');
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const {
    data: activity,
    isLoading,
    error,
    mutate,
  } = useFetchMemoryDetail(activityId, LayersEnum.Activity);

  const schedule = useMemo(() => {
    if (!activity) return null;
    const start = formatTime(activity.startsAt);
    const end = formatTime(activity.endsAt);
    if (!start && !end) return null;
    if (start && end) return `${start} → ${end}`;
    return start || end;
  }, [activity]);

  let content;
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
          <HighlightedContent title={t('activity.narrative')}>
            {activity.narrative}
          </HighlightedContent>
        )}
        {activity.notes && (
          <HighlightedContent title={t('activity.notes')}>{activity.notes}</HighlightedContent>
        )}
        {activity.feedback && (
          <HighlightedContent title={t('activity.feedback')}>
            {activity.feedback}
          </HighlightedContent>
        )}

        <HashTags hashTags={activity.tags} />
      </>
    );
  }

  return (
    <AsyncBoundary
      data={activity}
      empty={<DetailNotFound />}
      error={error}
      errorVariant={'page'}
      isEmpty={!activity}
      isLoading={isLoading}
      loading={<DetailLoading />}
      onRetry={() => mutate()}
    >
      {content}
    </AsyncBoundary>
  );
});

ActivityDetail.displayName = 'ActivityDetail';

export default ActivityDetail;
