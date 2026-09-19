'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import LoadError from '../LoadError';
import Item from '../NoteList/Item';
import EmptyState from './EmptyState';

const Body = memo(() => {
  const noteIds = useQuickNoteStore((s) =>
    quickNoteSelectors.filteredNotes(s).map((note) => note.id),
  );
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const notesLoadError = useQuickNoteStore((s) => s.notesLoadError);
  const searchKeywords = useQuickNoteStore((s) => s.searchKeywords);

  return (
    <Flexbox>
      {notesLoadError ? (
        <LoadError />
      ) : !notesInit ? (
        <Flexbox paddingBlock={4} paddingInline={8}>
          <SkeletonList />
        </Flexbox>
      ) : noteIds.length === 0 ? (
        <EmptyState searchActive={Boolean(searchKeywords.trim())} />
      ) : (
        <Flexbox gap={4} paddingBlock={4} paddingInline={8}>
          {noteIds.map((noteId) => (
            <Item key={noteId} noteId={noteId} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

Body.displayName = 'QuickNoteSidebarBody';

export default Body;
