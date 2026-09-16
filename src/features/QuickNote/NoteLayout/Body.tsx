'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import LoadError from '../LoadError';
import Item from '../NoteList/Item';
import EmptyState from './EmptyState';

const Body = memo(() => {
  const notes = useQuickNoteStore(quickNoteSelectors.filteredNotes);
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
      ) : notes.length === 0 ? (
        <EmptyState searchActive={Boolean(searchKeywords.trim())} />
      ) : (
        <Flexbox gap={4} paddingBlock={4} paddingInline={8}>
          {notes.map((note) => (
            <Item key={note.id} note={note} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

Body.displayName = 'QuickNoteSidebarBody';

export default Body;
