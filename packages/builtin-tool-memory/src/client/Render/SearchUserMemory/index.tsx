'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Accordion, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { SearchMemoryParams, SearchUserMemoryState } from '../../../types';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    background: cssVar.colorBgContainer,
  },
  empty: { padding: '24px', color: cssVar.colorTextTertiary, textAlign: 'center' },
  item: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  itemContent: { fontSize: '13px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  itemTitle: { fontSize: '14px', fontWeight: 500, color: cssVar.colorText },
  sectionHeader: { fontSize: '12px', fontWeight: 500 },
  tags: { paddingBlockStart: '6px' },
});

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
    <Flexbox className={stylex.props(styles.item).className} gap={4}>
      {title && <div {...stylex.props(styles.itemTitle)}>{title}</div>}
      {content && <div {...stylex.props(styles.itemContent)}>{content}</div>}
      {subContent && (
        <Text
          className={stylex.props(styles.itemContent).className}
          style={{ fontStyle: 'italic' }}
          type={'secondary'}
        >
          {subContent}
        </Text>
      )}
      {safeTags.length > 0 && (
        <Flexbox horizontal className={stylex.props(styles.tags).className} gap={4} wrap={'wrap'}>
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
        <div {...stylex.props(styles.container)}>
          <div {...stylex.props(styles.empty)}>
            {t('builtins.lobe-user-memory.inspector.noResults')}
          </div>
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
          <Text className={stylex.props(styles.sectionHeader).className}>
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
          <Text className={stylex.props(styles.sectionHeader).className}>
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
          <Text className={stylex.props(styles.sectionHeader).className}>
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
          <Text className={stylex.props(styles.sectionHeader).className}>
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
          <Text className={stylex.props(styles.sectionHeader).className}>
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
      <Flexbox className={stylex.props(styles.container).className}>
        <Accordion
          defaultValue={defaultActiveKeys}
          gap={0}
          items={items}
          styles={{
            trigger: { paddingInline: 12 },
          }}
        />
      </Flexbox>
    );
  },
);

SearchUserMemoryRender.displayName = 'SearchUserMemoryRender';

export default SearchUserMemoryRender;
