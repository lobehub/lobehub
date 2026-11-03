import type { LinearSyncJobMetadata } from '@lobechat/types';
import { LINEAR_ISSUE_STATE_TYPES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  LinearConnectionModel,
  LinearSyncJobModel,
  LinearSyncRuleModel,
} from '@/database/models/linear';
import { ProjectModel } from '@/database/models/project';
import { linearEnv } from '@/envs/linear';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  LINEAR_INSTALL_PATH,
  LinearApiError,
  revokeLinearToken,
} from '@/server/services/linear/client';
import { listLinearProjects, listLinearTeams } from '@/server/services/linear/issues';
import { LinearIssueSyncService } from '@/server/services/linear/issueSync';
import { startLinearRuleSyncJob, startLinearSyncJob } from '@/server/services/linear/startSyncJob';
import { toLinearSyncJobView } from '@/server/services/linear/syncJob';
import { getLinearAccessToken, LinearReconnectRequiredError } from '@/server/services/linear/token';
import { canWriteScmScope } from '@/server/services/scm/scope';

const linearProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { scope: { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null } },
  });
});

const connectionInput = z.object({ connectionId: z.string().uuid() });

const projectInput = z.object({ projectId: z.string().min(1) });

/** Picked issues one background import takes. */
const MAX_IMPORT_ISSUES = 500;

const stateTypesInput = z.array(z.enum(LINEAR_ISSUE_STATE_TYPES)).min(1);

const issueFilterInput = connectionInput.extend({
  linearProjectId: z.string().nullish(),
  stateTypes: stateTypesInput,
  teamId: z.string().min(1),
});

/** Importing into tasks also needs task write access (viewers are read-only). */
const linearTaskWriteProcedure = linearProcedure.use(withScopedPermission('agent:update'));

/** Error code the client turns into a "reconnect Linear" prompt. */
export const LINEAR_RECONNECT_REQUIRED = 'LINEAR_RECONNECT_REQUIRED';

/** Run a Linear API call, mapping auth failures to one reconnect error. */
const callLinear = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof LinearReconnectRequiredError ||
      (error instanceof LinearApiError && error.status === 401)
    ) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: LINEAR_RECONNECT_REQUIRED });
    }
    if (error instanceof LinearApiError) {
      throw new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
};

/**
 * The Linear integration: connections for the settings page, issue sync for
 * LobeHub projects. Connecting happens through
 * the OAuth redirect (`/api/webhooks/linear/install`); listing and
 * disconnecting comes through here, scoped to the connections visible in
 * the caller's scope.
 */
export const linearRouter = router({
  /** Remove the connection: revoke the token at Linear and hide the row. */
  disconnect: linearProcedure.input(connectionInput).mutation(async ({ ctx, input }) => {
    const connection = await requireWritableConnection(ctx, input.connectionId);

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const decrypted = await LinearConnectionModel.findDecryptedById(
      ctx.serverDB,
      connection.id,
      gateKeeper,
    );
    if (decrypted?.credentials) {
      await revokeLinearToken(decrypted.credentials, decrypted.tokenExpiresAt);
    }

    await LinearConnectionModel.revoke(ctx.serverDB, connection.id);
    return { ok: true };
  }),

  /** What the client needs to render the connect button. */
  getConfig: linearProcedure.query(async () => ({
    enabled: linearEnv.ENABLED_LINEAR,
    installPath: LINEAR_INSTALL_PATH,
  })),

  listConnections: linearProcedure.query(async ({ ctx }) => {
    const rows = await LinearConnectionModel.listByScope(ctx.serverDB, ctx.scope);
    return rows.map((row) => LinearConnectionModel.toView(row));
  }),

  // ── Issue sync (Linear → tasks, one way; Linear is only read) ──

  listTeams: linearProcedure.input(connectionInput).query(async ({ ctx, input }) => {
    await requireConnection(ctx, input.connectionId);
    return callLinear(async () =>
      listLinearTeams(await getLinearAccessToken(ctx.serverDB, input.connectionId)),
    );
  }),

  listProjects: linearProcedure
    .input(connectionInput.extend({ teamId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireConnection(ctx, input.connectionId);
      return callLinear(async () =>
        listLinearProjects(
          await getLinearAccessToken(ctx.serverDB, input.connectionId),
          input.teamId,
        ),
      );
    }),

  listIssues: linearProcedure
    .input(issueFilterInput.extend({ cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await requireConnection(ctx, input.connectionId);
      return callLinear(async () =>
        syncService(ctx).listIssues(
          await getLinearAccessToken(ctx.serverDB, input.connectionId),
          input,
          input.cursor,
        ),
      );
    }),

  /**
   * Import (or re-sync) the picked issues into a LobeHub project. Runs in the
   * background; poll `listSyncJobs` for the outcome.
   */
  startImport: linearTaskWriteProcedure
    .input(
      projectInput.extend({
        connectionId: z.string().uuid(),
        issueIds: z.array(z.string().min(1)).min(1).max(MAX_IMPORT_ISSUES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireWritableConnection(ctx, input.connectionId);
      await requireProject(ctx, input.projectId);
      // Fail fast on a revoked token instead of queueing a job that cannot run.
      await callLinear(() => getLinearAccessToken(ctx.serverDB, input.connectionId));
      const id = await startJob(ctx, {
        connectionId: input.connectionId,
        issueIds: [...new Set(input.issueIds)],
        kind: 'issues',
        projectId: input.projectId,
      });
      return { id };
    }),

  /** The project's recent background syncs, newest first. */
  listSyncJobs: linearProcedure.input(projectInput).query(async ({ ctx, input }) => {
    await requireProject(ctx, input.projectId);
    const rows = await LinearSyncJobModel.listByProject(ctx.serverDB, ctx.scope, input.projectId);
    return rows.map((row) => toLinearSyncJobView(row));
  }),

  /** The sync rules a LobeHub project saved. */
  listSyncRules: linearProcedure.input(projectInput).query(async ({ ctx, input }) => {
    await requireProject(ctx, input.projectId);
    const rows = await LinearSyncRuleModel.listByProject(ctx.serverDB, ctx.scope, input.projectId);
    return rows.map((row) => LinearSyncRuleModel.toView(row));
  }),

  createSyncRule: linearTaskWriteProcedure
    .input(
      issueFilterInput.merge(projectInput).extend({
        linearProjectName: z.string().max(255).nullish(),
        teamName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireWritableConnection(ctx, input.connectionId);
      await requireProject(ctx, input.projectId);
      const row = await LinearSyncRuleModel.create(ctx.serverDB, {
        connectionId: input.connectionId,
        linearProjectId: input.linearProjectId ?? null,
        linearProjectName: input.linearProjectId ? (input.linearProjectName ?? null) : null,
        projectId: input.projectId,
        stateTypes: input.stateTypes,
        teamId: input.teamId,
        teamName: input.teamName,
        userId: ctx.userId,
        workspaceId: ctx.scope.workspaceId,
      });
      return LinearSyncRuleModel.toView(row);
    }),

  deleteSyncRule: linearTaskWriteProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await requireSyncRule(ctx, input.ruleId);
      // A rule stays removable after its connection is disconnected.
      await requireWritableScope(ctx);
      await LinearSyncRuleModel.delete(ctx.serverDB, rule.id, ctx.scope);
      return { ok: true };
    }),

  /**
   * Run a saved rule now, in the background. A run of the same rule that is
   * still going is returned instead of starting a second one.
   */
  startRuleSync: linearTaskWriteProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await requireSyncRule(ctx, input.ruleId);
      // The rule is in the caller's scope, and so is the connection it was
      // created with; a disconnected one fails below as "reconnect".
      await requireWritableScope(ctx);
      // Deleting the project deletes its rules; one the caller can no longer
      // see is not synced into.
      await requireProject(ctx, rule.projectId);
      await callLinear(() => getLinearAccessToken(ctx.serverDB, rule.connectionId));
      // Returns the run still going, if any; the check and insert are atomic.
      const id = await startLinearRuleSyncJob(
        ctx.serverDB,
        ctx.userId,
        ctx.scope.workspaceId ?? undefined,
        {
          connectionId: rule.connectionId,
          kind: 'rule',
          projectId: rule.projectId,
          ruleId: rule.id,
        },
      );
      return { id };
    }),
});

type LinearContext = {
  scope: { userId: string; workspaceId: string | null };
  serverDB: Parameters<typeof LinearConnectionModel.findById>[0];
  userId: string;
};

const syncService = (ctx: LinearContext) =>
  new LinearIssueSyncService(ctx.serverDB, ctx.userId, ctx.scope.workspaceId ?? undefined);

const startJob = (ctx: LinearContext, metadata: LinearSyncJobMetadata) =>
  startLinearSyncJob(ctx.serverDB, ctx.userId, ctx.scope.workspaceId ?? undefined, metadata);

/** The connection, if it is active and visible in the caller's scope. */
const requireConnection = async (ctx: LinearContext, connectionId: string) => {
  const connection = await LinearConnectionModel.findById(ctx.serverDB, connectionId);
  const inScope =
    !!connection &&
    !connection.revokedAt &&
    (ctx.scope.workspaceId
      ? connection.workspaceId === ctx.scope.workspaceId
      : connection.userId === ctx.userId && !connection.workspaceId);
  if (!inScope) throw new TRPCError({ code: 'NOT_FOUND', message: 'Linear connection not found' });
  return connection;
};

const requireSyncRule = async (ctx: LinearContext, ruleId: string) => {
  const rule = await LinearSyncRuleModel.findInScope(ctx.serverDB, ruleId, ctx.scope);
  if (!rule) throw new TRPCError({ code: 'NOT_FOUND', message: 'Linear sync rule not found' });
  return rule;
};

/** The LobeHub project, if the caller can see it; synced tasks land there. */
const requireProject = async (ctx: LinearContext, projectId: string) => {
  const project = await new ProjectModel(
    ctx.serverDB,
    ctx.userId,
    ctx.scope.workspaceId ?? undefined,
  ).findById(projectId);
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  return project;
};

/**
 * The connection, if it is active and visible in the caller's scope and the
 * caller may write there (in a workspace that takes a member role).
 */
const requireWritableConnection = async (ctx: LinearContext, connectionId: string) => {
  const connection = await requireConnection(ctx, connectionId);
  await requireWritableScope(ctx);
  return connection;
};

/** In a workspace, only members who can edit may change its Linear setup. */
const requireWritableScope = async (ctx: LinearContext) => {
  if (!(await canWriteScmScope(ctx.serverDB, ctx.userId, ctx.scope.workspaceId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'workspace member role required' });
  }
};

export type LinearRouter = typeof linearRouter;
