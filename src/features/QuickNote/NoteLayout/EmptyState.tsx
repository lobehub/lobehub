'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { NotebookPenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuickNoteStore } from '@/store/quickNote';

import { useCreateNote } from '../useCreateNote';

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

export default EmptyState;
