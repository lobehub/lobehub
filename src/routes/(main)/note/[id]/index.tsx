'use client';

import { useUnmount } from 'ahooks';
import { memo } from 'react';
import { useParams } from 'react-router';
import { createStoreUpdater } from 'zustand-utils';

import { NoteDetail } from '@/features/QuickNote';
import { useQuickNoteStore } from '@/store/quickNote';

const NoteDetailPage = memo(() => {
  const storeUpdater = createStoreUpdater(useQuickNoteStore);
  const params = useParams<{ id: string }>();

  useUnmount(() => {
    useQuickNoteStore.setState({ activeNoteId: undefined });
  });

  storeUpdater('activeNoteId', params.id);

  return <NoteDetail id={params.id!} />;
});

NoteDetailPage.displayName = 'NoteDetailPage';

export default NoteDetailPage;
