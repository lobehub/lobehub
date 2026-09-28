import { describe, expect, it } from 'vitest';

import { hasWorkspaceMemberDirectory, shouldShowMemberAssignee } from './memberAssigneeMode';

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
});
