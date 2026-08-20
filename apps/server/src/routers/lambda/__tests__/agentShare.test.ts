// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockCreate = vi.fn();
const mockDeleteByAgentId = vi.fn();
const mockGetByAgentId = vi.fn();
const mockUpdateConfig = vi.fn();
const mockUpdateVisibility = vi.fn();

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: vi.fn(() => ({
    create: mockCreate,
    deleteByAgentId: mockDeleteByAgentId,
    getByAgentId: mockGetByAgentId,
    updateConfig: mockUpdateConfig,
    updateVisibility: mockUpdateVisibility,
  })),
}));

const { agentShareConfigSchema, agentShareRouter } = await import('../agentShare');

const share = {
  agentId: 'agent-1',
  id: 'share-1',
  shareConfig: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 20 },
  visibility: 'private',
};

describe('agentShareRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(share);
    mockDeleteByAgentId.mockResolvedValue(share);
    mockGetByAgentId.mockResolvedValue(share);
    mockUpdateConfig.mockResolvedValue(share);
    mockUpdateVisibility.mockResolvedValue(share);
  });

  it('requires authentication for share management', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner());

    await expect(caller.getShareStatus({ agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(mockGetByAgentId).not.toHaveBeenCalled();
  });

  it('enables a private share through the model default', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.enableShare({ agentId: 'agent-1' })).resolves.toEqual(share);
    expect(mockCreate).toHaveBeenCalledWith('agent-1');
  });

  it('returns null when a personal agent has no share', async () => {
    mockGetByAgentId.mockResolvedValue(null);
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.getShareStatus({ agentId: 'agent-1' })).resolves.toBeNull();
  });

  it('forwards a complete share configuration', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));
    const config = {
      allowReadMemory: true,
      enabledToolIds: ['search'],
      filePermissionConfig: {
        agentFiles: 'read' as const,
        knowledgeBase: 'read' as const,
        uploadAllowed: true,
      },
      maxTopicsPerVisitor: 10,
      maxTurnsPerTopic: 40,
    };

    await caller.updateShareConfig({ agentId: 'agent-1', config });

    expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', config);
  });

  it('requires positive integer topic and turn limits', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 0, maxTurnsPerTopic: 20 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 1.5 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('does not expose anonymous or amount controls in the v1 config API', () => {
    expect(
      agentShareConfigSchema.safeParse({
        guestEnabled: true,
        maxTopicsPerVisitor: 5,
        maxTurnsPerTopic: 20,
      }).success,
    ).toBe(false);
    expect(
      agentShareConfigSchema.safeParse({
        maxAmountPerVisitor: 1,
        maxTopicsPerVisitor: 5,
        maxTurnsPerTopic: 20,
      }).success,
    ).toBe(false);
  });

  it('updates visibility and disables an existing share', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.updateVisibility({ agentId: 'agent-1', visibility: 'link' });
    await caller.disableShare({ agentId: 'agent-1' });

    expect(mockUpdateVisibility).toHaveBeenCalledWith('agent-1', 'link');
    expect(mockDeleteByAgentId).toHaveBeenCalledWith('agent-1');
  });

  it('returns NOT_FOUND when an existing share is required', async () => {
    mockDeleteByAgentId.mockResolvedValue(null);
    mockUpdateConfig.mockResolvedValue(null);
    mockUpdateVisibility.mockResolvedValue(null);
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.disableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 20 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
