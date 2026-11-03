import type { WorkflowContext } from '@upstash/workflow';
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { NightlyReviewScheduleService } from '@/server/services/agentSignal/services';
import type {
  AgentSignalNightlyReviewWorkflow,
  ExecuteNightlyReviewUserPayload,
  PaginateNightlyReviewUsersPayload,
} from '@/server/workflows/agentSignal/nightlyReview';

import type { NightlyReviewWorkflowDependencies } from '../nightlyReview';
import { executeNightlyReviewUser, paginateNightlyReviewUsers } from '../nightlyReview';

// The real retro service pulls in the document editor stack; the workflow only orchestrates it.
vi.mock('@/server/services/agentSignal/services/botRetro', () => ({ BotRetroService: class {} }));

const createContext = <TPayload>(payload: TPayload): WorkflowContext<TPayload> => {
  const run = vi.fn(async (_stepName: string, handler: () => Promise<unknown>) => {
    const result = await handler();

    // NOTICE:
    // Tests must reproduce Upstash's persisted JSON round trip between workflow steps.
    // The SDK context is not constructible outside a live workflow request.
    // Source/context: `apps/server/src/workflows/step.ts` documents Date -> string replay behavior.
    // Removal condition: replace this mock when Upstash ships a public workflow context test helper.
    // eslint-disable-next-line unicorn/prefer-structured-clone -- structuredClone preserves Date.
    return JSON.parse(JSON.stringify(result)) as unknown;
  });

  return { requestPayload: payload, run } as unknown as WorkflowContext<TPayload>;
};

const createService = (): NightlyReviewScheduleService => ({
  dispatchNightlyReviewForUser: vi.fn().mockResolvedValue({ enqueued: 1, skipped: 0 }),
  listEligibleUsersPage: vi.fn().mockResolvedValue({ users: [] }),
});

const createDependencies = (service: NightlyReviewScheduleService) => {
  const triggerExecuteUser = vi
    .fn<typeof AgentSignalNightlyReviewWorkflow.triggerExecuteUser>()
    .mockResolvedValue({ workflowRunId: 'execute-run' });
  const triggerPaginateUsers = vi
    .fn<typeof AgentSignalNightlyReviewWorkflow.triggerPaginateUsers>()
    .mockResolvedValue({ workflowRunId: 'paginate-run' });
  const dependencies: NightlyReviewWorkflowDependencies = {
    createScheduleService: () => service,
    getDb: async () => ({}) as unknown as LobeChatDatabase,
    triggerExecuteUser,
    triggerPaginateUsers,
  };

  return { dependencies, triggerExecuteUser, triggerPaginateUsers };
};

describe('nightly review layered workflows', () => {
  it('reads one cursor page, fans it out in bounded chunks, and schedules the next cursor', async () => {
    /**
     * @example
     * expect(result).toMatchObject({ scheduledBatches: 3, scheduledUsers: 45 });
     */
    const service = createService();
    const users = Array.from({ length: 45 }, (_, index) => ({
      createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      id: `user-${index + 1}`,
      timezone: 'Asia/Shanghai',
    }));
    vi.mocked(service.listEligibleUsersPage).mockResolvedValue({
      nextCursor: {
        createdAt: users.at(-1)!.createdAt,
        id: users.at(-1)!.id,
      },
      users,
    });
    const { dependencies, triggerExecuteUser, triggerPaginateUsers } = createDependencies(service);
    const context = createContext<PaginateNightlyReviewUsersPayload>({
      pageSize: 50,
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 20,
    });

    await expect(paginateNightlyReviewUsers(context, dependencies)).resolves.toEqual({
      hasNextPage: true,
      scheduledBatches: 3,
      scheduledUsers: 45,
      success: true,
    });
    expect(service.listEligibleUsersPage).toHaveBeenCalledOnce();
    expect(triggerExecuteUser).not.toHaveBeenCalled();
    expect(triggerPaginateUsers).toHaveBeenCalledTimes(4);
    expect(
      triggerPaginateUsers.mock.calls.slice(0, 3).map(([payload]) => payload.users?.length),
    ).toEqual([20, 20, 5]);
    expect(triggerPaginateUsers).toHaveBeenLastCalledWith({
      cursor: {
        createdAt: users.at(-1)!.createdAt.toISOString(),
        id: users.at(-1)!.id,
      },
      job: 'self-review',
      pageSize: 50,
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 20,
      whitelist: undefined,
    });
  });

  it('carries the bot-retro job through the page scan and every child trigger', async () => {
    const service = createService();
    vi.mocked(service.listEligibleUsersPage).mockResolvedValue({
      users: [{ createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'user-1' }],
    });
    const { dependencies, triggerExecuteUser, triggerPaginateUsers } = createDependencies(service);

    await paginateNightlyReviewUsers(
      createContext<PaginateNightlyReviewUsersPayload>({
        job: 'bot-retro',
        pageSize: 50,
        requestedAt: '2026-05-03T20:30:00.000Z',
        targetLimit: 20,
      }),
      dependencies,
    );

    expect(service.listEligibleUsersPage).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'bot-retro' }),
    );
    expect(triggerPaginateUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        job: 'bot-retro',
        users: [expect.objectContaining({ id: 'user-1' })],
      }),
    );

    await paginateNightlyReviewUsers(
      createContext<PaginateNightlyReviewUsersPayload>({
        job: 'bot-retro',
        pageSize: 50,
        requestedAt: '2026-05-03T20:30:00.000Z',
        targetLimit: 20,
        users: [{ createdAt: '2026-01-01T00:00:00.000Z', id: 'user-1' }],
      }),
      dependencies,
    );

    expect(triggerExecuteUser).toHaveBeenCalledWith(expect.objectContaining({ job: 'bot-retro' }));
  });

  it('turns one fan-out chunk into one execution workflow per user without querying a page', async () => {
    /**
     * @example
     * expect(triggerExecuteUser).toHaveBeenCalledTimes(2);
     */
    const service = createService();
    const { dependencies, triggerExecuteUser, triggerPaginateUsers } = createDependencies(service);
    const context = createContext<PaginateNightlyReviewUsersPayload>({
      pageSize: 50,
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 20,
      users: [
        {
          createdAt: '2026-01-01T00:00:00.000Z',
          id: 'user-1',
          timezone: 'Asia/Shanghai',
        },
        {
          createdAt: '2026-01-02T00:00:00.000Z',
          id: 'user-2',
          timezone: 'Asia/Shanghai',
        },
      ],
    });

    await expect(paginateNightlyReviewUsers(context, dependencies)).resolves.toEqual({
      scheduledUsers: 2,
      success: true,
    });
    expect(triggerExecuteUser).toHaveBeenCalledTimes(2);
    expect(triggerPaginateUsers).not.toHaveBeenCalled();
    expect(service.listEligibleUsersPage).not.toHaveBeenCalled();
  });

  it('executes exactly one user with restored Date values', async () => {
    /**
     * @example
     * expect(service.dispatchNightlyReviewForUser).toHaveBeenCalledOnce();
     */
    const service = createService();
    const { dependencies } = createDependencies(service);
    const context = createContext<ExecuteNightlyReviewUserPayload>({
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 5,
      user: {
        createdAt: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
        timezone: 'Asia/Shanghai',
      },
    });

    await expect(executeNightlyReviewUser(context, dependencies)).resolves.toEqual({
      enqueued: 1,
      skipped: 0,
      success: true,
      userId: 'user-1',
    });
    expect(service.dispatchNightlyReviewForUser).toHaveBeenCalledWith({
      requestedAt: new Date('2026-05-03T18:30:00.000Z'),
      targetLimit: 5,
      user: {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        id: 'user-1',
        timezone: 'Asia/Shanghai',
      },
    });
  });

  it("runs one retro step per bot agent over the user's previous local day", async () => {
    const service = createService();
    const listTargets = vi.fn().mockResolvedValue(['agent-a', 'agent-b']);
    const runForAgent = vi.fn().mockResolvedValue({ status: 'written' });
    const { dependencies } = createDependencies(service);
    // 04:30 in Shanghai on 2026-05-04: inside the bot-retro window, reviewing 2026-05-03.
    const context = createContext<ExecuteNightlyReviewUserPayload>({
      job: 'bot-retro',
      requestedAt: '2026-05-03T20:30:00.000Z',
      targetLimit: 5,
      user: { createdAt: '2026-01-01T00:00:00.000Z', id: 'user-1', timezone: 'Asia/Shanghai' },
    });

    await expect(
      executeNightlyReviewUser(context, {
        ...dependencies,
        createBotRetroService: () => ({ listTargets, runForAgent }),
      }),
    ).resolves.toEqual({ enqueued: 2, skipped: 0, success: true, userId: 'user-1' });

    const windowStart = new Date('2026-05-02T16:00:00.000Z');
    const windowEnd = new Date('2026-05-03T16:00:00.000Z');
    expect(listTargets).toHaveBeenCalledWith({ limit: 5, windowEnd, windowStart });
    expect(runForAgent).toHaveBeenCalledTimes(2);
    expect(runForAgent).toHaveBeenCalledWith({
      agentId: 'agent-b',
      localDate: '2026-05-03',
      windowEnd,
      windowStart,
    });
    expect(vi.mocked(context.run).mock.calls.map(([name]) => name)).toEqual([
      'agent-signal:nightly-bot-retro:list-agents:user-1',
      'agent-signal:nightly-bot-retro:run:agent-a',
      'agent-signal:nightly-bot-retro:run:agent-b',
    ]);
    expect(service.dispatchNightlyReviewForUser).not.toHaveBeenCalled();
  });

  it('skips the bot retro outside the 04:00-06:00 local window', async () => {
    const listTargets = vi.fn();
    const { dependencies } = createDependencies(createService());
    // 02:30 in Shanghai is the self-review window, not the bot retro one.
    const context = createContext<ExecuteNightlyReviewUserPayload>({
      job: 'bot-retro',
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 5,
      user: { createdAt: '2026-01-01T00:00:00.000Z', id: 'user-1', timezone: 'Asia/Shanghai' },
    });

    await expect(
      executeNightlyReviewUser(context, {
        ...dependencies,
        createBotRetroService: () => ({ listTargets, runForAgent: vi.fn() }),
      }),
    ).resolves.toEqual({ enqueued: 0, skipped: 1, success: true, userId: 'user-1' });
    expect(listTargets).not.toHaveBeenCalled();
  });
});
