'use client';

import { useEditor } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { createStore, Provider } from './store';
import StoreUpdater from './StoreUpdater';

const ProfileProvider = memo<PropsWithChildren>(({ children }) => {
  const editor = useEditor();

  return (
    <Provider createStore={() => createStore({ editor })}>
      <StoreUpdater />
      {children}
    </Provider>
  );
});

export default ProfileProvider;
