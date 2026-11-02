'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';
import { Navigate, Outlet } from 'react-router';

import { useQuickNoteStore } from '@/store/quickNote';

import Sidebar from './Sidebar';
import { styles } from './style';
import { useQuickNotePersistenceLifecycle } from './useQuickNotePersistenceLifecycle';
import { useQuickNoteRouteAccess } from './useQuickNoteRouteAccess';

const NoteLayoutContent: FC = () => {
  const useFetchNotes = useQuickNoteStore((s) => s.useFetchNotes);
  useFetchNotes();

  useQuickNotePersistenceLifecycle();

  return (
    <>
      <Sidebar />
      <Flexbox
        className={stylex.props(styles.mainContainer).className}
        flex={1}
        height={'100%'}
        style={{ overflow: 'hidden' }}
      >
        <Outlet />
      </Flexbox>
    </>
  );
};

const NoteLayout: FC = () => {
  const access = useQuickNoteRouteAccess();

  if (access === 'pending') return null;
  if (access === 'denied') return <Navigate replace to={'..'} />;
  return <NoteLayoutContent />;
};

export default NoteLayout;
