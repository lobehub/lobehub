'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, useEffect } from 'react';
import { Outlet } from 'react-router';

import { useQuickNoteStore } from '@/store/quickNote';

import NoteList from '../NoteList';
import Sidebar from './Sidebar';
import { styles } from './style';

const NoteLayout: FC = () => {
  const initNotes = useQuickNoteStore((s) => s.initNotes);

  useEffect(() => {
    initNotes();
  }, [initNotes]);

  return (
    <>
      <Sidebar />
      <Flexbox horizontal className={styles.mainContainer} flex={1} height={'100%'}>
        <NoteList />
        <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
          <Outlet />
        </Flexbox>
      </Flexbox>
    </>
  );
};

export default NoteLayout;
