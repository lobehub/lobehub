'use client';

import { Accordion, Avatar, Flexbox, Spin, Steps, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';
import { highlightTextStyles } from '@/styles';

import type { AddExperienceMemoryParams } from '../../types';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    background: cssVar.colorBgContainer,
  },
  content: { paddingBlock: '12px', paddingInline: '16px' },
  detail: { fontSize: '13px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  keyLearning: { fontSize: '14px', lineHeight: 1.6, color: cssVar.colorText },
  section: {
    padding: '4px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  stepContent: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
  summary: { fontSize: '14px', fontWeight: 500, color: cssVar.colorTextSecondary },
  tags: {
    paddingBlockStart: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

export interface ExperienceMemoryCardProps {
  data?: AddExperienceMemoryParams;
  loading?: boolean;
}

export const ExperienceMemoryCard = memo<ExperienceMemoryCardProps>(({ data, loading }) => {
  const { summary, details, tags, title, withExperience } = data || {};
  const { situation, reasoning, action, possibleOutcome, keyLearning } = withExperience || {};

  // `tags` comes from raw model tool-call args without zod coercion, so a model may
  // emit a scalar where `string[]` is expected. Normalize to an array to keep this
  // card from crashing on dirty input (`.map` on a non-array).
  const safeTags = Array.isArray(tags) ? tags : [];

  const hasStarContent = situation || reasoning || action || possibleOutcome;

  if (!summary && !details && !safeTags.length && !title && !hasStarContent && !keyLearning)
    return null;

  const starItems = [
    { avatar: 'S', content: situation, title: 'Situation' },
    { avatar: 'T', content: reasoning, title: 'Task' },
    { avatar: 'A', content: action, title: 'Action' },
    { avatar: 'R', content: possibleOutcome, title: 'Result' },
  ].filter((item) => item.content);

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      {/* Header */}
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <Flexbox flex={1}>
          <div {...stylex.props(styles.title)}>{title || 'Experience Memory'}</div>
        </Flexbox>
        {loading && <Spin size="middle" variant="network" />}
      </Flexbox>

      {/* When has STAR content: collapse summary */}
      {hasStarContent ? (
        <>
          {/* Collapsed Summary */}
          {(summary || safeTags.length > 0) && (
            <Accordion
              gap={0}
              items={[
                {
                  children: (
                    <Flexbox gap={8} paddingBlock={'8px 12px'} paddingInline={8}>
                      {summary && <div {...stylex.props(styles.summary)}>{summary}</div>}
                      {details && <div {...stylex.props(styles.detail)}>{details}</div>}
                      {safeTags.length > 0 && (
                        <Flexbox
                          horizontal
                          className={stylex.props(styles.tags).className}
                          gap={8}
                          wrap={'wrap'}
                        >
                          {safeTags.map((tag, index) => (
                            <Tag key={index}>{tag}</Tag>
                          ))}
                        </Flexbox>
                      )}
                    </Flexbox>
                  ),
                  key: 'summary',
                  title: (
                    <Text fontSize={12} type={'secondary'} weight={500}>
                      Summary
                    </Text>
                  ),
                },
              ]}
              styles={{
                item: { marginBlock: 4, marginInline: 4 },
              }}
            />
          )}

          {/* STAR Steps */}
          <Accordion
            className={stylex.props(styles.section).className}
            defaultValue={['star']}
            gap={0}
            items={[
              {
                children: (
                  <Flexbox paddingBlock={'8px 12px'} paddingInline={8}>
                    <Steps
                      orientation="vertical"
                      items={starItems.map((item) => ({
                        description: (
                          <div {...stylex.props(styles.stepContent)}>{item.content}</div>
                        ),
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
                ),
                key: 'star',
                title: (
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    STAR
                  </Text>
                ),
              },
            ]}
          />

          {/* Key Learning */}
          {keyLearning && (
            <Flexbox
              className={stylex.props(styles.section).className}
              gap={8}
              style={{ paddingBlock: 16, paddingInline: 12 }}
            >
              <Text fontSize={12} weight={500}>
                <span className={highlightTextStyles.gold}>Key Learning</span>
              </Text>
              <div {...stylex.props(styles.keyLearning)}>{keyLearning}</div>
            </Flexbox>
          )}
        </>
      ) : (
        /* When no STAR content: show summary and details */
        <Flexbox className={stylex.props(styles.content).className} gap={8}>
          {!summary && loading ? (
            <BubblesLoading />
          ) : (
            <>
              {summary && <div {...stylex.props(styles.summary)}>{summary}</div>}
              {details && <StreamingMarkdown>{details}</StreamingMarkdown>}
              {safeTags.length > 0 && (
                <Flexbox
                  horizontal
                  className={stylex.props(styles.tags).className}
                  gap={8}
                  wrap={'wrap'}
                >
                  {safeTags.map((tag, index) => (
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
