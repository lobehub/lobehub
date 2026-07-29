'use client';

export interface CommunityWorkspaceMember {
  accountId: number;
  avatarUrl: string | null;
  createdAt: string;
  displayName: string | null;
  namespace: string | null;
  role: 'admin' | 'member';
  userName: string | null;
}

export interface CommunityWorkspaceMembersState {
  canSync: boolean;
  isLoading: boolean;
  members: CommunityWorkspaceMember[];
  refresh: () => Promise<void>;
}

export const useCommunityWorkspaceMembers = (): CommunityWorkspaceMembersState => ({
  canSync: false,
  isLoading: false,
  members: [],
  refresh: async () => {},
});
