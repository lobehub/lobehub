import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { DEFAULT_WORKSPACE_AGENT_SELECTION_POLICIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { SQL } from 'drizzle-orm';
import { and, eq, inArray } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import {
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  devices,
  documents,
  sessions,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import {
  collectBoundDeviceIds,
  sanitizeAgencyConfigsForWorkspace,
} from '../../utils/agencyConfigDevices';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * The state and scope predicates every `AgentModel` operation shares. Built once
 * per model instance; the operation modules receive it as their first argument.
 */
export interface AgentModelContext {
  agentsFilesOwnership: () => SQL | undefined;
  agentsKnowledgeBasesOwnership: () => SQL | undefined;
  agentsToSessionsOwnership: () => SQL | undefined;
  assertFixedExecutionTarget: (
    agentWorkspaceId: string | null,
    agencyConfig: LobeAgentAgencyConfig | null | undefined,
  ) => Promise<void>;
  assertWorkspaceDeviceBinding: (
    agentWorkspaceId: string | null,
    agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
    storedConfig?: LobeAgentAgencyConfig | null,
  ) => Promise<void>;
  collectBoundDeviceIds: (
    agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
  ) => string[];
  db: LobeChatDatabase;
  documentsOwnership: () => SQL | undefined;
  ownership: () => SQL | undefined;
  sanitizeAgencyConfigForWorkspace: (
    db: LobeChatDatabase | Transaction,
    targetWorkspaceId: string,
    agencyConfigs: Array<LobeAgentAgencyConfig | null | undefined>,
    options?: { viewerUserId?: string },
  ) => Promise<Array<LobeAgentAgencyConfig | null>>;
  sessionsOwnership: () => SQL | undefined;
  trashScope: () => SQL | undefined;
  userId: string;
  withWorkspaceSelectionPolicyDefaults: (
    agencyConfig: LobeAgentAgencyConfig | null | undefined,
  ) => LobeAgentAgencyConfig | null | undefined;
  workspaceId?: string;
}

export const createAgentModelContext = ({
  db,
  userId,
  workspaceId,
}: Pick<AgentModelContext, 'db' | 'userId' | 'workspaceId'>): AgentModelContext => {
  const ctx: AgentModelContext = {
    db,
    userId,
    workspaceId,

    /**
     * Compat-mode ownership predicate for the `agents` table.
     * - team mode (workspaceId set): `workspace_id = ?` plus visibility-aware
     *   filtering — public agents are visible to every member, private agents
     *   are only visible to their creator.
     * - personal mode: `user_id = ? AND workspace_id IS NULL`.
     */
    ownership: () =>
      buildWorkspaceWhere(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          isDeleted: agents.isDeleted,
          userId: agents.userId,
          workspaceId: agents.workspaceId,
          visibility: agents.visibility,
        },
      ),

    /**
     * {@link ownership} without the recycle-bin filter — restore / purge / the
     * trash pre-flight lock only.
     */
    trashScope: () =>
      buildWorkspaceWhere(
        { includeTrashed: true, userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          isDeleted: agents.isDeleted,
          userId: agents.userId,
          workspaceId: agents.workspaceId,
          visibility: agents.visibility,
        },
      ),

    /** Same predicate but for the `sessions` table (used in delete cascade). */
    sessionsOwnership: () =>
      buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, sessions),

    /** Ownership predicates for the agent join/related tables. */
    documentsOwnership: () =>
      buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, documents),

    agentsFilesOwnership: () =>
      buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, agentsFiles),

    agentsKnowledgeBasesOwnership: () =>
      buildWorkspaceWhere(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        agentsKnowledgeBases,
      ),

    agentsToSessionsOwnership: () =>
      buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, agentsToSessions),

    /**
     * New workspace agents persist both selection policies instead of relying
     * on the intentionally different legacy fallbacks for missing values.
     */
    withWorkspaceSelectionPolicyDefaults: (
      agencyConfig: LobeAgentAgencyConfig | null | undefined,
    ): LobeAgentAgencyConfig | null | undefined => {
      if (!ctx.workspaceId) return agencyConfig;

      return {
        ...DEFAULT_WORKSPACE_AGENT_SELECTION_POLICIES,
        ...agencyConfig,
      };
    },

    collectBoundDeviceIds: (
      agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
    ): string[] => collectBoundDeviceIds(agencyConfig),

    /**
     * Shared ownership-rehoming device sanitation — see
     * `sanitizeAgencyConfigsForWorkspace` in `utils/agencyConfigDevices`.
     */
    sanitizeAgencyConfigForWorkspace: (
      db: LobeChatDatabase | Transaction,
      targetWorkspaceId: string,
      agencyConfigs: Array<LobeAgentAgencyConfig | null | undefined>,
      options?: { viewerUserId?: string },
    ): Promise<Array<LobeAgentAgencyConfig | null>> =>
      sanitizeAgencyConfigsForWorkspace(db, targetWorkspaceId, agencyConfigs, options),

    /**
     * Enforce: a workspace-scoped agent may only bind devices enrolled in the
     * same workspace. Personal devices (workspace_id IS NULL) are reachable only
     * by their owning user, so a workspace member who isn't that owner would get
     * a broken agent. Rejects at write time rather than at execution time.
     *
     * Only device ids INTRODUCED by this patch are checked — ids already present
     * in `storedConfig` are grandfathered. Client patches spread the whole stored
     * `agencyConfig` (device picker, working-dir writes), so a legacy
     * personal-device reference left from before the agent joined the workspace
     * (or before this guard existed) would otherwise poison every future save,
     * including binding a perfectly valid workspace device.
     *
     * No-op when `agentWorkspaceId` is null (personal agent — any device OK) or
     * when the patch carries no new device ids.
     */
    assertWorkspaceDeviceBinding: async (
      agentWorkspaceId: string | null,
      agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
      storedConfig?: LobeAgentAgencyConfig | null,
    ): Promise<void> => {
      if (!agentWorkspaceId) return;
      const existing = new Set(ctx.collectBoundDeviceIds(storedConfig));
      const candidates = ctx.collectBoundDeviceIds(agencyConfig).filter((id) => !existing.has(id));
      if (candidates.length === 0) return;

      const rows = await ctx.db
        .select({ deviceId: devices.deviceId })
        .from(devices)
        .where(
          and(eq(devices.workspaceId, agentWorkspaceId), inArray(devices.deviceId, candidates)),
        );
      const allowed = new Set(rows.map((r) => r.deviceId));
      const invalid = candidates.find((id) => !allowed.has(id));
      if (invalid) {
        throw new TRPCError({
          cause: { data: { code: 'WorkspaceAgentRequiresWorkspaceDevice', deviceId: invalid } },
          code: 'FORBIDDEN',
          message:
            'Workspace agent can only bind devices enrolled in the same workspace. ' +
            'Enroll the device to the workspace, or pick a workspace device.',
        });
      }
    },

    /**
     * A fixed workspace agent is a shared execution contract. It may use any
     * server-resolvable shared target; a concrete device additionally has to be
     * public in the same workspace. Use one generic device error for
     * missing/private/cross-workspace rows so the write path never reveals a
     * device the caller cannot otherwise see.
     */
    assertFixedExecutionTarget: async (
      agentWorkspaceId: string | null,
      agencyConfig: LobeAgentAgencyConfig | null | undefined,
    ): Promise<void> => {
      if (!agentWorkspaceId || agencyConfig?.executionTargetSelectionPolicy !== 'fixed') return;

      if (
        !agencyConfig.executionTarget ||
        !['auto', 'device', 'none', 'sandbox'].includes(agencyConfig.executionTarget)
      ) {
        throw new TRPCError({
          cause: { data: { code: 'FixedAgentRequiresSharedExecutionTarget' } },
          code: 'BAD_REQUEST',
          message: 'A fixed workspace agent requires a shared execution target.',
        });
      }

      if (agencyConfig.executionTarget !== 'device') return;

      if (!agencyConfig.boundDeviceId) {
        throw new TRPCError({
          cause: { data: { code: 'FixedAgentRequiresDeviceTarget' } },
          code: 'BAD_REQUEST',
          message: 'A fixed device target requires a bound device.',
        });
      }

      const row = await ctx.db.query.devices.findFirst({
        columns: { deviceId: true },
        where: and(
          eq(devices.workspaceId, agentWorkspaceId),
          eq(devices.deviceId, agencyConfig.boundDeviceId),
          eq(devices.visibility, 'public'),
        ),
      });

      if (!row) {
        throw new TRPCError({
          cause: { data: { code: 'FixedAgentRequiresPublicWorkspaceDevice' } },
          code: 'PRECONDITION_FAILED',
          message: 'A fixed workspace agent requires a public device from the same workspace.',
        });
      }
    },
  };

  return ctx;
};
