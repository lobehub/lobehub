'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';

import type { AddActivityMemoryParams } from '../../types';
import { getActivityMemoryViewModel } from './activityMemoryViewModel';
import {
  EntityChips,
  memoryCardStyles as styles,
  MemorySection,
  SummaryAccordion,
} from './MemoryCardParts';

/**
 * Activity lifecycle values mapped to semantic tag colors, so an activity reads as
 * done / planned / dropped at a glance instead of as another neutral label.
 */
const STATUS_COLORS: Record<string, string> = {
  cancelled: 'default',
  completed: 'success',
  on_hold: 'warning',
  ongoing: 'info',
  pending: 'warning',
  planned: 'default',
};

export interface ActivityMemoryCardProps {
  data?: AddActivityMemoryParams;
  loading?: boolean;
}

export const ActivityMemoryCard = memo<ActivityMemoryCardProps>(({ data, loading }) => {
  const {
    activityType,
    details,
    entities,
    feedback,
    hasActivityContent,
    isEmpty,
    narrative,
    notes,
    schedule,
    status,
    summary,
    tags,
    timezone,
    title,
  } = getActivityMemoryViewModel(data);

  if (isEmpty) return null;

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Flexbox flex={1}>
          <div className={styles.title}>{title || 'Activity Memory'}</div>
        </Flexbox>
        {activityType && <Tag>{activityType}</Tag>}
        {status && <Tag color={STATUS_COLORS[status] || 'default'}>{status.replace('_', ' ')}</Tag>}
        {loading && <NeuralNetworkLoading size={20} />}
      </Flexbox>

      {hasActivityContent ? (
        <>
          <SummaryAccordion details={details} summary={summary} tags={tags} />

          {/* When it happened — the anchor an episodic memory is recalled by */}
          {schedule && (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.section}
              gap={8}
              style={{ paddingBlock: 12, paddingInline: 12 }}
            >
              <span>🕒</span>
              <Text fontSize={13}>{schedule}</Text>
              {timezone && (
                <Text fontSize={12} type={'secondary'}>
                  {timezone}
                </Text>
              )}
            </Flexbox>
          )}

          {narrative && (
            <MemorySection title={'What happened'}>
              <div className={styles.sectionBody}>
                <StreamingMarkdown>{narrative}</StreamingMarkdown>
              </div>
            </MemorySection>
          )}

          {entities.length > 0 && (
            <MemorySection title={'Involved'} tone={'info'}>
              <EntityChips entities={entities} />
            </MemorySection>
          )}

          {notes && (
            <MemorySection title={'Notes'} tone={'info'}>
              <div className={styles.detail}>{notes}</div>
            </MemorySection>
          )}

          {feedback && (
            <MemorySection title={'How it felt'} tone={'gold'}>
              <div className={styles.sectionBody}>{feedback}</div>
            </MemorySection>
          )}
        </>
      ) : (
        <Flexbox className={styles.content} gap={8}>
          {!summary && loading ? (
            <BubblesLoading />
          ) : (
            <>
              {summary && <div className={styles.summary}>{summary}</div>}
              {details && <StreamingMarkdown>{details}</StreamingMarkdown>}
              {tags.length > 0 && (
                <Flexbox horizontal className={styles.tags} gap={8} wrap={'wrap'}>
                  {tags.map((tag, index) => (
                    <Tag key={index}>{tag}</Tag>
                  ))}
                </Flexbox>
              )}
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

ActivityMemoryCard.displayName = 'ActivityMemoryCard';

export default ActivityMemoryCard;
