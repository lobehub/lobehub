import { describe, expect, it } from 'vitest';

import {
  getDefaultMemberAssignee,
  hasWorkspaceMemberDirectory,
  resolveMemberAssignee,
  shouldShowMemberAssignee,
} from './memberAssigneeMode';

describe('memberAssigneeMode', () => {
  it('keeps an existing personal self-assignee visible without a workspace directory', () => {
    expect(shouldShowMemberAssignee(undefined, 'user-1')).toBe(true);
    expect(hasWorkspaceMemberDirectory(undefined)).toBe(false);
  });

  it('hides an empty member-assignee row in personal mode', () => {
    expect(shouldShowMemberAssignee(undefined, undefined)).toBe(false);
  });

  it('shows the member-assignee row when a workspace directory is available', () => {
    expect(shouldShowMemberAssignee('workspace-1', undefined)).toBe(true);
    expect(hasWorkspaceMemberDirectory('workspace-1')).toBe(true);
  });

  it('defaults a workspace task to its creator when they can be an assignee', () => {
    const assignableMemberIds = new Set(['user-1']);
    expect(
      getDefaultMemberAssignee({
        activeWorkspaceId: 'workspace-1',
        assignableMemberIds,
        selfUserId: 'user-1',
      }),
    ).toBe('user-1');
  });

  it('leaves the member unassigned when the creator cannot be an assignee', () => {
    expect(
      getDefaultMemberAssignee({
        activeWorkspaceId: 'workspace-1',
        assignableMemberIds: new Set(['user-2']),
        selfUserId: 'user-1',
      }),
    ).toBeUndefined();
  });

  it('does not preselect a member in personal mode', () => {
    expect(
      getDefaultMemberAssignee({
        activeWorkspaceId: undefined,
        assignableMemberIds: new Set(['user-1']),
        selfUserId: 'user-1',
      }),
    ).toBeUndefined();
  });

  it('follows the default until the creator picks or clears a member', () => {
    expect(resolveMemberAssignee(undefined, 'user-1')).toBe('user-1');
    expect(resolveMemberAssignee('user-2', 'user-1')).toBe('user-2');
    expect(resolveMemberAssignee(null, 'user-1')).toBeUndefined();
  });
});
