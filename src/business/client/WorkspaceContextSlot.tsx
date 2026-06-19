import { type PropsWithChildren } from 'react';

import { useWorkspaceUrlSync } from '@/features/Workspace/useWorkspaceUrlSync';

import { useActiveWorkspaceId } from './hooks/useActiveWorkspaceId';

export default function WorkspaceContextSlot({ children }: PropsWithChildren) {
  const activeWorkspaceId = useActiveWorkspaceId();
  useWorkspaceUrlSync();

  return (
    <div key={activeWorkspaceId ?? 'personal'} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
