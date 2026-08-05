'use client';

import { useEditor } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';

import { createStore, Provider } from './store';
import StoreUpdater from './StoreUpdater';

const AgentScopedProfileProvider = memo<PropsWithChildren>(({ children }) => {
  const editor = useEditor();

  return (
    <Provider createStore={() => createStore({ editor })}>
      <StoreUpdater />
      {children}
    </Provider>
  );
});

const ProfileProvider = memo<PropsWithChildren>(({ children }) => {
  const agentId = useAgentStore((s) => s.activeAgentId);

  // Each agent owns an editor instance. The editor package debounces
  // onTextChange internally, so reusing one instance across :aid changes lets
  // an old callback read the newly loaded document. Remounting preserves the
  // old instance long enough for its captured callback to save the old draft.
  return (
    <AgentScopedProfileProvider key={agentId ?? 'unscoped'}>{children}</AgentScopedProfileProvider>
  );
});

export default ProfileProvider;
