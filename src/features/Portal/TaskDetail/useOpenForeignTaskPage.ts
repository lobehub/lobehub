import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';

/**
 * Leave the read-only panel for the task's own page in its workspace. The panel
 * closes first: left open, the destination page would show the same task twice,
 * once editable and once behind the "read-only here" notice.
 */
export const useOpenForeignTaskPage = () => {
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return useCallback(
    (pagePath: string) => {
      clearPortalStack();
      navigate(pagePath, { escape: true });
    },
    [clearPortalStack, navigate],
  );
};
