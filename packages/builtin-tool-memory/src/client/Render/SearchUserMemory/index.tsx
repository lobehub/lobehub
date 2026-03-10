'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Accordion, AccordionItem, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SearchMemoryParams, SearchUserMemoryState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  empty: css`
    padding: 24px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  item: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  itemContent: css`
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  itemTitle: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  sectionHeader: css`
    font-size: 12px;
    font-weight: 500;
  `,
  tags: css`
    padding-block-start: 6px;
  `,
}));

interface MemoryItemProps {
  content?: string | null;
  subContent?: string | null;
  tags?: string[] | null;
  title?: string | null;
}

const MemoryItem = memo<MemoryItemProps>(({ title, content, subContent, tags }) => {
  return (
    <Flexbox className={styles.item} gap={4}>
      {title && <div className={styles.itemTitle}>{title}</div>}
      {content && <div className={styles.itemContent}>{content}</div>}
      {subContent && (
        <Text className={styles.itemContent} style={{ fontStyle: 'italic' }} type={'secondary'}>
          {subContent}
        </Text>
      )}
      {tags && tags.length > 0 && (
        <Flexbox horizontal className={styles.tags} gap={4} wrap={'wrap'}>
          {tags.map((tag, index) => (
            <Tag key={index} size={'small'}>
              {tag}
            </Tag>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

MemoryItem.displayName = 'MemoryItem';

const SearchUserMemoryRender = memo<BuiltinRenderProps<SearchMemoryParams, SearchUserMemoryState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('plugin');

    const contexts = pluginState?.contexts || [];
    const experiences = pluginState?.experiences || [];
    const preferences = pluginState?.preferences || [];

    const totalCount = contexts.length + experiences.length + preferences.length;

    if (totalCount === 0) {
      return (
        <div className={styles.container}>
          <div className={styles.empty}>{t('builtins.lobe-user-memory.inspector.noResults')}</div>
        </div>
      );
    }

    const defaultActiveKeys = [
      ...(contexts.length > 0 ? ['contexts'] : []),
      ...(experiences.length > 0 ? ['experiences'] : []),
      ...(preferences.length > 0 ? ['preferences'] : []),
    ];

    return (
      <Flexbox className={styles.container}>
        <Accordion defaultExpandedKeys={defaultActiveKeys} gap={0}>
          {/* Contexts */}
          {contexts.length > 0 && (
            <AccordionItem
              itemKey="contexts"
              paddingBlock={8}
              paddingInline={12}
              title={
                <Text className={styles.sectionHeader}>
                  <span>{t('builtins.lobe-user-memory.render.contexts')}</span>
                  <Text as={'span'} type={'secondary'}>
                    {' '}
                    ({contexts.length})
                  </Text>
                </Text>
              }
            >
              <Flexbox>
                {contexts.map((item) => (
                  <MemoryItem
                    content={item.description}
                    key={item.id}
                    subContent={item.currentStatus}
                    tags={item.tags}
                    title={item.title}
                  />
                ))}
              </Flexbox>
            </AccordionItem>
          )}

          {/* Experiences */}
          {experiences.length > 0 && (
            <AccordionItem
              itemKey="experiences"
              paddingBlock={8}
              paddingInline={12}
              title={
                <Text className={styles.sectionHeader}>
                  <span>{t('builtins.lobe-user-memory.render.experiences')}</span>
                  <Text as={'span'} type={'secondary'}>
                    {' '}
                    ({experiences.length})
                  </Text>
                </Text>
              }
            >
              <Flexbox>
                {experiences.map((item) => (
                  <MemoryItem
                    content={item.situation}
                    key={item.id}
                    subContent={item.keyLearning}
                    tags={item.tags}
                    title={item.action}
                  />
                ))}
              </Flexbox>
            </AccordionItem>
          )}

          {/* Preferences */}
          {preferences.length > 0 && (
            <AccordionItem
              itemKey="preferences"
              paddingBlock={8}
              paddingInline={12}
              title={
                <Text className={styles.sectionHeader}>
                  <span>{t('builtins.lobe-user-memory.render.preferences')}</span>
                  <Text as={'span'} type={'secondary'}>
                    {' '}
                    ({preferences.length})
                  </Text>
                </Text>
              }
            >
              <Flexbox>
                {preferences.map((item) => (
                  <MemoryItem
                    content={item.conclusionDirectives}
                    key={item.id}
                    subContent={item.suggestions}
                    tags={item.tags}
                  />
                ))}
              </Flexbox>
            </AccordionItem>
          )}
        </Accordion>
      </Flexbox>
    );
  },
);

SearchUserMemoryRender.displayName = 'SearchUserMemoryRender';

export default SearchUserMemoryRender;
