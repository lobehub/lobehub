'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';

import { useQuickNoteStore } from '@/store/quickNote';
import { useServerConfigStore } from '@/store/serverConfig';

import Sidebar from './Sidebar';
import { styles } from './style';
import { useQuickNotePersistenceLifecycle } from './useQuickNotePersistenceLifecycle';

const NoteLayoutContent: FC = () => {
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

const NoteLayout: FC = () => {
  const [initialized, enabled] = useServerConfigStore((s) => [
    s.serverConfigInit,
    s.featureFlags.enableQuickNote,
  ]);

  if (!initialized) return null;
  if (!enabled) return <Navigate replace to={'..'} />;
  return <NoteLayoutContent />;
};

export default NoteLayout;
