import type { WorkspaceApiKeyMemberCreation } from '@lobechat/types';
import { createContext, useContext } from 'react';

export interface WorkspaceApiKeyPolicy {
  canCreate: boolean;
  isAdmin: boolean;
  memberCreation: WorkspaceApiKeyMemberCreation;
}

/**
 * Defaults describe a plain workspace member, matching what the server assumes
 * when no deployment resolves workspace roles: admin-only affordances (the
 * creator column, other members' keys) stay hidden, while creation stays open
 * because `all_members` is also the server-side default policy. A deployment
 * that resolves real roles provides this context instead.
 */
export const WorkspaceApiKeyPolicyContext = createContext<WorkspaceApiKeyPolicy>({
  canCreate: true,
  isAdmin: false,
  memberCreation: 'all_members',
});

export const useWorkspaceApiKeyPolicy = () => useContext(WorkspaceApiKeyPolicyContext);
