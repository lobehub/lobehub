'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import LoadError from '../LoadError';
import LoadMoreNotes from '../LoadMoreNotes';
import Item from '../NoteList/Item';
import EmptyState from './EmptyState';

const Body = memo(() => {
  const noteIds = useQuickNoteStore((s) =>
    quickNoteSelectors.filteredNotes(s).map((note) => note.id),
  );
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const notesLoadError = useQuickNoteStore((s) => s.notesLoadError);
  const searchKeywords = useQuickNoteStore((s) => s.searchKeywords);
  const filterActive = useQuickNoteStore((s) =>
    Boolean(s.searchKeywords.trim() || s.activeCollection || s.activeTag),
  );

  return (
    <Flexbox>
      {notesLoadError ? (
        <LoadError />
      ) : !notesInit ? (
        <Flexbox paddingBlock={4} paddingInline={8}>
          <SkeletonList />
        </Flexbox>
      ) : noteIds.length === 0 ? (
        // Filters run over loaded pages only, so a match may still sit on an older page.
        <Flexbox>
          <EmptyState filterActive={filterActive} searchActive={Boolean(searchKeywords.trim())} />
          <LoadMoreNotes />
        </Flexbox>
      ) : (
        <Flexbox gap={4} paddingBlock={4} paddingInline={8}>
          {noteIds.map((noteId) => (
            <Item key={noteId} noteId={noteId} />
          ))}
          <LoadMoreNotes />
        </Flexbox>
      )}
    </Flexbox>
  );
});

Body.displayName = 'QuickNoteSidebarBody';

export default Body;
