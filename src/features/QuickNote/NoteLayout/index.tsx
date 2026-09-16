'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, useEffect } from 'react';
import { Outlet } from 'react-router';

import { useQuickNoteStore } from '@/store/quickNote';

import Sidebar from './Sidebar';
import { styles } from './style';
import { useQuickNotePersistenceLifecycle } from './useQuickNotePersistenceLifecycle';

const NoteLayout: FC = () => {
  const initNotes = useQuickNoteStore((s) => s.initNotes);

  useEffect(() => {
    initNotes();
  }, [initNotes]);

  useQuickNotePersistenceLifecycle();

  return (
    <>
      <Sidebar />
      <Flexbox
        className={styles.mainContainer}
        flex={1}
        height={'100%'}
        style={{ overflow: 'hidden' }}
      >
        <Outlet />
      </Flexbox>
    </>
  );
};

export default NoteLayout;
