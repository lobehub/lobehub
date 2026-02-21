'use client';

import { Accordion, AccordionItem, Avatar, Flexbox, Tag, Text } from '@lobehub/ui';
import { Steps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';
import { highlightTextStyles } from '@/styles';

import type { AddExperienceMemoryParams } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  detail: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  keyLearning: css`
    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorText};
  `,
  section: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  stepContent: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
  stepsContainer: css`
    .ant-steps-item-content {
      min-height: auto;
    }

    .ant-steps-item-description {
      padding-block-end: 12px !important;
    }
  `,
  summary: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  tags: css`
    padding-block-start: 8px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

export interface ExperienceMemoryCardProps {
  data?: AddExperienceMemoryParams;
  loading?: boolean;
}

export const ExperienceMemoryCard = memo<ExperienceMemoryCardProps>(({ data, loading }) => {
  const { summary, details, tags, title, withExperience } = data || {};
  const { situation, reasoning, action, possibleOutcome, keyLearning } = withExperience || {};

  const hasStarContent = situation || reasoning || action || possibleOutcome;

  if (!summary && !details && !tags?.length && !title && !hasStarContent && !keyLearning)
    return null;

  const starItems = [
    { avatar: 'S', content: situation, title: 'Situation' },
    { avatar: 'T', content: reasoning, title: 'Task' },
    { avatar: 'A', content: action, title: 'Action' },
    { avatar: 'R', content: possibleOutcome, title: 'Result' },
  ].filter((item) => item.content);

  return (
    <Flexbox className={styles.container}>
      {/* Header */}
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Flexbox flex={1}>
          <div className={styles.title}>{title || 'Experience Memory'}</div>
        </Flexbox>
        {loading && <NeuralNetworkLoading size={20} />}
      </Flexbox>

      {/* When has STAR content: collapse summary */}
      {hasStarContent ? (
        <>
          {/* Collapsed Summary */}
          {(summary || tags?.length) && (
            <Accordion gap={0}>
              <AccordionItem
                itemKey="summary"
                paddingBlock={8}
                paddingInline={8}
                styles={{
                  base: { marginBlock: 4, marginInline: 4 },
                }}
                title={
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    Summary
                  </Text>
                }
              >
                <Flexbox gap={8} paddingBlock={'8px 12px'} paddingInline={8}>
                  {summary && <div className={styles.summary}>{summary}</div>}
                  {details && <div className={styles.detail}>{details}</div>}
                  {tags && tags.length > 0 && (
                    <Flexbox horizontal className={styles.tags} gap={8} wrap={'wrap'}>
                      {tags.map((tag, index) => (
                        <Tag key={index}>{tag}</Tag>
                      ))}
                    </Flexbox>
                  )}
                </Flexbox>
              </AccordionItem>
            </Accordion>
          )}

          {/* STAR Steps */}
          <Accordion className={styles.section} defaultExpandedKeys={['star']} gap={0}>
            <AccordionItem
              itemKey="star"
              paddingBlock={8}
              paddingInline={8}
              title={
                <Text fontSize={12} type={'secondary'} weight={500}>
                  STAR
                </Text>
              }
            >
              <Flexbox paddingBlock={'8px 12px'} paddingInline={8}>
                <Steps
                  className={styles.stepsContainer}
                  current={null as any}
                  direction="vertical"
                  size="small"
                  items={starItems.map((item) => ({
                    description: <div className={styles.stepContent}>{item.content}</div>,
                    icon: (
                      <Avatar
                        shadow
                        avatar={item.avatar}
                        shape={'square'}
                        size={20}
                        style={{
                          border: `1px solid ${cssVar.colorBorderSecondary}`,
                          fontSize: 11,
                        }}
                      />
                    ),
                    title: (
                      <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                        {item.title}
                      </Text>
                    ),
                  }))}
                />
              </Flexbox>
            </AccordionItem>
          </Accordion>

          {/* Key Learning */}
          {keyLearning && (
            <Flexbox
              className={styles.section}
              gap={8}
              style={{ paddingBlock: 16, paddingInline: 12 }}
            >
              <Text fontSize={12} weight={500}>
                <span className={highlightTextStyles.gold}>Key Learning</span>
              </Text>
              <div className={styles.keyLearning}>{keyLearning}</div>
            </Flexbox>
          )}
        </>
      ) : (
        /* When no STAR content: show summary and details */
        <Flexbox className={styles.content} gap={8}>
          {!summary && loading ? (
            <BubblesLoading />
          ) : (
            <>
              {summary && <div className={styles.summary}>{summary}</div>}
              {details && <StreamingMarkdown>{details}</StreamingMarkdown>}
              {tags && tags.length > 0 && (
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

ExperienceMemoryCard.displayName = 'ExperienceMemoryCard';

export default ExperienceMemoryCard;
