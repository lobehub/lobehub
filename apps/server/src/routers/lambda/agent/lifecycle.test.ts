// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import {
  assertCanPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';
import { TrashService } from '@/server/services/trash';
import {
  hasWorkspaceScopedPermission,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { lifecycleRouter } from './lifecycle';

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
vi.mock('@/server/services/trash', () => ({ TrashService: vi.fn() }));
vi.mock('@/database/models/resourceTransferRequest', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  ResourceTransferRequestModel: vi.fn(),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
  isWorkspacePrimaryOwner: vi.fn(),
}));

const userId = 'user-1';
const agentId = 'agent-1';
const workspaceId = 'ws-1';

describe('lifecycleRouter.removeAgent', () => {
  let transferHasForeignRows: ReturnType<typeof vi.fn>;
  let trashAgent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    transferHasForeignRows = vi.fn().mockResolvedValue(true);
    trashAgent = vi.fn().mockResolvedValue({ id: agentId });

    vi.mocked(AgentModel).mockImplementation(function () {
      return { transferHasForeignRows } as any;
    });
    vi.mocked(TrashService).mockImplementation(function () {
      return { trashAgent } as any;
    });
    vi.mocked(ResourceTransferRequestModel).mockImplementation(function () {
      return { invalidateForResources: vi.fn() } as any;
    });
    vi.mocked(assertCanPerformResourceAction).mockResolvedValue(undefined);
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);
    vi.mocked(isWorkspacePrimaryOwner).mockResolvedValue(false);
  });

  const callRemove = (workspaceRole: string) =>
    lifecycleRouter
      .createCaller({ userId, workspaceId, workspaceRole } as any)
      .removeAgent({ agentId });

  it("lets the agent's author delete it even when it carries teammates' topics", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({ userId, visibility: 'public', workspaceId });

    await expect(callRemove('member')).resolves.toEqual({ id: agentId });
    expect(trashAgent).toHaveBeenCalledWith(agentId);
    expect(transferHasForeignRows).not.toHaveBeenCalled();
  });

  it("still refuses a non-owner admin deleting someone else's agent with teammates' content", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'user-2',
      visibility: 'public',
      workspaceId,
    });

    await expect(callRemove('admin')).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.OwnerOnly } },
      code: 'FORBIDDEN',
    });
    expect(trashAgent).not.toHaveBeenCalled();
  });

  it("lets a workspace owner delete someone else's agent with teammates' content", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'user-2',
      visibility: 'public',
      workspaceId,
    });

    await expect(callRemove('owner')).resolves.toEqual({ id: agentId });
    expect(transferHasForeignRows).not.toHaveBeenCalled();
  });
});

describe('lifecycleRouter.getAgentDeleteImpact', () => {
  let getDeleteImpact: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getDeleteImpact = vi.fn().mockResolvedValue({ foreignTopicCount: 3, hasForeignContent: true });
    vi.mocked(AgentModel).mockImplementation(function () {
      return { getDeleteImpact } as any;
    });
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);
  });

  it('is gated by the delete permission in a workspace', async () => {
    vi.mocked(assertCanPerformResourceAction).mockResolvedValue(undefined);

    const result = await lifecycleRouter
      .createCaller({ userId, workspaceId, workspaceRole: 'member' } as any)
      .getAgentDeleteImpact({ agentId });

    expect(result).toEqual({ foreignTopicCount: 3, hasForeignContent: true });
    expect(assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resourceId: agentId, resourceType: 'agent' }),
    );
  });

  it('reports nothing foreign in personal scope', async () => {
    const result = await lifecycleRouter
      .createCaller({ userId } as any)
      .getAgentDeleteImpact({ agentId });

    expect(result).toEqual({ foreignTopicCount: 0, hasForeignContent: false });
    expect(getDeleteImpact).not.toHaveBeenCalled();
  });
});
