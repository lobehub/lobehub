'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Accordion, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';
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
  // Guard against non-array `tags` (dirty data) so a bad row can't crash the list.
  const safeTags = Array.isArray(tags) ? tags : [];
  return (
    <Flexbox className={styles.item} gap={4}>
      {title && <div className={styles.itemTitle}>{title}</div>}
      {content && <div className={styles.itemContent}>{content}</div>}
      {subContent && (
        <Text className={styles.itemContent} style={{ fontStyle: 'italic' }} type={'secondary'}>
          {subContent}
        </Text>
      )}
      {safeTags.length > 0 && (
        <Flexbox horizontal className={styles.tags} gap={4} wrap={'wrap'}>
          {safeTags.map((tag, index) => (
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

    const activities = pluginState?.activities || [];
    const contexts = pluginState?.contexts || [];
    const experiences = pluginState?.experiences || [];
    const identities = pluginState?.identities || [];
    const preferences = pluginState?.preferences || [];

    const totalCount =
      activities.length +
      contexts.length +
      experiences.length +
      identities.length +
      preferences.length;

    if (totalCount === 0) {
      return (
        <div className={styles.container}>
          <div className={styles.empty}>{t('builtins.lobe-user-memory.inspector.noResults')}</div>
        </div>
      );
    }

    const defaultActiveKeys = [
      ...(activities.length > 0 ? ['activities'] : []),
      ...(contexts.length > 0 ? ['contexts'] : []),
      ...(experiences.length > 0 ? ['experiences'] : []),
      ...(identities.length > 0 ? ['identities'] : []),
      ...(preferences.length > 0 ? ['preferences'] : []),
    ];

    const items = [
      activities.length > 0 && {
        children: (
          <Flexbox>
            {activities.map((item) => (
              <MemoryItem
                content={item.narrative}
                key={item.id}
                subContent={item.feedback}
                tags={item.tags}
                title={item.notes || item.type}
              />
            ))}
          </Flexbox>
        ),
        key: 'activities',
        title: (
          <Text className={styles.sectionHeader}>
            <span>Activities</span>
            <Text as={'span'} type={'secondary'}>
              {' '}
              ({activities.length})
            </Text>
          </Text>
        ),
      },
      contexts.length > 0 && {
        children: (
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
        ),
        key: 'contexts',
        title: (
          <Text className={styles.sectionHeader}>
            <span>{t('builtins.lobe-user-memory.render.contexts')}</span>
            <Text as={'span'} type={'secondary'}>
              {' '}
              ({contexts.length})
            </Text>
          </Text>
        ),
      },
      experiences.length > 0 && {
        children: (
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
        ),
        key: 'experiences',
        title: (
          <Text className={styles.sectionHeader}>
            <span>{t('builtins.lobe-user-memory.render.experiences')}</span>
            <Text as={'span'} type={'secondary'}>
              {' '}
              ({experiences.length})
            </Text>
          </Text>
        ),
      },
      identities.length > 0 && {
        children: (
          <Flexbox>
            {identities.map((item) => (
              <MemoryItem
                content={item.description}
                key={item.id}
                subContent={item.role}
                tags={item.tags}
                title={item.relationship || item.type}
              />
            ))}
          </Flexbox>
        ),
        key: 'identities',
        title: (
          <Text className={styles.sectionHeader}>
            <span>Identities</span>
            <Text as={'span'} type={'secondary'}>
              {' '}
              ({identities.length})
            </Text>
          </Text>
        ),
      },
      preferences.length > 0 && {
        children: (
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
        ),
        key: 'preferences',
        title: (
          <Text className={styles.sectionHeader}>
            <span>{t('builtins.lobe-user-memory.render.preferences')}</span>
            <Text as={'span'} type={'secondary'}>
              {' '}
              ({preferences.length})
            </Text>
          </Text>
        ),
      },
    ].filter(Boolean) as { children: ReactNode; key: string; title: ReactNode }[];

    return (
      <Flexbox className={styles.container}>
        <Accordion
          defaultValue={defaultActiveKeys}
          gap={0}
          items={items}
          styles={{
            header: { paddingBlock: 8, paddingInline: 12 },
          }}
        />
      </Flexbox>
    );
  },
);

SearchUserMemoryRender.displayName = 'SearchUserMemoryRender';

export default SearchUserMemoryRender;
