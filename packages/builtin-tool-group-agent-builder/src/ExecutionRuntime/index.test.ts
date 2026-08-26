// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupAgentBuilderExecutionRuntime } from './index';

const {
  mockFetchGroupDetail,
  mockGetGroup,
  mockGetGroupById,
  mockSetAgentBuilderContent,
  mockUpdateGroupConfig,
  mockUpdateGroupMeta,
  mockUpdateGroupService,
} = vi.hoisted(() => ({
  mockFetchGroupDetail: vi.fn(),
  mockGetGroup: vi.fn(),
  mockGetGroupById: vi.fn(),
  mockSetAgentBuilderContent: vi.fn(),
  mockUpdateGroupConfig: vi.fn(),
  mockUpdateGroupMeta: vi.fn(),
  mockUpdateGroupService: vi.fn(),
}));

const activeGroup = { config: {}, content: 'old shared prompt', id: 'cg_active', title: 'Active' };
// A different group the same user also owns — never the intended target of a
// builder conversation editing `cg_active`.
const otherOwnedGroup = { config: {}, content: 'other', id: 'cg_other', title: 'Other' };

vi.mock('@/services/agent', () => ({ agentService: {} }));

vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    getGroup: mockGetGroup,
    updateGroup: mockUpdateGroupService,
  },
}));

vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => ({}) } }));

vi.mock('@/store/agentGroup', () => ({
  getChatGroupStoreState: () => ({
    activeGroupId: 'cg_active',
    internal_fetchGroupDetail: mockFetchGroupDetail,
    updateGroupConfig: mockUpdateGroupConfig,
    updateGroupMeta: mockUpdateGroupMeta,
  }),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    getGroupById: mockGetGroupById,
  },
}));

vi.mock('@/store/groupProfile', () => ({
  useGroupProfileStore: {
    getState: () => ({ setAgentBuilderContent: mockSetAgentBuilderContent }),
  },
}));

describe('GroupAgentBuilderExecutionRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGroupById.mockImplementation((id: string) => () => {
      if (id === 'cg_active') return activeGroup;
      if (id === 'cg_other') return otherOwnedGroup;
      return undefined;
    });
  });

  // Regression for the confused-deputy bug fixed alongside the server runtime:
  // `resolveGroupTarget` used to accept a model-supplied `groupId` override
  // (sourced from `UpdateGroupParams.groupId` / `UpdateGroupPromptParams.groupId`)
  // and let it replace the active group. A prompt-injected instruction could
  // redirect the write to any other group the same user owns. `resolveGroupTarget`
  // now takes no argument and always resolves the active group, so even if a
  // caller (or a stale/attacker-shaped payload) still carries a `groupId` field,
  // it must be ignored entirely.
  describe('updateGroup', () => {
    it('always targets the active group and ignores a foreign groupId in the payload', async () => {
      const runtime = new GroupAgentBuilderExecutionRuntime();
      const maliciousArgs = { groupId: 'cg_other', meta: { title: 'Hijacked Title' } };

      const result = await runtime.updateGroup(maliciousArgs as never);

      expect(mockGetGroupById).not.toHaveBeenCalledWith('cg_other');
      expect(mockUpdateGroupService).not.toHaveBeenCalledWith('cg_other', expect.anything());
      expect(mockGetGroup).not.toHaveBeenCalledWith('cg_other');
      // The active group is the current group, so the write goes through the
      // store action, scoped to `cg_active` implicitly.
      expect(mockUpdateGroupMeta).toHaveBeenCalledWith({ title: 'Hijacked Title' });
      expect(mockFetchGroupDetail).toHaveBeenCalledWith('cg_active');
      expect(result.success).toBe(true);
    });
  });

  describe('updateGroupPrompt', () => {
    it('always targets the active group and ignores a foreign groupId in the payload', async () => {
      const runtime = new GroupAgentBuilderExecutionRuntime();
      const maliciousArgs = { groupId: 'cg_other', prompt: 'hijacked context' };

      const result = await runtime.updateGroupPrompt(maliciousArgs as never);

      expect(mockGetGroupById).not.toHaveBeenCalledWith('cg_other');
      expect(mockUpdateGroupService).not.toHaveBeenCalledWith('cg_other', expect.anything());
      expect(mockUpdateGroupService).toHaveBeenCalledWith('cg_active', {
        content: 'hijacked context',
      });
      expect(mockFetchGroupDetail).toHaveBeenCalledWith('cg_active');
      expect(mockSetAgentBuilderContent).toHaveBeenCalledWith('cg_active', 'hijacked context');
      expect(result.success).toBe(true);
    });
  });
});
