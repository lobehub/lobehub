import type { UserItem, WorkspaceMemberItem } from '@lobechat/database/schemas';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';

export type WorkspaceMemberWithUser = WorkspaceMemberItem &
  Pick<UserItem, 'email' | 'normalizedEmail' | 'username'>;

export const useWorkspaceMembers = (): WorkspaceMemberWithUser[] => {
  const workspaceId = useActiveWorkspaceId();
  const { data = [] } = useSWR(
    workspaceId ? ['business/workspace-members', workspaceId] : null,
    () => lambdaClient.workspaceMember.list.query({ workspaceId: workspaceId! }),
  );

  return data;
};
