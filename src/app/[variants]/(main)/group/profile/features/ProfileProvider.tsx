'use client';

import { useEditor } from '@lobehub/editor/react';
import { type PropsWithChildren, memo } from 'react';

import StoreUpdater from './StoreUpdater';
import { Provider, createStore } from './store';

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
