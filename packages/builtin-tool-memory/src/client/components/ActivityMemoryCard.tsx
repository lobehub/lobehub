'use client';

import { Flexbox, Spin, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
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
    <Flexbox className={stylex.props(styles.container).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <Flexbox flex={1}>
          <div {...stylex.props(styles.title)}>{title || 'Activity Memory'}</div>
        </Flexbox>
        {activityType && <Tag>{activityType}</Tag>}
        {status && <Tag color={STATUS_COLORS[status] || 'default'}>{status.replace('_', ' ')}</Tag>}
        {loading && <Spin size="middle" variant="network" />}
      </Flexbox>

      {hasActivityContent ? (
        <>
          <SummaryAccordion details={details} summary={summary} tags={tags} />

          {/* When it happened — the anchor an episodic memory is recalled by */}
          {schedule && (
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.section).className}
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
              <div {...stylex.props(styles.sectionBody)}>
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
              <div {...stylex.props(styles.detail)}>{notes}</div>
            </MemorySection>
          )}

          {feedback && (
            <MemorySection title={'How it felt'} tone={'gold'}>
              <div {...stylex.props(styles.sectionBody)}>{feedback}</div>
            </MemorySection>
          )}
        </>
      ) : (
        <Flexbox className={stylex.props(styles.content).className} gap={8}>
          {!summary && loading ? (
            <BubblesLoading />
          ) : (
            <>
              {summary && <div {...stylex.props(styles.summary)}>{summary}</div>}
              {details && <StreamingMarkdown>{details}</StreamingMarkdown>}
              {tags.length > 0 && (
                <Flexbox
                  horizontal
                  className={stylex.props(styles.tags).className}
                  gap={8}
                  wrap={'wrap'}
                >
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
