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

const createDeps = () => ({
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
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nightlyReviewScheduleService', () => {
  describe('dispatchNightlyReviewForUser', () => {
    it('enqueues Shanghai user nightly review sources with previous full local day window', async () => {
      /**
       * @example
       * expect(summary).toEqual({ enqueued: 1, skipped: 0 });
       */
      const deps = createDeps();
      const service = createSelfReviewScheduleService(deps);

      const summary = await service.dispatchNightlyReviewForUser({
        requestedAt: new Date('2026-05-03T18:30:00.000Z'),
        user: {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          id: 'user-1',
          timezone: 'Asia/Shanghai',
        },
      });

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
      /**
       * @example
       * expect(summary.skipped).toBe(1);
       */
      const deps = createDeps();
      const service = createSelfReviewScheduleService(deps);

      const summary = await service.dispatchNightlyReviewForUser({
        requestedAt: new Date('2026-05-03T20:30:00.000Z'),
        user: {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          id: 'user-1',
          timezone: 'Asia/Shanghai',
        },
      });

      expect(summary).toEqual({ enqueued: 0, skipped: 1 });
      expect(deps.listActiveAgentTargets).not.toHaveBeenCalled();
      expect(deps.enqueueSource).not.toHaveBeenCalled();
    });

    it('falls back to UTC for invalid timezone values without throwing', async () => {
      /**
       * @example
       * expect(source.payload.timezone).toBe('UTC');
       */
      const deps = createDeps();
      const service = createSelfReviewScheduleService(deps);

      await expect(
        service.dispatchNightlyReviewForUser({
          requestedAt: new Date('2026-05-04T02:30:00.000Z'),
          user: {
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            id: 'user-1',
            timezone: 'Invalid/Zone',
          },
        }),
      ).resolves.toEqual({ enqueued: 1, skipped: 0 });
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

  describe('listEligibleUsersPage', () => {
    it('returns one page and a stable cursor without scanning the next page inline', async () => {
      /**
       * ROOT CAUSE:
       *
       * The old service treated `limit` as a page size inside `while (true)`, retaining one cron
       * request while it traversed the complete user table and enqueued every target.
       *
       * Before: one call consumed page 1, page 2, and the terminal empty page.
       * After: one call consumes page 1 only; a durable workflow owns the returned cursor.
       *
       * @example
       * expect(deps.listEligibleUsers).toHaveBeenCalledOnce();
       */
      const deps = createDeps();
      deps.listEligibleUsers.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          id: 'user-1',
          timezone: 'Asia/Shanghai',
        },
        {
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
          id: 'user-2',
          timezone: 'Asia/Shanghai',
        },
      ]);
      const service = createSelfReviewScheduleService(deps);

      const page = await service.listEligibleUsersPage({ limit: 2 });

      expect(page).toEqual({
        nextCursor: {
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
          id: 'user-2',
        },
        users: expect.arrayContaining([
          expect.objectContaining({ id: 'user-1' }),
          expect.objectContaining({ id: 'user-2' }),
        ]),
      });
      expect(deps.listEligibleUsers).toHaveBeenCalledOnce();
      expect(deps.listEligibleUsers).toHaveBeenCalledWith({ limit: 2 });
      expect(deps.listActiveAgentTargets).not.toHaveBeenCalled();
      expect(deps.enqueueSource).not.toHaveBeenCalled();
    });

    /**
     * ROOT CAUSE:
     *
     * The candidate scan had no predicate, so every cron fire walked all 321k users to reach
     * the handful actually inside their 02:00-04:00 window — ~18h of flow-controlled work per
     * hourly fire, which drifted every user's review later each day. The local window itself
     * stays here rather than in SQL; only the activity floor is pushed down.
     *
     * @example
     * expect(deps.listEligibleUsers).toHaveBeenCalledWith(
     *   expect.objectContaining({ activeSince: new Date('2026-05-02T12:05:00.000Z') }),
     * );
     */
    it('narrows the candidate scan to recently active users', async () => {
      const deps = createDeps();
      deps.listEligibleUsers.mockResolvedValue([]);
      const service = createSelfReviewScheduleService(deps);
      const requestedAt = new Date('2026-05-03T18:05:00.000Z');

      await service.listEligibleUsersPage({ limit: 50, requestedAt });

      expect(deps.listEligibleUsers).toHaveBeenCalledWith({
        activeSince: new Date('2026-05-02T12:05:00.000Z'),
        limit: 50,
        requestedAt,
      });
    });

    /**
     * @example
     * expect(deps.listEligibleUsers).toHaveBeenCalledWith({ limit: 50 });
     */
    it('leaves the scan unnarrowed when no schedule instant is supplied', async () => {
      const deps = createDeps();
      deps.listEligibleUsers.mockResolvedValue([]);
      const service = createSelfReviewScheduleService(deps);

      await service.listEligibleUsersPage({ limit: 50 });

      expect(deps.listEligibleUsers).toHaveBeenCalledWith({ limit: 50 });
    });
  });

  describe('buildNightlyReviewSourceId', () => {
    it('produces a stable nightly review source id', () => {
      /**
       * @example
       * expect(sourceId).toBe('nightly-review:user-1:agent-1:2026-05-04');
       */
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
      /**
       * @example
       * expect(summary.enqueued).toBe(1);
       */
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

      const page = await service.listEligibleUsersPage({
        cursor: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'cursor-user' },
        limit: 10,
        whitelist: ['user-1'],
      });
      const summary = await service.dispatchNightlyReviewForUser({
        requestedAt: new Date('2026-05-03T18:30:00.000Z'),
        targetLimit: 3,
        user: page.users[0]!,
      });

      expect(summary).toEqual({ enqueued: 1, skipped: 0 });
      expect(page.nextCursor).toBeUndefined();
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
