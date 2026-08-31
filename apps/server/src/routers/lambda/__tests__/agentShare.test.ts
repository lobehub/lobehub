// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockCreate = vi.fn();
const mockDeleteByAgentId = vi.fn();
const mockGetByAgentId = vi.fn();
const mockUpdateConfig = vi.fn();
const mockUpdateSlug = vi.fn();
const mockUpdateVisibility = vi.fn();

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: vi.fn(() => ({
    create: mockCreate,
    deleteByAgentId: mockDeleteByAgentId,
    getByAgentId: mockGetByAgentId,
    updateConfig: mockUpdateConfig,
    updateSlug: mockUpdateSlug,
    updateVisibility: mockUpdateVisibility,
  })),
}));

const { agentShareConfigPatchSchema, agentShareConfigSchema, agentShareRouter } =
  await import('../agentShare');

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
    mockUpdateSlug.mockResolvedValue({
      ...share,
      shareConfig: { ...share.shareConfig, slug: 'my-slug' },
    });
    mockUpdateVisibility.mockResolvedValue(share);
  });

  it('requires authentication for share management', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner());

    await expect(caller.getShareStatus({ agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(mockGetByAgentId).not.toHaveBeenCalled();
  });

  it('enables a private share by default', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.enableShare({ agentId: 'agent-1' })).resolves.toEqual(share);
    expect(mockCreate).toHaveBeenCalledWith('agent-1', undefined);
  });

  it('enables a share with an explicit visibility', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.enableShare({ agentId: 'agent-1', visibility: 'link' });
    expect(mockCreate).toHaveBeenCalledWith('agent-1', 'link');
  });

  it('returns null when a personal agent has no share', async () => {
    mockGetByAgentId.mockResolvedValue(null);
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.getShareStatus({ agentId: 'agent-1' })).resolves.toBeNull();
  });

  it('forwards an atomic share configuration patch', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));
    const config = { maxTopicsPerVisitor: 10 };

    await caller.updateShareConfig({ agentId: 'agent-1', config });

    expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', config);
  });

  it('rejects an empty share configuration patch', () => {
    expect(agentShareConfigPatchSchema.safeParse({}).success).toBe(false);
  });

  it('requires positive integer topic and turn limits', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 0 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTurnsPerTopic: 1.5 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('does not expose dropped v1 config fields in the config API', () => {
    expect(
      agentShareConfigSchema.safeParse({
        filePermissionConfig: { agentFiles: 'read' },
        maxTopicsPerVisitor: 5,
      }).success,
    ).toBe(false);
    expect(
      agentShareConfigSchema.safeParse({
        guestEnabled: true,
        maxTopicsPerVisitor: 5,
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

  it('updates the custom slug', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    const result = await caller.updateSlug({ agentId: 'agent-1', slug: 'my-slug' });

    expect(mockUpdateSlug).toHaveBeenCalledWith('agent-1', 'my-slug');
    expect(result.shareConfig).toMatchObject({ slug: 'my-slug' });
  });

  it('lower-cases and trims the slug input before forwarding it', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.updateSlug({ agentId: 'agent-1', slug: '  My-Slug  ' });

    expect(mockUpdateSlug).toHaveBeenCalledWith('agent-1', 'my-slug');
  });

  it('rejects an obviously too-short slug before reaching the model', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.updateSlug({ agentId: 'agent-1', slug: 'ab' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockUpdateSlug).not.toHaveBeenCalled();
  });

  it('propagates a slug conflict as CONFLICT', async () => {
    mockUpdateSlug.mockRejectedValue(
      new TRPCError({ code: 'CONFLICT', message: 'SHARE_SLUG_TAKEN' }),
    );
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateSlug({ agentId: 'agent-1', slug: 'taken-slug' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('returns NOT_FOUND when an existing share is required', async () => {
    mockDeleteByAgentId.mockResolvedValue(null);
    mockUpdateConfig.mockResolvedValue(null);
    mockUpdateVisibility.mockResolvedValue(null);
    mockUpdateSlug.mockResolvedValue(null);
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.disableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 5 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.updateSlug({ agentId: 'agent-1', slug: 'my-slug' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
