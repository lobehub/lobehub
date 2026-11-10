import { canWorkspaceRoleBeTaskAssignee } from '@lobechat/const/rbac';
import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { getDefaultMemberAssignee } from './memberAssigneeMode';

/** Members whose workspace role lets them be a task assignee, plus the creator's default. */
export const useDefaultMemberAssignee = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const { isLoading: isMembersLoading } = useFetchWorkspaceMembers();
  const workspaceMembers = useWorkspaceMembers();
  const selfUserId = useUserStore(userProfileSelectors.userId);

  const assignableMemberIds = useMemo(
    () =>
      new Set(
        workspaceMembers
          .filter((member) => canWorkspaceRoleBeTaskAssignee(member.role))
          .map((member) => member.userId),
      ),
    [workspaceMembers],
  );

  const defaultMemberAssignee = useMemo(
    () => getDefaultMemberAssignee({ activeWorkspaceId, assignableMemberIds, selfUserId }),
    [activeWorkspaceId, assignableMemberIds, selfUserId],
  );

  // Until a workspace's member directory first loads, the default is unknown:
  // creating then would silently drop the creator's assignment.
  const isDefaultMemberPending = Boolean(activeWorkspaceId) && isMembersLoading;

  return { assignableMemberIds, defaultMemberAssignee, isDefaultMemberPending, isMembersLoading };
};
