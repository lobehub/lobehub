import type { WorkspaceMemberItem } from '@lobechat/database/schemas';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';

export const useWorkspaceMembers = (): WorkspaceMemberItem[] => {
  const workspaceId = useActiveWorkspaceId();
  const { data = [] } = useSWR(
    workspaceId ? ['business/workspace-members', workspaceId] : null,
    () => lambdaClient.workspaceMember.list.query({ workspaceId: workspaceId! }),
  );

  return data;
};
