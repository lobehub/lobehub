'use client';

import { ActionIcon, Flexbox, Icon, ScrollShadow, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { NotebookPenIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { quickNoteSelectors, UNCATEGORIZED_KEY, useQuickNoteStore } from '@/store/quickNote';

import NewNoteButton from '../NoteLayout/NewNoteButton';
import { styles } from '../NoteLayout/style';
import { useCreateNote } from '../useCreateNote';
import Item from './Item';

const EmptyState = memo<{ searchActive: boolean }>(({ searchActive }) => {
  const { t } = useTranslation('note');
  const setSearchKeywords = useQuickNoteStore((s) => s.setSearchKeywords);
  const handleCreate = useCreateNote();

  if (searchActive)
    return (
      <Flexbox align={'center'} gap={8} paddingBlock={24} paddingInline={16}>
        <Text align={'center'} color={cssVar.colorTextTertiary} fontSize={12}>
          {t('list.empty')}
        </Text>
        <Button size={'small'} type={'text'} onClick={() => setSearchKeywords('')}>
          {t('list.clearSearch')}
        </Button>
      </Flexbox>
    );

  return (
    <Flexbox align={'center'} gap={12} paddingBlock={32} paddingInline={16}>
      <Icon icon={NotebookPenIcon} size={28} style={{ opacity: 0.4 }} />
      <Text align={'center'} color={cssVar.colorTextTertiary} fontSize={12}>
        {t('list.emptyHint')}
      </Text>
      <Button size={'small'} onClick={handleCreate}>
        {t('list.newNote')}
      </Button>
    </Flexbox>
  );
});

EmptyState.displayName = 'QuickNoteListEmptyState';

const NoteList = memo(() => {
  const { t } = useTranslation('note');

  const notes = useQuickNoteStore(quickNoteSelectors.filteredNotes);
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const searchKeywords = useQuickNoteStore((s) => s.searchKeywords);
  const [activeCollection, activeTag, listCollapsed, toggleListCollapsed] = useQuickNoteStore(
    (s) => [s.activeCollection, s.activeTag, s.listCollapsed, s.toggleListCollapsed],
  );

  const title =
    activeTag ??
    (activeCollection === UNCATEGORIZED_KEY
      ? t('sidebar.uncategorized')
      : (activeCollection ?? t('sidebar.allNotes')));

  if (listCollapsed)
    return (
      <Flexbox align={'center'} className={styles.listColumn} paddingBlock={8} width={40}>
        <ActionIcon
          icon={PanelLeftOpenIcon}
          size={'small'}
          title={t('list.expand')}
          onClick={toggleListCollapsed}
        />
      </Flexbox>
    );

  return (
    <Flexbox className={styles.listColumn} height={'100%'} width={288}>
      <Flexbox
        horizontal
        align={'center'}
        justify={'space-between'}
        paddingBlock={12}
        paddingInline={'16px 8px'}
      >
        <Flexbox horizontal align={'center'} gap={6}>
          <Text ellipsis weight={500}>
            {title}
          </Text>
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {t('list.count', { count: notes.length })}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={2}>
          <NewNoteButton />
          <ActionIcon
            icon={PanelLeftCloseIcon}
            size={'small'}
            title={t('list.collapse')}
            onClick={toggleListCollapsed}
          />
        </Flexbox>
      </Flexbox>
      {notesInit ? (
        <ScrollShadow flex={1} size={4}>
          {notes.length === 0 ? (
            <EmptyState searchActive={Boolean(searchKeywords.trim())} />
          ) : (
            <Flexbox gap={4} paddingBlock={4} paddingInline={8}>
              {notes.map((note) => (
                <Item key={note.id} note={note} />
              ))}
            </Flexbox>
          )}
        </ScrollShadow>
      ) : (
        <Flexbox paddingBlock={4} paddingInline={8}>
          <SkeletonList />
        </Flexbox>
      )}
    </Flexbox>
  );
});

NoteList.displayName = 'QuickNoteList';

export default NoteList;
