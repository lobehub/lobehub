// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import {
  assertCanPerformResourceAction,
  canPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';
import { TrashService } from '@/server/services/trash';
import {
  hasWorkspaceScopedPermission,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { lifecycleRouter } from './lifecycle';

// Only the creator-name lookup reads the db directly: select → from → where → limit.
const creatorRows = vi.hoisted(() => ({
  rows: [] as { fullName: string | null; username: string | null }[],
}));
vi.mock('@/database/core/db-adaptor', () => {
  const chain: any = {
    from: () => chain,
    limit: () => Promise.resolve(creatorRows.rows),
    where: () => chain,
  };
  return { getServerDB: vi.fn(() => ({ select: () => chain })) };
});
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
  canPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));

/** `delete` follows the resource rule (author / Owner); `manage` also admits Admins. */
const grantActions = (actions: string[]) =>
  vi
    .mocked(canPerformResourceAction)
    .mockImplementation(async ({ action }) => actions.includes(action));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
  isWorkspacePrimaryOwner: vi.fn(),
}));

const userId = 'user-1';
const agentId = 'agent-1';
const workspaceId = 'ws-1';

describe('lifecycleRouter.removeAgent', () => {
  let getAgentVisibilityMeta: ReturnType<typeof vi.fn>;
  let getDeleteImpact: ReturnType<typeof vi.fn>;
  let trashAgent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getAgentVisibilityMeta = vi.fn().mockResolvedValue({ slug: null });
    getDeleteImpact = vi.fn().mockResolvedValue({ foreignTopicCount: 2, hasForeignContent: true });
    trashAgent = vi.fn().mockResolvedValue({ id: agentId });

    vi.mocked(AgentModel).mockImplementation(function () {
      return { getAgentVisibilityMeta, getDeleteImpact } as any;
    });
    vi.mocked(TrashService).mockImplementation(function () {
      return { trashAgent } as any;
    });
    vi.mocked(ResourceTransferRequestModel).mockImplementation(function () {
      return { invalidateForResources: vi.fn() } as any;
    });
    vi.mocked(assertCanPerformResourceAction).mockResolvedValue(undefined);
    grantActions(['delete', 'manage']);
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);
    vi.mocked(isWorkspacePrimaryOwner).mockResolvedValue(false);
  });

  const callRemove = (
    workspaceRole: string,
    acknowledgeForeignContent?: boolean,
    acknowledgeOtherCreator?: boolean,
  ) =>
    lifecycleRouter
      .createCaller({ userId, workspaceId, workspaceRole } as any)
      .removeAgent({ acknowledgeForeignContent, acknowledgeOtherCreator, agentId });

  it('refuses to delete a builtin agent (Lobe AI) in either scope', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({ userId, visibility: 'public', workspaceId });
    getAgentVisibilityMeta.mockResolvedValue({ slug: 'inbox' });

    await expect(callRemove('owner', true, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      lifecycleRouter.createCaller({ userId } as any).removeAgent({ agentId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(trashAgent).not.toHaveBeenCalled();
  });

  it("lets the agent's author delete it with teammates' topics once the impact is acknowledged", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({ userId, visibility: 'public', workspaceId });

    await expect(callRemove('member', true)).resolves.toEqual({ id: agentId });
    expect(trashAgent).toHaveBeenCalledWith(agentId);
    expect(getDeleteImpact).not.toHaveBeenCalled();
  });

  it("refuses the author when the caller never acknowledged teammates' content (CLI, agent tools, older clients)", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({ userId, visibility: 'public', workspaceId });

    await expect(callRemove('member')).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.OwnerOnly } },
      code: 'FORBIDDEN',
    });
    expect(trashAgent).not.toHaveBeenCalled();
  });

  it('lets the author delete without acknowledgment when nothing foreign rides along', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({ userId, visibility: 'public', workspaceId });
    getDeleteImpact.mockResolvedValue({ foreignTopicCount: 0, hasForeignContent: false });

    await expect(callRemove('member')).resolves.toEqual({ id: agentId });
  });

  describe("a workspace Admin deleting another member's agent", () => {
    beforeEach(() => {
      vi.mocked(getResourceMeta).mockResolvedValue({
        userId: 'user-2',
        visibility: 'public',
        workspaceId,
      });
      // AGENT_DELETE is `:owner`-scoped for Admins; `manage` comes from AGENT_UPDATE:all.
      grantActions(['manage']);
    });

    it('deletes once both the other-creator and the foreign-content warnings were acknowledged', async () => {
      await expect(callRemove('admin', true, true)).resolves.toEqual({ id: agentId });
      expect(trashAgent).toHaveBeenCalledWith(agentId);
    });

    it('deletes an agent with no foreign content after acknowledging only the other creator', async () => {
      getDeleteImpact.mockResolvedValue({ foreignTopicCount: 0, hasForeignContent: false });

      await expect(callRemove('admin', false, true)).resolves.toEqual({ id: agentId });
    });

    it('refuses without the other-creator acknowledgment (CLI, agent tools, older clients)', async () => {
      await expect(callRemove('admin', true)).rejects.toMatchObject({
        cause: { data: { code: TransferErrorCode.OwnerOnly } },
        code: 'FORBIDDEN',
      });
      expect(trashAgent).not.toHaveBeenCalled();
    });

    it("refuses when other members' content was not acknowledged", async () => {
      await expect(callRemove('admin', false, true)).rejects.toMatchObject({
        cause: { data: { code: TransferErrorCode.OwnerOnly } },
        code: 'FORBIDDEN',
      });
      expect(trashAgent).not.toHaveBeenCalled();
    });

    it('refuses a private agent the Admin cannot manage', async () => {
      grantActions([]);

      await expect(callRemove('admin', true, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(trashAgent).not.toHaveBeenCalled();
    });
  });

  it("refuses a member deleting someone else's agent even with every acknowledgment", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'user-2',
      visibility: 'public',
      workspaceId,
    });
    grantActions([]);

    await expect(callRemove('member', true, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(trashAgent).not.toHaveBeenCalled();
  });

  it("lets a workspace owner delete someone else's agent with teammates' content", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'user-2',
      visibility: 'public',
      workspaceId,
    });

    await expect(callRemove('owner')).resolves.toEqual({ id: agentId });
    expect(getDeleteImpact).not.toHaveBeenCalled();
  });
});

describe('lifecycleRouter.getAgentDeleteImpact', () => {
  let getDeleteImpact: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getDeleteImpact = vi.fn().mockResolvedValue({ foreignTopicCount: 3, hasForeignContent: true });
    vi.mocked(AgentModel).mockImplementation(function () {
      return {
        getAgentVisibilityMeta: vi.fn().mockResolvedValue({ slug: null }),
        getDeleteImpact,
      } as any;
    });
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);
  });

  it('is gated by the delete permission in a workspace', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({ userId, visibility: 'public', workspaceId });
    grantActions(['delete']);

    const result = await lifecycleRouter
      .createCaller({ userId, workspaceId, workspaceRole: 'member' } as any)
      .getAgentDeleteImpact({ agentId });

    expect(result).toEqual({
      createdByOther: false,
      creatorName: null,
      foreignTopicCount: 3,
      hasForeignContent: true,
    });
    expect(canPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resourceId: agentId, resourceType: 'agent' }),
    );
  });

  it("names the creator when an Admin looks at another member's agent", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'user-2',
      visibility: 'public',
      workspaceId,
    });
    grantActions(['manage']);
    creatorRows.rows = [{ fullName: '速冻鱼', username: 'fish' }];

    const result = await lifecycleRouter
      .createCaller({ userId, workspaceId, workspaceRole: 'admin' } as any)
      .getAgentDeleteImpact({ agentId });

    expect(result).toEqual({
      createdByOther: true,
      creatorName: '速冻鱼',
      foreignTopicCount: 3,
      hasForeignContent: true,
    });
  });

  it("refuses a member looking at someone else's agent", async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'user-2',
      visibility: 'public',
      workspaceId,
    });
    grantActions(['manage']);

    await expect(
      lifecycleRouter
        .createCaller({ userId, workspaceId, workspaceRole: 'member' } as any)
        .getAgentDeleteImpact({ agentId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports nothing foreign in personal scope', async () => {
    const result = await lifecycleRouter
      .createCaller({ userId } as any)
      .getAgentDeleteImpact({ agentId });

    expect(result).toEqual({
      createdByOther: false,
      creatorName: null,
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
    expect(getDeleteImpact).not.toHaveBeenCalled();
  });
});
