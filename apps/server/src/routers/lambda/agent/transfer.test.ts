// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import {
  hasWorkspaceScopedPermission,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';

import { transferRouter } from './transfer';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@/database/models/agent', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  AgentModel: vi.fn(),
}));
vi.mock('@/database/models/chatGroup', () => ({ ChatGroupModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/models/session', () => ({ SessionModel: vi.fn() }));
vi.mock('@/server/services/agent', () => ({ AgentService: vi.fn() }));
vi.mock('@/database/models/resourcePermission', () => ({ ResourcePermissionModel: vi.fn() }));
vi.mock('@/database/models/resourceTransferRequest', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  ResourceTransferRequestModel: vi.fn(),
}));
vi.mock('@/business/server/agent-transfer/jobRunner', () => ({
  prioritizeAgentTransferTopic: vi.fn(),
  startAgentTransferJob: vi.fn(),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
}));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
  isWorkspacePrimaryOwner: vi.fn(),
}));

/** Wraps a mock so it records the peak number of concurrent in-flight calls. */
const trackInFlight = <T>(result: (id: string) => T) => {
  const state = { inFlight: 0, peak: 0 };
  const fn = vi.fn(async (...args: any[]) => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    state.inFlight -= 1;
    return result(args.find((arg) => typeof arg === 'string' && arg.startsWith('agent-')));
  });
  return { fn, state };
};

describe('transferRouter.transferAgents', () => {
  const userId = 'user-1';
  const agentIds = Array.from({ length: 12 }, (_, i) => `agent-${i}`);

  let existsById: ReturnType<typeof trackInFlight<boolean>>;
  let assertTransfer: ReturnType<typeof trackInFlight<void>>;
  let removeAll: ReturnType<typeof trackInFlight<void>>;
  let setAccessLevel: ReturnType<typeof trackInFlight<void>>;
  let transferAgents: ReturnType<typeof vi.fn>;
  let invalidateForResources: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    existsById = trackInFlight(() => true);
    assertTransfer = trackInFlight(() => undefined);
    removeAll = trackInFlight(() => undefined);
    setAccessLevel = trackInFlight(() => undefined);
    transferAgents = vi.fn(async (ids: string[]) => ids.map((id) => ({ id })));
    invalidateForResources = vi.fn();

    vi.mocked(AgentModel).mockImplementation(function () {
      return { existsById: existsById.fn, transferAgents } as any;
    });
    vi.mocked(ResourcePermissionModel).mockImplementation(function (_db: any, workspaceId: any) {
      return workspaceId === 'ws-source'
        ? ({ removeAll: removeAll.fn } as any)
        : ({ setAccessLevel: setAccessLevel.fn } as any);
    });
    vi.mocked(ResourceTransferRequestModel).mockImplementation(function () {
      return { invalidateForResources } as any;
    });
    vi.mocked(assertCanPerformResourceAction).mockImplementation(assertTransfer.fn as any);
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);
    vi.mocked(isWorkspacePrimaryOwner).mockResolvedValue(true);
  });

  const callTransfer = () =>
    transferRouter.createCaller({ userId, workspaceId: 'ws-source' } as any).transferAgents({
      agentIds,
      targetVisibility: 'public',
      targetWorkspaceId: 'ws-target',
    });

  it('checks and rehomes every agent with a bounded per-agent fan-out', async () => {
    const result = await callTransfer();

    expect(result).toEqual(agentIds.map((id) => ({ id })));
    expect(transferAgents).toHaveBeenCalledWith(
      agentIds,
      'ws-target',
      userId,
      'public',
      expect.any(Object),
    );
    expect(invalidateForResources).toHaveBeenCalledWith('agent', agentIds);

    for (const tracked of [existsById, assertTransfer, removeAll, setAccessLevel]) {
      expect(tracked.fn).toHaveBeenCalledTimes(agentIds.length);
      expect(tracked.state.peak).toBeGreaterThan(1);
      expect(tracked.state.peak).toBeLessThanOrEqual(5);
    }
    expect(existsById.fn.mock.calls.map(([id]) => id)).toEqual(agentIds);
    expect(setAccessLevel.fn).toHaveBeenCalledWith('agent', 'agent-0', 'edit', userId);
  });

  it('still attempts every target ACL write after the commit when one fails', async () => {
    const failure = new Error('acl write failed');
    setAccessLevel.fn.mockImplementation(async (_type: string, agentId: string) => {
      if (agentId === 'agent-0') throw failure;
    });

    await expect(callTransfer()).rejects.toThrow('acl write failed');
    expect(transferAgents).toHaveBeenCalledTimes(1);
    expect(setAccessLevel.fn).toHaveBeenCalledTimes(agentIds.length);
  });

  it('still attempts every source ACL cleanup after the commit when one fails', async () => {
    removeAll.fn.mockImplementation(async (_type: string, agentId: string) => {
      if (agentId === 'agent-0') throw new Error('cleanup failed');
    });

    await expect(callTransfer()).rejects.toThrow('cleanup failed');
    expect(removeAll.fn).toHaveBeenCalledTimes(agentIds.length);
  });

  it('rejects with NOT_FOUND when any agent is missing, before transferring', async () => {
    existsById.fn.mockImplementation(async (id: string) => id !== 'agent-7');

    await expect(callTransfer()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transferAgents).not.toHaveBeenCalled();
  });
});
