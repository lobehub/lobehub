'use client';

import { ActionIcon } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNote } from '../useCreateNote';

const NewNoteButton = memo(() => {
  const { t } = useTranslation('note');
  const handleCreate = useCreateNote();

  return (
    <ActionIcon icon={PlusIcon} size={'small'} title={t('list.newNote')} onClick={handleCreate} />
  );
});

NewNoteButton.displayName = 'QuickNoteNewNoteButton';

export default NewNoteButton;
