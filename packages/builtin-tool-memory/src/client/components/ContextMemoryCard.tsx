'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';

import type { AddContextMemoryParams } from '../../types';
import { getContextMemoryViewModel } from './contextMemoryViewModel';
import {
  EntityChips,
  memoryCardStyles as styles,
  MemorySection,
  SummaryAccordion,
} from './MemoryCardParts';

/**
 * `ContextStatusEnum` values mapped to semantic tag colors, so a context reads its
 * lifecycle at a glance instead of as another neutral label.
 */
const STATUS_COLORS: Record<string, string> = {
  aborted: 'error',
  cancelled: 'default',
  completed: 'success',
  on_hold: 'warning',
  ongoing: 'info',
  planned: 'default',
};

export interface ContextMemoryCardProps {
  data?: AddContextMemoryParams;
  loading?: boolean;
}

export const ContextMemoryCard = memo<ContextMemoryCardProps>(({ data, loading }) => {
  const {
    contextType,
    description,
    details,
    entities,
    hasContextContent,
    impact,
    isEmpty,
    labels,
    status,
    summary,
    tags,
    title,
    urgency,
  } = getContextMemoryViewModel(data);

  const scoreItems = [
    { percent: impact, title: 'Impact' },
    {
      percent: urgency,
      strokeColor: (urgency ?? 0) >= 70 ? cssVar.colorError : cssVar.colorWarning,
      title: 'Urgency',
    },
  ].filter((item) => item.percent !== undefined);

  if (isEmpty) return null;

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Flexbox flex={1}>
          <div className={styles.title}>{title || 'Context Memory'}</div>
        </Flexbox>
        {contextType && <Tag>{contextType}</Tag>}
        {status && <Tag color={STATUS_COLORS[status] || 'default'}>{status.replace('_', ' ')}</Tag>}
        {loading && <NeuralNetworkLoading size={20} />}
      </Flexbox>

      {hasContextContent ? (
        <>
          <SummaryAccordion details={details} summary={summary} tags={tags} />

          {description && (
            <MemorySection title={'Description'}>
              <div className={styles.sectionBody}>
                <StreamingMarkdown>{description}</StreamingMarkdown>
              </div>
            </MemorySection>
          )}

          {scoreItems.length > 0 && (
            <Flexbox
              horizontal
              className={styles.section}
              gap={24}
              style={{ paddingBlock: 12, paddingInline: 12 }}
            >
              {scoreItems.map((item) => (
                <Flexbox horizontal align={'center'} gap={8} key={item.title}>
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    {item.title}
                  </Text>
                  <Progress
                    percent={item.percent}
                    showInfo={false}
                    size={[2, 12]}
                    steps={5}
                    strokeColor={item.strokeColor}
                  />
                  <Text fontSize={12} type={'secondary'}>
                    {item.percent}%
                  </Text>
                </Flexbox>
              ))}
            </Flexbox>
          )}

          {entities.length > 0 && (
            <MemorySection title={'Involved'} tone={'info'}>
              <EntityChips entities={entities} />
            </MemorySection>
          )}

          {labels.length > 0 && (
            <Flexbox
              horizontal
              className={styles.section}
              gap={8}
              style={{ paddingBlock: 12, paddingInline: 12 }}
              wrap={'wrap'}
            >
              {labels.map((label, index) => (
                <Tag key={index}>{label}</Tag>
              ))}
            </Flexbox>
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

ContextMemoryCard.displayName = 'ContextMemoryCard';

export default ContextMemoryCard;
