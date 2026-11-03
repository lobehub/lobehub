// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { agentSignalSkillManagementRuntime } from '../agentSignalSkillManagement';

vi.mock('@/server/services/skillManagement');

describe('agentSignalSkillManagementRuntime', () => {
  it('throws if required server context is missing', () => {
    expect(() =>
      agentSignalSkillManagementRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      }),
    ).toThrow('agent-signal-skill-management requires agentId, userId and serverDB');
  });

  it('threads the workspaceId into the skill document service so writes stay workspace-scoped', () => {
    agentSignalSkillManagementRuntime.factory({
      agentId: 'agent-1',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(SkillManagementDocumentService).toHaveBeenCalledWith({}, 'user-1', 'ws-1');
  });
});
