import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';

import type {
  ListNightlyReviewAgentTargetsInput,
  ListNightlyReviewEligibleUsersInput,
  NightlyReviewAgentTarget,
  NightlyReviewEligibleUser,
} from '../schedule';
import {
  buildNightlyReviewSourceId,
  createSelfReviewScheduleService,
  createServerNightlyReviewScheduleService,
} from '../schedule';

const mocks = vi.hoisted(() => ({
  enqueueAgentSignalSourceEvent: vi.fn(),
  listActiveAgentTargets: vi.fn(),
  listEligibleUsers: vi.fn(),
  modelConstructor: vi.fn(),
}));

vi.mock('@/database/models/agentSignal/nightlyReview', () => ({
  AgentSignalNightlyReviewModel: mocks.modelConstructor.mockImplementation(() => ({
    listActiveAgentTargets: mocks.listActiveAgentTargets,
    listEligibleUsers: mocks.listEligibleUsers,
  })),
}));

vi.mock('@/server/services/agentSignal/emitter', () => ({
  enqueueAgentSignalSourceEvent: mocks.enqueueAgentSignalSourceEvent,
}));

const createDeps = (now: Date) => ({
  enqueueSource: vi
    .fn<
      (input: AgentSignalSourceEventInput<'agent.nightly_review.requested'>) => Promise<unknown>
    >()
    .mockResolvedValue(undefined),
  listActiveAgentTargets: vi
    .fn<(input: ListNightlyReviewAgentTargetsInput) => Promise<NightlyReviewAgentTarget[]>>()
    .mockResolvedValue([{ agentId: 'agent-1' }]),
  listEligibleUsers: vi
    .fn<(input?: ListNightlyReviewEligibleUsersInput) => Promise<NightlyReviewEligibleUser[]>>()
    .mockResolvedValue([
      {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        id: 'user-1',
        timezone: 'Asia/Shanghai',
      },
    ]),
  now: () => now,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nightlyReviewScheduleService', () => {
  describe('dispatchNightlyReviewRequests', () => {
    it('enqueues Shanghai user nightly review sources with previous full local day window', async () => {
      const deps = createDeps(new Date('2026-05-03T18:30:00.000Z'));
      const service = createSelfReviewScheduleService(deps);

      const summary = await service.dispatchNightlyReviewRequests();

      expect(summary).toEqual({ enqueued: 1, skipped: 0 });
      expect(deps.listActiveAgentTargets).toHaveBeenCalledWith({
        limit: undefined,
        userId: 'user-1',
        windowEnd: new Date('2026-05-03T16:00:00.000Z'),
        windowStart: new Date('2026-05-02T16:00:00.000Z'),
      });
      expect(deps.enqueueSource).toHaveBeenCalledWith({
        payload: {
          agentId: 'agent-1',
          localDate: '2026-05-03',
          requestedAt: '2026-05-03T18:30:00.000Z',
          reviewWindowEnd: '2026-05-03T16:00:00.000Z',
          reviewWindowStart: '2026-05-02T16:00:00.000Z',
          timezone: 'Asia/Shanghai',
          userId: 'user-1',
        },
        sourceId: 'nightly-review:user-1:agent-1:2026-05-03',
        sourceType: 'agent.nightly_review.requested',
        timestamp: new Date('2026-05-03T18:30:00.000Z').getTime(),
      });
    });

    it('skips users outside the local night window without enqueueing', async () => {
      const deps = createDeps(new Date('2026-05-03T20:30:00.000Z'));
      const service = createSelfReviewScheduleService(deps);

      const summary = await service.dispatchNightlyReviewRequests();

      expect(summary).toEqual({ enqueued: 0, skipped: 1 });
      expect(deps.listActiveAgentTargets).not.toHaveBeenCalled();
      expect(deps.enqueueSource).not.toHaveBeenCalled();
    });

    it('falls back to UTC for invalid timezone values without throwing', async () => {
      const deps = createDeps(new Date('2026-05-04T02:30:00.000Z'));
      deps.listEligibleUsers.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          id: 'user-1',
          timezone: 'Invalid/Zone',
        },
      ]);
      const service = createSelfReviewScheduleService(deps);

      await expect(service.dispatchNightlyReviewRequests()).resolves.toEqual({
        enqueued: 1,
        skipped: 0,
      });
      expect(deps.enqueueSource).toHaveBeenCalledWith(
        expect.objectContaining<
          Partial<AgentSignalSourceEventInput<'agent.nightly_review.requested'>>
        >({
          payload: expect.objectContaining({
            localDate: '2026-05-03',
            reviewWindowEnd: '2026-05-04T00:00:00.000Z',
            reviewWindowStart: '2026-05-03T00:00:00.000Z',
            timezone: 'UTC',
          }),
          sourceId: 'nightly-review:user-1:agent-1:2026-05-03',
        }),
      );
    });
  });

  describe('buildNightlyReviewSourceId', () => {
    it('produces a stable nightly review source id', () => {
      expect(
        buildNightlyReviewSourceId({
          agentId: 'agent-1',
          localDate: '2026-05-04',
          userId: 'user-1',
        }),
      ).toBe('nightly-review:user-1:agent-1:2026-05-04');
    });
  });

  describe('createServerNightlyReviewScheduleService', () => {
    it('calls the model methods and enqueues source payloads through the server adapter', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-03T18:30:00.000Z'));
      mocks.listEligibleUsers.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          id: 'user-1',
          timezone: 'Asia/Shanghai',
        },
      ]);
      mocks.listActiveAgentTargets.mockResolvedValue([{ agentId: 'agent-1' }]);
      mocks.enqueueAgentSignalSourceEvent.mockResolvedValue({
        accepted: true,
        scopeKey: 'user-1:agent-1',
        workflowRunId: 'workflow-1',
      });
      const db = {} as unknown as LobeChatDatabase;
      const service = createServerNightlyReviewScheduleService(db);

      const summary = await service.dispatchNightlyReviewRequests({
        cursor: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'cursor-user' },
        limit: 10,
        targetLimit: 3,
        whitelist: ['user-1'],
      });

      expect(summary).toEqual({ enqueued: 1, skipped: 0 });
      expect(mocks.modelConstructor).toHaveBeenCalledWith(db);
      expect(mocks.listEligibleUsers).toHaveBeenCalledWith({
        cursor: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'cursor-user' },
        limit: 10,
        whitelist: ['user-1'],
      });
      expect(mocks.listActiveAgentTargets).toHaveBeenCalledWith('user-1', {
        limit: 3,
        windowEnd: new Date('2026-05-03T16:00:00.000Z'),
        windowStart: new Date('2026-05-02T16:00:00.000Z'),
      });
      expect(mocks.enqueueAgentSignalSourceEvent).toHaveBeenCalledWith(
        {
          payload: {
            agentId: 'agent-1',
            localDate: '2026-05-03',
            requestedAt: '2026-05-03T18:30:00.000Z',
            reviewWindowEnd: '2026-05-03T16:00:00.000Z',
            reviewWindowStart: '2026-05-02T16:00:00.000Z',
            timezone: 'Asia/Shanghai',
            userId: 'user-1',
          },
          sourceId: 'nightly-review:user-1:agent-1:2026-05-03',
          sourceType: 'agent.nightly_review.requested',
          timestamp: new Date('2026-05-03T18:30:00.000Z').getTime(),
        },
        {
          agentId: 'agent-1',
          userId: 'user-1',
        },
      );
    });
  });
});
