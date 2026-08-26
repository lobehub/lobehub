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
const mockGetAgentConfigById = vi.fn();

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: vi.fn(() => ({
    create: mockCreate,
    deleteByAgentId: mockDeleteByAgentId,
    getByAgentId: mockGetByAgentId,
    updateConfig: mockUpdateConfig,
    updateVisibility: mockUpdateVisibility,
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    getAgentConfigById: mockGetAgentConfigById,
  })),
}));

const mockInterruptActiveShareRuns = vi.fn().mockResolvedValue(undefined);

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({
    interruptActiveShareRuns: mockInterruptActiveShareRuns,
  })),
}));

// `after()` schedules its callback fire-and-forget in production. Tests run
// it eagerly (and await it below) so revocation's interrupt side effect is
// observable without racing the assertion.
const afterTasks: Promise<unknown>[] = [];
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => Promise<unknown> | unknown) => {
    afterTasks.push(Promise.resolve(work()));
  },
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
    afterTasks.length = 0;
    mockInterruptActiveShareRuns.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue(share);
    // `deleteByAgentId` / `updateVisibility` / `updateConfig` all return
    // `{ share, revocationGeneration? }` now — see `ShareMutationResult`'s
    // JSDoc on `AgentShareModel`. `revocationGeneration: 2` mirrors an actual
    // revocation bump; individual tests override this where the distinction
    // (bumped vs. not) matters.
    mockDeleteByAgentId.mockResolvedValue({ revocationGeneration: 2, share });
    mockGetByAgentId.mockResolvedValue(share);
    mockUpdateConfig.mockResolvedValue({ share });
    mockUpdateVisibility.mockResolvedValue({ share });
    mockGetAgentConfigById.mockResolvedValue({ agencyConfig: null, model: 'gpt-4o' });
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

  // Regression for LOBE-11930: revoking a share (link -> private, or
  // disabling it outright) must proactively interrupt any visitor run that
  // is still executing, not just stop authorizing future cancellation —
  // see `AiAgentService.interruptActiveShareRuns`.
  describe('revocation interrupts active visitor runs', () => {
    it('interrupts active runs when flipping link -> private', async () => {
      // `updateVisibility` only bumps the generation on a transition INTO
      // `private` (a tightening) — see `AgentShareModel.updateVisibility`.
      mockUpdateVisibility.mockResolvedValue({ revocationGeneration: 3, share });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' });
      await Promise.all(afterTasks);

      expect(mockInterruptActiveShareRuns).toHaveBeenCalledWith('agent-1', 3);
    });

    it('does not interrupt anything when publishing (private -> link)', async () => {
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await caller.updateVisibility({ agentId: 'agent-1', visibility: 'link' });
      await Promise.all(afterTasks);

      expect(mockInterruptActiveShareRuns).not.toHaveBeenCalled();
    });

    it('interrupts active runs when disabling a share outright', async () => {
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await caller.disableShare({ agentId: 'agent-1' });
      await Promise.all(afterTasks);

      // `deleteByAgentId` always bumps the generation (see its JSDoc) — the
      // `beforeEach` default mock stubs it at `2`.
      expect(mockInterruptActiveShareRuns).toHaveBeenCalledWith('agent-1', 2);
    });

    it('does not interrupt anything when the revoking mutation itself fails', async () => {
      mockUpdateVisibility.mockResolvedValue({ share: null });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(
        caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await Promise.all(afterTasks);

      expect(mockInterruptActiveShareRuns).not.toHaveBeenCalled();
    });
  });

  it('returns NOT_FOUND when an existing share is required', async () => {
    mockDeleteByAgentId.mockResolvedValue({ share: null });
    mockUpdateConfig.mockResolvedValue({ share: null });
    mockUpdateVisibility.mockResolvedValue({ share: null });
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

  // A share published for a heterogeneous agent looks live in the owner's
  // settings but the server unconditionally rejects every visitor send
  // against it (`ShareHeterogeneousAgentUnsupported`, see
  // `AiAgentService.execAgent`) — these mutations must fail-closed before
  // that state can be reached at all, regardless of which client path (tab
  // switcher or direct route) triggered them.
  //
  // Only `enableShare` still runs its check here in the router, via a
  // pre-lock `getAgentConfigById` read (`enableShare` only ever creates a
  // `private` share, so a stale read is harmless). `updateVisibility('link')`
  // used to run the same kind of pre-lock check here too, but that made it
  // vulnerable to a race with `AgentModel.updateConfig` (see LOBE-11930):
  // the check could pass, `updateConfig` could reset a share to `private` in
  // between, and this call would still flip it back to `link`. That check now
  // lives in `AgentShareModel.updateVisibility` itself, re-read from the
  // Agent row AFTER the row lock is held — see the model's JSDoc, the
  // real-Postgres coverage in `agentShare.test.ts`, and the concurrent
  // regression test in `agentShare.publish.race.test.ts`.
  describe('heterogeneous agent share gate', () => {
    it('rejects enableShare for an agent pinned via agencyConfig.heterogeneousProvider', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        model: 'claude-code',
      });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(caller.enableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'ShareHeterogeneousAgentUnsupported',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects enableShare for a legacy bare heterogeneous model id', async () => {
      mockGetAgentConfigById.mockResolvedValue({ agencyConfig: null, model: 'codex' });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(caller.enableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'ShareHeterogeneousAgentUnsupported',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('forwards updateVisibility(link) straight to the model without a pre-lock check', async () => {
      // getAgentConfigById is intentionally NOT consulted for updateVisibility
      // any more — the model re-checks under its own row lock instead.
      mockGetAgentConfigById.mockResolvedValue({
        agencyConfig: { heterogeneousProvider: { type: 'codex' } },
        model: 'codex',
      });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(
        caller.updateVisibility({ agentId: 'agent-1', visibility: 'link' }),
      ).resolves.toEqual(share);
      expect(mockGetAgentConfigById).not.toHaveBeenCalled();
      expect(mockUpdateVisibility).toHaveBeenCalledWith('agent-1', 'link');
    });

    it('still allows reverting a heterogeneous agent share back to private', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        agencyConfig: { heterogeneousProvider: { type: 'codex' } },
        model: 'codex',
      });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(
        caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' }),
      ).resolves.toEqual(share);
      expect(mockUpdateVisibility).toHaveBeenCalledWith('agent-1', 'private');
    });
  });
});
