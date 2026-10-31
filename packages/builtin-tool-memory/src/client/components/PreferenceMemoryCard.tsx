'use client';

import { Accordion, Avatar, Flexbox, Spin, Steps, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';
import { highlightTextStyles } from '@/styles';

import type { AddPreferenceMemoryParams } from '../../types';

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
  directive: { fontSize: '14px', lineHeight: 1.6, color: cssVar.colorText },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
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
  suggestion: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillQuaternary,
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

export interface PreferenceMemoryCardProps {
  data?: AddPreferenceMemoryParams;
  loading?: boolean;
}

export const PreferenceMemoryCard = memo<PreferenceMemoryCardProps>(({ data, loading }) => {
  const { summary, details, tags, title, withPreference } = data || {};
  const { conclusionDirectives, originContext, appContext, suggestions, type } =
    withPreference || {};

  // `tags`/`suggestions` come from raw model tool-call args without zod coercion,
  // so a model may emit a scalar where `string[]` is expected. Normalize to arrays
  // to keep this card from crashing on dirty input (`.map` on a non-array).
  const safeTags = Array.isArray(tags) ? tags : [];
  const safeSuggestions = Array.isArray(suggestions) ? suggestions : [];

  const hasContextContent =
    originContext?.actor ||
    originContext?.scenario ||
    originContext?.trigger ||
    originContext?.applicableWhen ||
    originContext?.notApplicableWhen;

  const hasAppContext = appContext?.app || appContext?.feature || appContext?.surface;

  const hasSuggestions = safeSuggestions.length > 0;

  if (
    !summary &&
    !details &&
    !safeTags.length &&
    !title &&
    !conclusionDirectives &&
    !hasContextContent &&
    !hasSuggestions
  )
    return null;

  const contextItems = [
    { avatar: '👤', content: originContext?.actor, title: 'Actor' },
    { avatar: '🎯', content: originContext?.scenario, title: 'Scenario' },
    { avatar: '⚡', content: originContext?.trigger, title: 'Trigger' },
    { avatar: '✅', content: originContext?.applicableWhen, title: 'Applicable When' },
    { avatar: '❌', content: originContext?.notApplicableWhen, title: 'Not Applicable When' },
  ].filter((item) => item.content);

  const appContextItems = [
    { avatar: '📱', content: appContext?.app, title: 'App' },
    { avatar: '🔧', content: appContext?.feature, title: 'Feature' },
    { avatar: '📍', content: appContext?.surface, title: 'Surface' },
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
          <div {...stylex.props(styles.title)}>{title || 'Preference Memory'}</div>
        </Flexbox>
        {type && <Tag>{type}</Tag>}
        {loading && <Spin size="middle" variant="network" />}
      </Flexbox>

      {/* When has context content: collapse summary */}
      {hasContextContent || hasAppContext ? (
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

          {/* Origin Context Steps */}
          {hasContextContent && (
            <Accordion
              className={stylex.props(styles.section).className}
              defaultValue={['context']}
              gap={0}
              items={[
                {
                  children: (
                    <Flexbox paddingBlock={'8px 12px'} paddingInline={8}>
                      <Steps
                        orientation="vertical"
                        items={contextItems.map((item) => ({
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
                  key: 'context',
                  title: (
                    <Text fontSize={12} type={'secondary'} weight={500}>
                      Origin Context
                    </Text>
                  ),
                },
              ]}
            />
          )}

          {/* App Context */}
          {hasAppContext && (
            <Accordion
              className={stylex.props(styles.section).className}
              gap={0}
              items={[
                {
                  children: (
                    <Flexbox paddingBlock={'8px 12px'} paddingInline={8}>
                      <Steps
                        orientation="vertical"
                        items={appContextItems.map((item) => ({
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
                  key: 'appContext',
                  title: (
                    <Text fontSize={12} type={'secondary'} weight={500}>
                      App Context
                    </Text>
                  ),
                },
              ]}
            />
          )}

          {/* Conclusion Directive */}
          {conclusionDirectives && (
            <Flexbox
              className={stylex.props(styles.section).className}
              gap={8}
              style={{ paddingBlock: 16, paddingInline: 12 }}
            >
              <Text fontSize={12} weight={500}>
                <span className={highlightTextStyles.primary}>Directive</span>
              </Text>
              <div {...stylex.props(styles.directive)}>{conclusionDirectives}</div>
            </Flexbox>
          )}

          {/* Suggestions */}
          {hasSuggestions && (
            <Flexbox
              className={stylex.props(styles.section).className}
              gap={8}
              style={{ paddingBlock: 16, paddingInline: 12 }}
            >
              <Text fontSize={12} weight={500}>
                <span className={highlightTextStyles.info}>Suggestions</span>
              </Text>
              <Flexbox gap={8}>
                {safeSuggestions.map((suggestion, index) => (
                  <div {...stylex.props(styles.suggestion)} key={index}>
                    {suggestion}
                  </div>
                ))}
              </Flexbox>
            </Flexbox>
          )}
        </>
      ) : (
        /* When no context content: show summary and details */
        <Flexbox className={stylex.props(styles.content).className} gap={8}>
          {!summary && loading ? (
            <BubblesLoading />
          ) : (
            <>
              {summary && <div {...stylex.props(styles.summary)}>{summary}</div>}
              {details && <StreamingMarkdown>{details}</StreamingMarkdown>}
              {conclusionDirectives && (
                <Flexbox gap={4} paddingBlock={8}>
                  <Text fontSize={12} weight={500}>
                    <span className={highlightTextStyles.primary}>Directive</span>
                  </Text>
                  <div {...stylex.props(styles.directive)}>{conclusionDirectives}</div>
                </Flexbox>
              )}
              {hasSuggestions && (
                <Flexbox gap={8} paddingBlock={8}>
                  <Text fontSize={12} weight={500}>
                    <span className={highlightTextStyles.info}>Suggestions</span>
                  </Text>
                  <Flexbox gap={8}>
                    {safeSuggestions.map((suggestion, index) => (
                      <div {...stylex.props(styles.suggestion)} key={index}>
                        {suggestion}
                      </div>
                    ))}
                  </Flexbox>
                </Flexbox>
              )}
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

PreferenceMemoryCard.displayName = 'PreferenceMemoryCard';

export default PreferenceMemoryCard;
