// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCClientError } from '@trpc/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearConnectionModel } from '@/database/models/linear';
import {
  asyncTasks,
  linearConnections,
  linearSyncRules,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { LinearSyncJobService } from '@/server/services/linear/syncJob';

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
  listLinearProjects: vi.fn(),
  listLinearTeams: mocks.listTeams,
}));
vi.mock('@/server/services/linear/issueSync', () => ({
  LinearIssueSyncService: vi.fn().mockImplementation(function () {
    return { importIssues: mocks.importIssues, syncByFilter: mocks.syncByFilter };
  }),
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
        mocks.runSync.mockRejectedValue(new TRPCClientError('fetch failed'));

        const { id } = await startRule();
        await settled(1);

        expect(mocks.runSync).toHaveBeenCalledTimes(1);
        expect(await caller({ userId }).listSyncJobs({ projectId })).toMatchObject([
          { error: null, id, status: 'pending' },
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
