'use client';

import { Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { NotebookPenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuickNoteStore } from '@/store/quickNote';

import { useCreateNote } from '../useCreateNote';

interface EmptyStateProps {
  /** A search, collection or tag filter hides the loaded notes. */
  filterActive: boolean;
  /** The search box holds keywords. */
  searchActive: boolean;
}

const EmptyState = memo<EmptyStateProps>(({ filterActive, searchActive }) => {
  const { t } = useTranslation('note');
  const setSearchKeywords = useQuickNoteStore((s) => s.setSearchKeywords);
  const hasMore = useQuickNoteStore((s) => s.notesHasMore);
  const handleCreate = useCreateNote();

  if (searchActive || (filterActive && hasMore))
    return (
      <Flexbox align={'center'} gap={8} paddingBlock={24} paddingInline={16}>
        <Text align={'center'} color={cssVar.colorTextTertiary} fontSize={12}>
          {hasMore ? t('list.emptyLoaded') : t('list.empty')}
        </Text>
        {searchActive && (
          <Button size={'small'} type={'text'} onClick={() => setSearchKeywords('')}>
            {t('list.clearSearch')}
          </Button>
        )}
      </Flexbox>
    );

  return (
    <Flexbox align={'center'} gap={12} paddingBlock={32} paddingInline={16}>
      <Icon icon={NotebookPenIcon} size={28} style={{ opacity: 0.4 }} />
      <Text align={'center'} color={cssVar.colorTextTertiary} fontSize={12}>
        {t('list.emptyHint')}
      </Text>
      <Button onClick={handleCreate}>{t('list.newNote')}</Button>
    </Flexbox>
  );
});

EmptyState.displayName = 'QuickNoteListEmptyState';

export default EmptyState;
