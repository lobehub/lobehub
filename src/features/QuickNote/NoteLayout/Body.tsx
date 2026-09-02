'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { DotIcon, FolderIcon, InboxIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { quickNoteSelectors, UNCATEGORIZED_KEY, useQuickNoteStore } from '@/store/quickNote';

enum GroupKey {
  Collections = 'collections',
  Tags = 'tags',
}

const GroupTitle = memo<{ title: string }>(({ title }) => (
  <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
    {title}
  </Text>
));

GroupTitle.displayName = 'QuickNoteGroupTitle';

const Count = memo<{ count: number }>(({ count }) => (
  <Text fontSize={12} type={'secondary'}>
    {count}
  </Text>
));

Count.displayName = 'QuickNoteCount';

const Body = memo(() => {
  const { t } = useTranslation('note');

  const [activeCollection, activeTag, setActiveCollection, setActiveTag] = useQuickNoteStore(
    (s) => [s.activeCollection, s.activeTag, s.setActiveCollection, s.setActiveTag],
  );
  const collections = useQuickNoteStore(quickNoteSelectors.collections);
  const tags = useQuickNoteStore(quickNoteSelectors.tags);
  const totalCount = useQuickNoteStore(quickNoteSelectors.totalCount);
  const uncategorizedCount = useQuickNoteStore(quickNoteSelectors.uncategorizedCount);

  const isAll = !activeCollection && !activeTag;

  return (
    <Flexbox gap={1} paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Collections, GroupKey.Tags]} gap={2}>
        <AccordionItem
          itemKey={GroupKey.Collections}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          title={<GroupTitle title={t('sidebar.collections')} />}
        >
          <Flexbox gap={1} paddingBlock={1}>
            <NavItem
              active={isAll}
              extra={<Count count={totalCount} />}
              icon={InboxIcon}
              title={t('sidebar.allNotes')}
              onClick={() => setActiveCollection(null)}
            />
            {uncategorizedCount > 0 && (
              <NavItem
                active={activeCollection === UNCATEGORIZED_KEY}
                extra={<Count count={uncategorizedCount} />}
                icon={FolderIcon}
                title={t('sidebar.uncategorized')}
                onClick={() => setActiveCollection(UNCATEGORIZED_KEY)}
              />
            )}
            {collections.map((collection) => (
              <NavItem
                active={activeCollection === collection.name}
                extra={<Count count={collection.count} />}
                icon={FolderIcon}
                key={collection.name}
                title={collection.name}
                onClick={() => setActiveCollection(collection.name)}
              />
            ))}
          </Flexbox>
        </AccordionItem>
        <AccordionItem
          itemKey={GroupKey.Tags}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          title={<GroupTitle title={t('sidebar.aiTags')} />}
        >
          <Flexbox gap={1} paddingBlock={1}>
            {tags.length === 0 ? (
              <Text
                align={'center'}
                fontSize={12}
                style={{ paddingBlock: 12, paddingInline: 8 }}
                type={'secondary'}
              >
                {t('sidebar.noTags')}
              </Text>
            ) : (
              tags.map((tag) => (
                <NavItem
                  active={activeTag === tag.name}
                  extra={<Count count={tag.count} />}
                  icon={DotIcon}
                  key={tag.name}
                  title={tag.name}
                  onClick={() => setActiveTag(activeTag === tag.name ? null : tag.name)}
                />
              ))
            )}
          </Flexbox>
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

Body.displayName = 'QuickNoteSidebarBody';

export default Body;
