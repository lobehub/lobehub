// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { LINEAR_NO_PROJECT_ID } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LinearConnectionModel,
  LinearSyncJobModel,
  LinearSyncRuleModel,
} from '@/database/models/linear';
import {
  asyncTasks,
  linearConnections,
  linearSyncRules,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { continueLinearRuleSyncJob } from '@/server/services/linear/startSyncJob';
import {
  LINEAR_SYNC_MAX_HAND_OFFS,
  LINEAR_SYNC_MAX_ROUNDS,
  LINEAR_SYNC_RUN_BUDGET_MS,
  LinearSyncJobService,
} from '@/server/services/linear/syncJob';

import { linearRouter } from '../linear';

const serverDB = await getTestDB();
const userId = 'linear-router-user';
const otherUserId = 'linear-router-user-2';
const projectId = 'linear-router-project';
const otherProjectId = 'linear-router-project-2';

vi.mock('@/envs/linear', () => ({
  linearEnv: { ENABLED_LINEAR: true },
}));

const mocks = vi.hoisted(() => ({
  countIssues: vi.fn(),
  getToken: vi.fn(),
  listTeams: vi.fn(),
  revoke: vi.fn(),
  importIssues: vi.fn(),
  runSync: vi.fn(),
  syncByFilter: vi.fn(),
}));
vi.mock('@/server/services/linear/client', () => ({
  LINEAR_INSTALL_PATH: '/api/webhooks/linear/install',
  LinearApiError: class LinearApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  revokeLinearToken: mocks.revoke,
}));
vi.mock('@/server/services/linear/token', () => ({
  getLinearAccessToken: mocks.getToken,
  LinearReconnectRequiredError: class LinearReconnectRequiredError extends Error {},
}));
vi.mock('@/server/services/linear/issues', () => ({
  countLinearIssues: mocks.countIssues,
  listLinearProjects: vi.fn(),
  listLinearTeams: mocks.listTeams,
}));
vi.mock('@/server/services/linear/issueSync', () => ({
  LinearIssueSyncService: vi.fn().mockImplementation(function () {
    return { importIssues: mocks.importIssues, syncByFilter: mocks.syncByFilter };
  }),
  MAX_SKIPPED_ENTRIES: 100,
}));
// The background half runs in the async router; here only the hand-off is seen.
vi.mock('@/server/routers/async', () => ({
  createAsyncCaller: async () => ({ linear: { runSync: mocks.runSync } }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
      encrypt: async (plaintext: string) => plaintext,
    }),
  },
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));

const caller = (ctx: { userId: string; workspaceId?: string | null }) =>
  linearRouter.createCaller({ ...ctx, serverDB } as any);

const connect = (scope: { userId: string; workspaceId?: string | null }) =>
  LinearConnectionModel.upsert(serverDB, {
    actorExternalId: 'linear-user',
    actorName: 'Ada',
    credentials: { accessToken: 'token' },
    organizationId: 'org-1',
    organizationName: 'Acme',
    organizationUrlKey: 'acme',
    ...scope,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(projects).values([
    { id: projectId, identifier: 'LRP', name: 'Mine', userId },
    { id: otherProjectId, identifier: 'LRQ', name: 'Theirs', userId: otherUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(linearSyncRules);
  await serverDB.delete(linearConnections);
  await serverDB.delete(projects);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('linearRouter', () => {
  it('reports the connect configuration', async () => {
    expect(await caller({ userId }).getConfig()).toEqual({
      enabled: true,
      installPath: '/api/webhooks/linear/install',
    });
  });

  it('lists only the caller scope, without credentials', async () => {
    await connect({ userId });
    await connect({ userId: otherUserId });

    const list = await caller({ userId }).listConnections();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ organizationName: 'Acme', userId });
    expect(list[0]).not.toHaveProperty('credentials');
  });

  it("refuses to disconnect another user's connection", async () => {
    const other = await connect({ userId: otherUserId });

    await expect(caller({ userId }).disconnect({ connectionId: other.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('lets workspace members disconnect a shared connection but not viewers', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: otherUserId, slug: 'linear-router-ws' })
      .returning();
    const connection = await connect({ userId: otherUserId, workspaceId: workspace.id });
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'viewer', userId, workspaceId: workspace.id });
    const input = { connectionId: connection.id };

    await expect(
      caller({ userId, workspaceId: workspace.id }).disconnect(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await serverDB.update(workspaceMembers).set({ role: 'member' });
    await expect(caller({ userId, workspaceId: workspace.id }).disconnect(input)).resolves.toEqual({
      ok: true,
    });
  });

  it('disconnects: revokes the token at Linear and hides the connection', async () => {
    const connection = await connect({ userId });

    await caller({ userId }).disconnect({ connectionId: connection.id });

    expect(mocks.revoke).toHaveBeenCalledWith({ accessToken: 'token' }, null);
    expect(await caller({ userId }).listConnections()).toEqual([]);
    await expect(
      caller({ userId }).disconnect({ connectionId: connection.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('issue sync', () => {
    const syncResult = {
      closed: 0,
      created: 2,
      keptLocalEdits: 0,
      skipped: [],
      truncated: false,
      unchanged: 0,
      updated: 0,
    };

    it("does not read Linear through another scope's connection", async () => {
      const other = await connect({ userId: otherUserId });

      await expect(caller({ userId }).listTeams({ connectionId: other.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mocks.getToken).not.toHaveBeenCalled();
    });

    it("counts the issues of the picker filter through the caller's connection", async () => {
      const connection = await connect({ userId });
      const other = await connect({ userId: otherUserId });
      mocks.getToken.mockResolvedValue('token');
      mocks.countIssues.mockResolvedValue({ capped: false, count: 234 });
      const filter = { stateTypes: ['unstarted' as const], teamId: 'team-pkg' };

      await expect(
        caller({ userId }).countIssues({ connectionId: connection.id, ...filter }),
      ).resolves.toEqual({ capped: false, count: 234 });
      expect(mocks.countIssues).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ connectionId: connection.id, ...filter }),
      );

      await caller({ userId }).countIssues({
        connectionId: connection.id,
        ...filter,
        includeArchived: true,
      });
      expect(mocks.countIssues).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({ includeArchived: true, ...filter }),
      );

      await expect(
        caller({ userId }).countIssues({ connectionId: other.id, ...filter }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('asks to reconnect when Linear rejects the token', async () => {
      const connection = await connect({ userId });
      const { LinearApiError } = await import('@/server/services/linear/client');
      mocks.getToken.mockResolvedValue('token');
      mocks.listTeams.mockRejectedValue(new LinearApiError('Linear API error: Unauthorized', 401));

      await expect(
        caller({ userId }).listTeams({ connectionId: connection.id }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'LINEAR_RECONNECT_REQUIRED',
      });
    });

    it('runs a saved rule in the background and records the outcome on the job and the rule', async () => {
      const connection = await connect({ userId });
      mocks.getToken.mockResolvedValue('token');
      mocks.runSync.mockResolvedValue({ ok: true });
      mocks.syncByFilter.mockResolvedValue(syncResult);

      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        projectId,
        stateTypes: ['backlog', 'unstarted'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });
      const { id } = await caller({ userId }).startRuleSync({ ruleId: rule.id });

      // Queued and handed to the async router; nothing synced yet.
      expect(mocks.runSync).toHaveBeenCalledWith({ taskId: id, workspaceId: undefined });
      expect(mocks.syncByFilter).not.toHaveBeenCalled();
      expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
        { id, kind: 'rule', ruleId: rule.id, status: 'pending' },
      ]);
      // Starting again while it is queued returns the same job.
      expect(await caller({ userId }).startRuleSync({ ruleId: rule.id })).toEqual({ id });

      const service = new LinearSyncJobService(serverDB, userId);
      await service.run(id);
      // A repeated hand-off does not run it twice.
      await service.run(id);

      expect(mocks.syncByFilter).toHaveBeenCalledTimes(1);
      expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
        { error: null, id, result: syncResult, status: 'success' },
      ]);
      expect(mocks.syncByFilter).toHaveBeenCalledWith(
        'token',
        { linearProjectId: null, stateTypes: ['backlog', 'unstarted'], teamId: 'team-1' },
        { targetProjectId: projectId },
      );
      const [saved] = await caller({ userId }).listSyncRules({ projectId });
      expect(saved).toMatchObject({
        id: rule.id,
        lastResult: syncResult,
        projectId,
        teamName: 'Engineering',
      });
      expect(saved.lastRunAt).toBeInstanceOf(Date);
    });

    it('saves and runs a rule for the team’s issues without a Linear project', async () => {
      const connection = await connect({ userId });
      mocks.getToken.mockResolvedValue('token');
      mocks.runSync.mockResolvedValue({ ok: true });
      mocks.syncByFilter.mockResolvedValue(syncResult);

      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        linearProjectId: LINEAR_NO_PROJECT_ID,
        linearProjectName: 'ignored',
        projectId,
        stateTypes: ['backlog'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });
      expect(rule).toMatchObject({
        linearProjectId: LINEAR_NO_PROJECT_ID,
        linearProjectName: null,
      });

      const { id } = await caller({ userId }).startRuleSync({ ruleId: rule.id });
      await new LinearSyncJobService(serverDB, userId).run(id);

      expect(mocks.syncByFilter).toHaveBeenCalledWith(
        'token',
        { linearProjectId: LINEAR_NO_PROJECT_ID, stateTypes: ['backlog'], teamId: 'team-1' },
        { targetProjectId: projectId },
      );
    });

    describe('when a rule matches more issues than one round creates', () => {
      const round = (
        created: number,
        truncated: boolean,
        resumeAfter?: string,
      ): typeof syncResult & Record<string, unknown> => ({
        ...syncResult,
        created,
        resumeAfter,
        skipped: [{ identifier: `ENG-${created}`, reason: 'closed' as const }],
        skippedCount: 1,
        truncated,
        unchanged: 7,
        updated: 1,
      });

      const startRule = async () => {
        const connection = await connect({ userId });
        mocks.getToken.mockResolvedValue('token');
        mocks.runSync.mockResolvedValue({ ok: true });
        const rule = await caller({ userId }).createSyncRule({
          connectionId: connection.id,
          projectId,
          stateTypes: ['unstarted'],
          teamId: 'team-1',
          teamName: 'Engineering',
        });
        const { id } = await caller({ userId }).startRuleSync({ ruleId: rule.id });
        return { id, rule };
      };

      /**
       * The service as the async router builds it, able to queue the next
       * round. With no time budget, every round is handed to a new request,
       * as a run that outlasts one request is.
       */
      const routerService = (runBudgetMs = 0, maxHandOffs = Infinity) =>
        new LinearSyncJobService(
          serverDB,
          userId,
          undefined,
          (taskId, metadata) =>
            continueLinearRuleSyncJob(serverDB, userId, undefined, taskId, metadata),
          runBudgetMs,
          maxHandOffs,
        );

      const settle = async () => {
        for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
      };

      /** Play the async router: run each hand-off until no new one is queued. */
      const drainHandOffs = async () => {
        const service = routerService();
        for (let handled = 0; handled < mocks.runSync.mock.calls.length; handled++) {
          await service.run(mocks.runSync.mock.calls[handled][0].taskId);
          await settle();
        }
      };

      const startAfterOfCalls = () =>
        mocks.syncByFilter.mock.calls.map(([, , options]) => options.startAfter);

      it('keeps going in the background as one run, reading on from where each round stopped', async () => {
        mocks.syncByFilter
          .mockResolvedValueOnce(round(100, true, '100'))
          .mockResolvedValueOnce(round(100, true, '200'))
          .mockResolvedValueOnce(round(42, false))
          // The closing sweep from the start finds nothing new.
          .mockResolvedValueOnce(round(0, false));
        const { id, rule } = await startRule();

        await routerService().run(id);
        await settle();

        // Queued again by itself, with the total so far; a click on Sync joins it.
        expect(mocks.runSync).toHaveBeenCalledTimes(2);
        expect(mocks.runSync).toHaveBeenLastCalledWith({ taskId: id, workspaceId: undefined });
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, result: { created: 100, truncated: true }, status: 'pending' },
        ]);
        expect(await caller({ userId }).startRuleSync({ ruleId: rule.id })).toEqual({ id });

        await drainHandOffs();

        // Each round resumes at the cursor the previous one returned, then one
        // pass from the start picks up stragglers and closes what Linear closed.
        expect(startAfterOfCalls()).toEqual([undefined, '100', '200', undefined]);
        const jobs = await caller({ userId }).listSyncJobs({ projectId });
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
          error: null,
          id,
          // Writes add up; what the final full pass looked at stands for the run.
          result: { created: 242, skippedCount: 1, truncated: false, unchanged: 7, updated: 4 },
          status: 'success',
        });
        expect(jobs[0].result).not.toHaveProperty('resumeAfter');
        const [saved] = await caller({ userId }).listSyncRules({ projectId });
        expect(saved.lastResult).toMatchObject({ created: 242, truncated: false });
      });

      it('runs the rounds one after another in the same request while it has time', async () => {
        mocks.syncByFilter
          .mockResolvedValueOnce(round(100, true, '100'))
          .mockResolvedValueOnce(round(100, true, '200'))
          .mockResolvedValueOnce(round(100, true, '300'))
          .mockResolvedValueOnce(round(100, true, '400'))
          .mockResolvedValueOnce(round(100, true, '500'))
          .mockResolvedValueOnce(round(42, false))
          .mockResolvedValueOnce(round(0, false));
        const { id, rule } = await startRule();

        await routerService(LINEAR_SYNC_RUN_BUDGET_MS).run(id);
        await settle();

        // One hand-off, the one that started the run: no chain of requests
        // each waiting on the next, which the host cuts off a few deep.
        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(startAfterOfCalls()).toEqual([
          undefined,
          '100',
          '200',
          '300',
          '400',
          '500',
          undefined,
        ]);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, result: { created: 542, truncated: false }, status: 'success' },
        ]);
        const [saved] = await caller({ userId }).listSyncRules({ projectId });
        expect(saved).toMatchObject({ id: rule.id, lastResult: { created: 542 } });
      });

      it('hands a slow run to a new request before a round could outlast this one', async () => {
        // Each round takes 5 minutes: after the first, two more would not fit
        // in the budget, so the next round goes to a fresh request.
        let clock = Date.now();
        const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
        try {
          mocks.syncByFilter.mockImplementation(async (_t, _f, options) => {
            clock += 5 * 60 * 1000;
            return options.startAfter ? round(5, false) : round(100, true, '100');
          });
          const { id } = await startRule();

          await routerService(LINEAR_SYNC_RUN_BUDGET_MS).run(id);
          await settle();

          expect(mocks.syncByFilter).toHaveBeenCalledTimes(1);
          expect(mocks.runSync).toHaveBeenCalledTimes(2);
        } finally {
          now.mockRestore();
        }
        // Queued for the next request, with the total so far.
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, result: { created: 100 }, status: 'pending' },
        ]);
      });

      it(`ends a run that keeps running out of time after ${LINEAR_SYNC_MAX_HAND_OFFS} hand-offs, with issues left`, async () => {
        // Every round is slow, so each request runs one and hands the run on.
        let clock = Date.now();
        const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
        let page = 0;
        mocks.syncByFilter.mockImplementation(async () => {
          clock += 5 * 60 * 1000;
          page += 1;
          return round(100, true, String(page * 100));
        });
        let id: string;
        try {
          ({ id } = await startRule());
          const service = routerService(LINEAR_SYNC_RUN_BUDGET_MS, LINEAR_SYNC_MAX_HAND_OFFS);
          for (let handled = 0; handled < mocks.runSync.mock.calls.length; handled++) {
            await service.run(mocks.runSync.mock.calls[handled][0].taskId);
            await settle();
          }
        } finally {
          now.mockRestore();
        }

        // The click, then three hand-offs: four requests, one round each.
        expect(mocks.runSync).toHaveBeenCalledTimes(LINEAR_SYNC_MAX_HAND_OFFS + 1);
        expect(mocks.syncByFilter).toHaveBeenCalledTimes(LINEAR_SYNC_MAX_HAND_OFFS + 1);
        const [job] = await caller({ userId }).listSyncJobs({ projectId });
        expect(job).toMatchObject({
          error: null,
          id: id!,
          result: { created: 400, truncated: true },
          status: 'success',
        });
        const [saved] = await caller({ userId }).listSyncRules({ projectId });
        expect(saved.lastResult).toMatchObject({ created: 400, truncated: true });
      });

      it('stops after the current round when stopped during a run in one request', async () => {
        const { id } = await startRule();
        mocks.syncByFilter
          .mockResolvedValueOnce(round(100, true, '100'))
          .mockImplementationOnce(async () => {
            await caller({ userId }).cancelSync({ jobId: id, projectId });
            return round(100, true, '200');
          });

        await routerService(LINEAR_SYNC_RUN_BUDGET_MS).run(id);

        expect(mocks.syncByFilter).toHaveBeenCalledTimes(2);
        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'canceled', id, result: { created: 200 }, status: 'error' },
        ]);
        const [rule] = await caller({ userId }).listSyncRules({ projectId });
        expect(rule).toMatchObject({ lastResult: null, lastRunAt: null });
      });

      it('stops when a round neither creates nor moves on, and asks to run again', async () => {
        mocks.syncByFilter
          .mockResolvedValueOnce(round(100, true, '100'))
          .mockResolvedValueOnce(round(0, true, '100'));
        const { id } = await startRule();

        await drainHandOffs();

        expect(mocks.syncByFilter).toHaveBeenCalledTimes(2);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { id, result: { created: 100, truncated: true }, status: 'success' },
        ]);
      });

      it(`stops creating after ${LINEAR_SYNC_MAX_ROUNDS} rounds, but still takes the closing pass`, async () => {
        let page = 0;
        mocks.syncByFilter.mockImplementation(async (_token, _filter, options) => {
          // The pass from the start finds more than one round can create.
          if (!options.startAfter && page > 0) return round(0, true, '100');
          page += 1;
          return round(100, true, String(page * 100));
        });
        const { id } = await startRule();

        await drainHandOffs();

        expect(mocks.syncByFilter).toHaveBeenCalledTimes(LINEAR_SYNC_MAX_ROUNDS + 1);
        expect(startAfterOfCalls().at(-1)).toBeUndefined();
        // Past the cap the closing pass creates nothing.
        expect(mocks.syncByFilter.mock.calls.at(-1)![2]).toMatchObject({ noCreate: true });
        expect(mocks.syncByFilter.mock.calls.at(-2)![2].noCreate).toBeUndefined();
        // Issues remain, so the run asks to be run again.
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          {
            id,
            result: { created: LINEAR_SYNC_MAX_ROUNDS * 100, truncated: true },
            status: 'success',
          },
        ]);
      });

      it('still runs the closing pass when the last allowed round reads to the end', async () => {
        let page = 0;
        mocks.syncByFilter.mockImplementation(async (_token, _filter, options) => {
          if (!options.startAfter && page > 0) return round(0, false);
          page += 1;
          return page < LINEAR_SYNC_MAX_ROUNDS
            ? round(100, true, String(page * 100))
            : round(100, false);
        });
        const { id } = await startRule();

        await drainHandOffs();

        expect(mocks.syncByFilter).toHaveBeenCalledTimes(LINEAR_SYNC_MAX_ROUNDS + 1);
        expect(startAfterOfCalls().at(-1)).toBeUndefined();
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          {
            id,
            result: { created: LINEAR_SYNC_MAX_ROUNDS * 100, truncated: false },
            status: 'success',
          },
        ]);
      });

      it("keeps the rule's last finished run until this one finishes", async () => {
        mocks.syncByFilter
          .mockResolvedValueOnce(round(100, true, '100'))
          .mockResolvedValueOnce(round(5, false))
          .mockResolvedValueOnce(round(0, false));
        const { id, rule } = await startRule();

        await routerService().run(id);
        await settle();
        const [during] = await caller({ userId }).listSyncRules({ projectId });
        expect(during).toMatchObject({ lastResult: null, lastRunAt: null });

        await drainHandOffs();
        const [after] = await caller({ userId }).listSyncRules({ projectId });
        expect(after).toMatchObject({
          id: rule.id,
          lastResult: { created: 105, truncated: false },
        });
      });

      it("does not record a stopped run as the rule's last run", async () => {
        mocks.syncByFilter.mockResolvedValue(round(100, true, '100'));
        const { id } = await startRule();
        await routerService().run(id);
        await settle();
        await caller({ userId }).cancelSync({ jobId: id, projectId });

        const [rule] = await caller({ userId }).listSyncRules({ projectId });
        expect(rule).toMatchObject({ lastResult: null, lastRunAt: null });
      });

      it('marks the run failed, not successful, when the rule record cannot be written', async () => {
        mocks.syncByFilter.mockResolvedValue(round(5, false));
        const { id } = await startRule();
        const recordRun = vi
          .spyOn(LinearSyncRuleModel, 'recordRun')
          .mockRejectedValueOnce(new Error('connection reset'));

        await routerService().run(id);
        recordRun.mockRestore();

        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'failed', id, status: 'error' },
        ]);
        const [rule] = await caller({ userId }).listSyncRules({ projectId });
        expect(rule).toMatchObject({ lastResult: null, lastRunAt: null });
      });

      it('fails the run when the next round cannot be handed off', async () => {
        mocks.syncByFilter.mockResolvedValue(round(100, true, '100'));
        const { id } = await startRule();
        mocks.runSync.mockRejectedValue(
          new TRPCClientError('Invalid JWT token', {
            result: {
              error: {
                code: -32_001,
                data: { code: 'UNAUTHORIZED', httpStatus: 401 },
                message: 'Invalid JWT token',
              },
            },
          } as any),
        );

        await routerService().run(id);
        for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));

        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'failed', id, status: 'error' },
        ]);
      });

      it('can be stopped between rounds, keeping what was created', async () => {
        mocks.syncByFilter.mockResolvedValue(round(100, true, '100'));
        const { id } = await startRule();
        await routerService().run(id);
        await settle();

        expect(await caller({ userId }).cancelSync({ jobId: id, projectId })).toEqual({
          canceled: true,
        });
        await drainHandOffs();

        expect(mocks.syncByFilter).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'canceled', id, result: { created: 100 }, status: 'error' },
        ]);
      });

      it('stays active while the stopped round finishes, then ends without another', async () => {
        const { id, rule } = await startRule();
        let during: unknown;
        mocks.syncByFilter.mockImplementation(async () => {
          await caller({ userId }).cancelSync({ jobId: id, projectId });
          // The round is still writing: the run shows as stopping, and Sync
          // joins it instead of starting an overlapping run.
          during = (await caller({ userId }).listSyncJobs({ projectId }))[0];
          expect(await caller({ userId }).startRuleSync({ ruleId: rule.id })).toEqual({ id });
          return round(100, true, '100');
        });

        await drainHandOffs();

        expect(during).toMatchObject({ error: 'canceled', id, status: 'processing' });
        expect(mocks.syncByFilter).toHaveBeenCalledTimes(1);
        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'canceled', id, result: { created: 100 }, status: 'error' },
        ]);
        // Once it has ended, the rule starts a new run.
        expect((await caller({ userId }).startRuleSync({ ruleId: rule.id })).id).not.toBe(id);
      });

      it('does not offer to stop an import of picked issues', async () => {
        const connection = await connect({ userId });
        mocks.getToken.mockResolvedValue('token');
        mocks.runSync.mockResolvedValue({ ok: true });
        const { id } = await caller({ userId }).startImport({
          connectionId: connection.id,
          issueIds: ['issue-1'],
          projectId,
        });

        expect(await caller({ userId }).cancelSync({ jobId: id, projectId })).toEqual({
          canceled: false,
        });
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, kind: 'issues', status: 'pending' },
        ]);
      });

      it("does not stop another user's run", async () => {
        mocks.syncByFilter.mockResolvedValue(round(100, true, '100'));
        const { id } = await startRule();

        await expect(
          caller({ userId: otherUserId }).cancelSync({ jobId: id, projectId: otherProjectId }),
        ).resolves.toEqual({ canceled: false });
        await expect(
          caller({ userId: otherUserId }).cancelSync({ jobId: id, projectId }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, status: 'pending' },
        ]);
      });
    });

    it('queues one run when the same rule is started twice at once', async () => {
      const connection = await connect({ userId });
      mocks.getToken.mockResolvedValue('token');
      mocks.runSync.mockResolvedValue({ ok: true });
      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        projectId,
        stateTypes: ['unstarted'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });

      const [first, second] = await Promise.all([
        caller({ userId }).startRuleSync({ ruleId: rule.id }),
        caller({ userId }).startRuleSync({ ruleId: rule.id }),
      ]);

      expect(second).toEqual(first);
      expect(await caller({ userId }).listSyncJobs({ projectId })).toHaveLength(1);
    });

    describe('when the async router rejects the hand-off', () => {
      // What the async router answers when it turns down the internal token.
      const rejected = () =>
        new TRPCClientError('Invalid JWT token', {
          result: {
            error: {
              code: -32_001,
              data: { code: 'UNAUTHORIZED', httpStatus: 401 },
              message: 'Invalid JWT token',
            },
          },
        } as any);

      const startRule = async () => {
        const connection = await connect({ userId });
        mocks.getToken.mockResolvedValue('token');
        const rule = await caller({ userId }).createSyncRule({
          connectionId: connection.id,
          projectId,
          stateTypes: ['unstarted'],
          teamId: 'team-1',
          teamName: 'Engineering',
        });
        return caller({ userId }).startRuleSync({ ruleId: rule.id });
      };

      const settled = async (calls: number) => {
        for (let i = 0; i < 200 && mocks.runSync.mock.calls.length < calls; i++) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        // Let the last attempt record its outcome.
        for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
      };

      it('hands it off again with a new token', async () => {
        mocks.runSync.mockRejectedValueOnce(rejected()).mockResolvedValueOnce({ ok: true });

        const { id } = await startRule();
        await settled(2);

        expect(mocks.runSync).toHaveBeenCalledTimes(2);
        expect(mocks.runSync).toHaveBeenLastCalledWith({ taskId: id, workspaceId: undefined });
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, status: 'pending' },
        ]);
      });

      it('fails the job at once when the retry is rejected too, so it can be started again', async () => {
        mocks.runSync.mockRejectedValue(rejected());

        const { id } = await startRule();
        await settled(2);

        expect(mocks.runSync).toHaveBeenCalledTimes(2);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'failed', id, status: 'error' },
        ]);
      });

      it('leaves a job the router accepted to the router, even when the response is lost', async () => {
        // The router claimed the job and is running it; only its answer is lost.
        mocks.runSync.mockImplementation(async ({ taskId }: { taskId: string }) => {
          await LinearSyncJobModel.claim(serverDB, { userId, workspaceId: null }, taskId);
          throw new TRPCClientError('fetch failed');
        });

        const { id } = await startRule();
        await settled(1);

        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, status: 'processing' },
        ]);
      });

      it('fails a job the host answered with an error the router never ran', async () => {
        mocks.runSync.mockRejectedValue(
          new TRPCClientError('Service Unavailable', {
            meta: { response: { status: 503 } },
          } as any),
        );

        const { id } = await startRule();
        await settled(1);

        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'failed', id, status: 'error' },
        ]);
      });

      it('leaves a job queued when the connection drops without an answer, so the router can still claim it', async () => {
        mocks.runSync.mockRejectedValue(new TRPCClientError('fetch failed'));

        const { id } = await startRule();
        await settled(1);

        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, status: 'pending' },
        ]);
      });

      it('fails a job the host turned away before the router saw it, instead of leaving it queued', async () => {
        // Vercel answers a request deep in a chain of requests with a 508
        // page, which the tRPC client fails to read as JSON.
        mocks.runSync.mockRejectedValue(
          TRPCClientError.from(new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "...')),
        );

        const { id } = await startRule();
        await settled(1);

        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'failed', id, status: 'error' },
        ]);
      });
    });

    it('keeps a long sync alive, so it is not shown as cut off', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const connection = await connect({ userId });
        mocks.getToken.mockResolvedValue('token');
        mocks.runSync.mockResolvedValue({ ok: true });
        let finish: ((result: typeof syncResult) => void) | undefined;
        mocks.syncByFilter.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
        const rule = await caller({ userId }).createSyncRule({
          connectionId: connection.id,
          projectId,
          stateTypes: ['unstarted'],
          teamId: 'team-1',
          teamName: 'Engineering',
        });
        const { id } = await caller({ userId }).startRuleSync({ ruleId: rule.id });
        const running = new LinearSyncJobService(serverDB, userId).run(id);
        const settle = async (done: () => Promise<boolean> | boolean) => {
          for (let i = 0; i < 200 && !(await done()); i++) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        };
        await settle(() => !!finish);

        // The run has been busy past the stale window since it last wrote.
        await serverDB
          .update(asyncTasks)
          .set({ updatedAt: new Date(Date.now() - 20 * 60 * 1000) })
          .where(eq(asyncTasks.id, id));
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: 'timeout', id },
        ]);

        vi.advanceTimersByTime(60 * 1000);
        const status = async () => (await caller({ userId }).listSyncJobs({ projectId }))[0];
        await settle(async () => (await status()).status === 'processing');
        expect(await status()).toMatchObject({ error: null, id, status: 'processing' });

        finish!(syncResult);
        await running;
        expect(await status()).toMatchObject({ id, status: 'success' });
      } finally {
        vi.useRealTimers();
      }
    });

    it("hides another user's personal rules", async () => {
      const connection = await connect({ userId: otherUserId });
      const rule = await caller({ userId: otherUserId }).createSyncRule({
        connectionId: connection.id,
        projectId: otherProjectId,
        stateTypes: ['backlog'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });

      await expect(
        caller({ userId }).listSyncRules({ projectId: otherProjectId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(caller({ userId }).startRuleSync({ ruleId: rule.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(caller({ userId }).deleteSyncRule({ ruleId: rule.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects a project the caller cannot see', async () => {
      const connection = await connect({ userId });

      await expect(
        caller({ userId }).createSyncRule({
          connectionId: connection.id,
          projectId: otherProjectId,
          stateTypes: ['backlog'],
          teamId: 'team-1',
          teamName: 'Engineering',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        caller({ userId }).startImport({
          connectionId: connection.id,
          issueIds: ['issue-1'],
          projectId: 'proj_missing',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mocks.getToken).not.toHaveBeenCalled();
    });

    it('imports picked issues in the background and reports a revoked token as reconnect', async () => {
      const connection = await connect({ userId });
      mocks.getToken.mockResolvedValue('token');
      mocks.runSync.mockResolvedValue({ ok: true });
      mocks.importIssues.mockResolvedValue({ ...syncResult, created: 1 });

      const { id } = await caller({ userId }).startImport({
        connectionId: connection.id,
        issueIds: ['issue-1', 'issue-1', 'issue-2'],
        projectId,
      });
      await new LinearSyncJobService(serverDB, userId).run(id);

      expect(mocks.importIssues).toHaveBeenCalledWith('token', ['issue-1', 'issue-2'], {
        targetProjectId: projectId,
      });
      expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
        { id, issueCount: 2, kind: 'issues', result: { created: 1 }, status: 'success' },
      ]);

      // The token was revoked after the job was queued.
      const { LinearReconnectRequiredError } = await import('@/server/services/linear/token');
      const second = await caller({ userId }).startImport({
        connectionId: connection.id,
        issueIds: ['issue-3'],
        projectId,
      });
      mocks.getToken.mockRejectedValue(new LinearReconnectRequiredError());
      await new LinearSyncJobService(serverDB, userId).run(second.id);

      const [latest] = await caller({ userId }).listSyncJobs({ projectId });
      expect(latest).toMatchObject({ error: 'reconnect', id: second.id, status: 'error' });
    });

    it('passes the comment choice of an import and a rule run on to the sync', async () => {
      const connection = await connect({ userId });
      mocks.getToken.mockResolvedValue('token');
      mocks.runSync.mockResolvedValue({ ok: true });
      mocks.importIssues.mockResolvedValue(syncResult);
      mocks.syncByFilter.mockResolvedValue(syncResult);

      const imported = await caller({ userId }).startImport({
        connectionId: connection.id,
        issueIds: ['issue-1'],
        projectId,
        syncComments: true,
      });
      await new LinearSyncJobService(serverDB, userId).run(imported.id);
      expect(mocks.importIssues).toHaveBeenCalledWith('token', ['issue-1'], {
        syncComments: true,
        targetProjectId: projectId,
      });

      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        projectId,
        stateTypes: ['backlog'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });
      const run = await caller({ userId }).startRuleSync({ ruleId: rule.id, syncComments: true });
      await new LinearSyncJobService(serverDB, userId).run(run.id);
      expect(mocks.syncByFilter).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ teamId: 'team-1' }),
        expect.objectContaining({ syncComments: true }),
      );
    });

    it('leaves archived issues out of a rule run unless that run asks for them', async () => {
      const connection = await connect({ userId });
      mocks.getToken.mockResolvedValue('token');
      mocks.runSync.mockResolvedValue({ ok: true });
      mocks.syncByFilter.mockResolvedValue(syncResult);
      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        // @ts-expect-error A rule does not keep this: archived issues are chosen per run.
        includeArchived: true,
        projectId,
        stateTypes: ['completed'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });

      const plain = await caller({ userId }).startRuleSync({ ruleId: rule.id });
      await new LinearSyncJobService(serverDB, userId).run(plain.id);
      expect(mocks.syncByFilter).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({ includeArchived: undefined, teamId: 'team-1' }),
        expect.anything(),
      );

      const archived = await caller({ userId }).startRuleSync({
        includeArchived: true,
        ruleId: rule.id,
      });
      await new LinearSyncJobService(serverDB, userId).run(archived.id);
      expect(mocks.syncByFilter).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({ includeArchived: true, teamId: 'team-1' }),
        expect.anything(),
      );
    });

    it("lists only the project's own rules, and drops them with the project", async () => {
      const connection = await connect({ userId });
      await serverDB
        .insert(projects)
        .values({ id: 'linear-router-project-3', identifier: 'LRR', name: 'Other', userId });
      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        projectId,
        stateTypes: ['backlog'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });

      expect(
        await caller({ userId }).listSyncRules({ projectId: 'linear-router-project-3' }),
      ).toEqual([]);
      expect(await caller({ userId }).listSyncRules({ projectId })).toMatchObject([
        { id: rule.id },
      ]);

      await serverDB.delete(projects).where(eq(projects.id, projectId));
      expect(await serverDB.select().from(linearSyncRules)).toEqual([]);
    });

    it('keeps a rule removable after its connection is disconnected, and asks to reconnect on run', async () => {
      const connection = await connect({ userId });
      const rule = await caller({ userId }).createSyncRule({
        connectionId: connection.id,
        projectId,
        stateTypes: ['backlog'],
        teamId: 'team-1',
        teamName: 'Engineering',
      });
      await LinearConnectionModel.revoke(serverDB, connection.id);
      const { LinearReconnectRequiredError } = await import('@/server/services/linear/token');
      mocks.getToken.mockRejectedValue(new LinearReconnectRequiredError());

      await expect(caller({ userId }).startRuleSync({ ruleId: rule.id })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'LINEAR_RECONNECT_REQUIRED',
      });
      await expect(caller({ userId }).deleteSyncRule({ ruleId: rule.id })).resolves.toEqual({
        ok: true,
      });
      expect(await caller({ userId }).listSyncRules({ projectId })).toEqual([]);
    });
  });
});
