import { BUILTIN_AGENT_SLUGS, getAgentPersistConfig } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID, isHeterogeneousAgentModelId } from '@lobechat/const';
import type { AgentRankItem, LobeAgentAgencyConfig } from '@lobechat/types';
import {
  DEFAULT_WORKSPACE_AGENT_SELECTION_POLICIES,
  pruneWorkingDirByDeviceDeletes,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  like,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';

import type { AgentItem } from '../schemas';
import {
  agentBotProviders,
  agentCronJobs,
  agentLabelAssignments,
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  briefs,
  chatGroups,
  chatGroupsAgents,
  devices,
  documents,
  files,
  knowledgeBases,
  messages,
  sessionGroups,
  sessions,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
  taskTopics,
  threads,
  topics,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { resolveGroupMembershipType } from '../utils/groupMembership';
import { normalizeInboxAgentMeta } from '../utils/inboxAgent';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from './agentCopyJob';
import {
  AGENT_TRANSFER_IN_PROGRESS,
  AgentTransferJobModel,
  getAgentTransferSyncMessageThreshold,
  rewriteMessageScopeForTopics,
  rewriteResidualMessageScope,
} from './agentTransferJob';
import {
  hasForeignTopicComments,
  syncTopicCommentsOnTopicTransfer,
  TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
} from './topicComment';

/**
 * Fields the Agent Builder's own row (`slug = BUILTIN_AGENT_SLUGS.agentBuilder`) must never
 * carry. Its `persist` config only stores `model`/`provider`/`chatConfig` — title, avatar,
 * systemRole, etc. are rendered from i18n / the static systemRoleTemplate at runtime, never
 * from this row.
 *
 * Before PR #16420, `lobe-agent-management`'s self-management prompt could make the builder
 * mistake an ambiguous "update this" request for editing itself instead of the target agent.
 * Depending on caller (browser client tool executor vs. gateway server runtime in
 * `apps/server/src/services/toolExecution/serverRuntimes/agentBuilder.ts`), these fields can
 * arrive through *either* `AgentModel.update()` or `updateConfig()` — e.g. the gateway's
 * `updatePrompt` writes `systemRole` via `update()`, while the browser client's meta editor
 * writes `title`/`avatar`/etc. via `updateConfig()`. So both methods must strip the full list,
 * not just the fields each historically happened to receive. Clients on builds older than
 * PR #16420 can still hit this path, so enforce it here (the single write chokepoint)
 * regardless of caller.
 */
const AGENT_BUILDER_PROTECTED_FIELDS = [
  'title',
  'name',
  'description',
  'avatar',
  'backgroundColor',
  'tags',
  'marketIdentifier',
  'systemRole',
] as const;

/**
 * Fields that define a row's identity, scope and provisioning status. Every one of
 * them feeds authorization — `slug` + `virtual` classify collaborative builtins,
 * `userId` is authorship, `workspaceId` is the tenancy boundary, and `visibility`
 * has dedicated creator/owner-gated endpoints — so an update must never carry them. `updateConfig` merges whatever the passthrough config endpoint
 * receives, which would otherwise let a member with edit access declassify, orphan
 * or rehome a shared builtin through the very path that was opened for editing it.
 *
 * Creation is different: it legitimately assigns `slug` (random by default) and
 * takes `userId` / `workspaceId` from the trusted context via
 * `buildWorkspacePayload`, so only reserved slugs are filtered there.
 */
const IMMUTABLE_AGENT_FIELDS = [
  'createdAt',
  'id',
  // Folder placement is shared state and has its own validated path
  // (`updateSessionGroupId`), which checks the target is visible in scope and
  // matches the agent's visibility bucket. Riding along in a config patch
  // would skip both, leaving the shared row in a folder the sidebar cannot
  // resolve — it then renders in Ungrouped for every member.
  'sessionGroupId',
  'slug',
  'userId',
  'virtual',
  // `visibility` has its own authorization rules (`setVisibility` is creator /
  // workspace-owner gated, `publishToWorkspace` is creator-only), so it must not
  // ride along in a config patch: a member with edit access on a collaborative
  // builtin could otherwise flip it to `private`, hiding the shared row from
  // everyone else while its workspace slug stays occupied — nothing can
  // reprovision it.
  'visibility',
  'workspaceId',
] as const;

/**
 * Accepted shape for a user-chosen slug: lowercase words joined by single
 * hyphens, matching what `randomSlug` generates. No underscores — the agent
 * route tells an id from a slug by the underscore in every generated id.
 */
const AGENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Slugs owned by builtin provisioning; user input must never set one. */
const RESERVED_AGENT_SLUGS: ReadonlySet<string> = new Set<string>(
  Object.values(BUILTIN_AGENT_SLUGS),
);

/** One chat group an agent belongs to, as surfaced by the transfer guards. */
export interface AgentGroupMembershipRef {
  agentId: string;
  /** `null` when the group is not visible to the caller (see the read below). */
  groupAvatar: string | null;
  groupBackgroundColor: string | null;
  /**
   * `null` when the group is not visible to the caller. The id is identity
   * too: the membership still counts toward the guard, but a private group's
   * identifier is no more the caller's to read than its name.
   */
  groupId: string | null;
  /** `null` when the group is not visible to the caller (see the read below). */
  groupTitle: string | null;
  /**
   * Whether the caller may see this group at all. Carried explicitly because a
   * `null` title is otherwise ambiguous — a group can simply be untitled — and
   * telling someone a group of theirs is "one you cannot see" is worse than
   * saying nothing.
   */
  groupVisible: boolean;
}

export const AGENT_OWNED_BY_GROUP = 'AGENT_OWNED_BY_GROUP';

/**
 * Refusal to move an agent that belongs to a chat group rather than to the
 * user. Carries the groups so the caller can say WHICH ones, the way the
 * existing visibility guards do — "cannot move this agent" with no reason is
 * a dead end for the person looking at it.
 */
export class AgentOwnedByGroupError extends Error {
  constructor(readonly groups: AgentGroupMembershipRef[]) {
    super(AGENT_OWNED_BY_GROUP);
    this.name = 'AgentOwnedByGroupError';
  }
}

export class AgentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * New workspace agents persist both selection policies instead of relying
   * on the intentionally different legacy fallbacks for missing values.
   */
  private withWorkspaceSelectionPolicyDefaults = (
    agencyConfig: LobeAgentAgencyConfig | null | undefined,
  ): LobeAgentAgencyConfig | null | undefined => {
    if (!this.workspaceId) return agencyConfig;

    return {
      ...DEFAULT_WORKSPACE_AGENT_SELECTION_POLICIES,
      ...agencyConfig,
    };
  };

  /**
   * Rank the user's agents by topic count (agent usage ranking). Counts topics
   * directly via `topics.agentId`, so it is agent-native — no sessionId. Mirrors
   * the recents filter: real agents plus the inbox, excluding other virtual agents.
   */
  rank = async (limit: number = 10): Promise<AgentRankItem[]> => {
    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        count: count(topics.id).as('count'),
        id: agents.id,
        name: agents.name,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .leftJoin(topics, eq(topics.agentId, agents.id))
      .where(and(this.ownership(), or(eq(agents.slug, INBOX_SESSION_ID), ne(agents.virtual, true))))
      .groupBy(agents.id)
      .having(({ count }) => gt(count, 0))
      .orderBy(desc(sql`count`))
      .limit(limit);

    return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
  };

  /**
   * Compat-mode ownership predicate for the `agents` table.
   * - team mode (workspaceId set): `workspace_id = ?` plus visibility-aware
   *   filtering — public agents are visible to every member, private agents
   *   are only visible to their creator.
   * - personal mode: `user_id = ? AND workspace_id IS NULL`.
   */
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: agents.userId,
        workspaceId: agents.workspaceId,
        visibility: agents.visibility,
      },
    );

  /** Same predicate but for the `sessions` table (used in delete cascade). */
  private sessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, sessions);

  /** Ownership predicates for the agent join/related tables. */
  private documentsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents);

  private agentsFilesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsFiles);

  private agentsKnowledgeBasesOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentsKnowledgeBases,
    );

  private agentsToSessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsToSessions);

  /**
   * Collect device ids that an incoming `agencyConfig` patch is *setting*
   * (not clearing). `workingDirByDevice` entries with `undefined` value are
   * deletes (per `pruneWorkingDirByDeviceDeletes`) and are skipped.
   */
  private collectBoundDeviceIds = (
    agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
  ): string[] => {
    if (!agencyConfig) return [];
    const ids: string[] = [];
    const bound = agencyConfig.boundDeviceId;
    if (typeof bound === 'string' && bound) ids.push(bound);
    const map = agencyConfig.workingDirByDevice;
    if (map) {
      for (const [deviceId, cwd] of Object.entries(map)) {
        if (cwd === undefined) continue;
        ids.push(deviceId);
      }
    }
    return ids;
  };

  /**
   * Strip device bindings that are not enrolled in `targetWorkspaceId`, and
   * downgrade `fixed` device execution targets that can no longer be resolved.
   * Any `boundDeviceId` / `workingDirByDevice` entry pointing outside the
   * target workspace is dropped, and a `fixed` device target without a valid
   * public device is downgraded to `member` (defaulting to the caller's own
   * device). Shared by `transferAgents` (moving a row into a workspace) and
   * `duplicate` (copying a row into the caller's workspace): both re-home the
   * row to a new owner, so a leftover reference to a device only the previous
   * owner can reach would otherwise point the re-homed agent at a target
   * nobody else can resolve.
   */
  private sanitizeAgencyConfigForWorkspace = async (
    db: LobeChatDatabase | Transaction,
    targetWorkspaceId: string,
    agencyConfigs: Array<LobeAgentAgencyConfig | null | undefined>,
  ): Promise<Array<LobeAgentAgencyConfig | null>> => {
    const allCandidateIds = [
      ...new Set(agencyConfigs.flatMap((config) => this.collectBoundDeviceIds(config))),
    ];
    const deviceRows =
      allCandidateIds.length > 0
        ? await db
            .select({ deviceId: devices.deviceId, visibility: devices.visibility })
            .from(devices)
            .where(
              and(
                eq(devices.workspaceId, targetWorkspaceId),
                inArray(devices.deviceId, allCandidateIds),
              ),
            )
        : [];
    const allowed = new Set(deviceRows.map((r) => r.deviceId));
    const publicDeviceIds = new Set(
      deviceRows.filter((r) => r.visibility === 'public').map((r) => r.deviceId),
    );

    return agencyConfigs.map((config) => {
      let next: LobeAgentAgencyConfig | null = config ?? null;
      if (!next) return next;

      const candidateIds = this.collectBoundDeviceIds(next);
      if (candidateIds.length > 0) {
        const cleaned: LobeAgentAgencyConfig = { ...next };
        if (cleaned.boundDeviceId && !allowed.has(cleaned.boundDeviceId)) {
          delete cleaned.boundDeviceId;
        }
        if (cleaned.workingDirByDevice) {
          const filtered: Record<string, string> = {};
          for (const [deviceId, cwd] of Object.entries(cleaned.workingDirByDevice)) {
            if (allowed.has(deviceId) && typeof cwd === 'string') filtered[deviceId] = cwd;
          }
          cleaned.workingDirByDevice = Object.keys(filtered).length > 0 ? filtered : undefined;
        }
        if (
          cleaned.executionTargetSelectionPolicy === 'fixed' &&
          cleaned.executionTarget === 'device' &&
          (!cleaned.boundDeviceId || !allowed.has(cleaned.boundDeviceId))
        ) {
          cleaned.executionTargetSelectionPolicy = 'member';
        }
        next = cleaned;
      }

      if (
        next.executionTargetSelectionPolicy === 'fixed' &&
        (!next.executionTarget ||
          !['auto', 'device', 'none', 'sandbox'].includes(next.executionTarget))
      ) {
        next.executionTargetSelectionPolicy = 'member';
      }

      if (
        next.executionTargetSelectionPolicy === 'fixed' &&
        next.executionTarget === 'device' &&
        (!next.boundDeviceId || !publicDeviceIds.has(next.boundDeviceId))
      ) {
        next.executionTargetSelectionPolicy = 'member';
      }

      return next;
    });
  };

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
  private assertWorkspaceDeviceBinding = async (
    agentWorkspaceId: string | null,
    agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
    storedConfig?: LobeAgentAgencyConfig | null,
  ): Promise<void> => {
    if (!agentWorkspaceId) return;
    const existing = new Set(this.collectBoundDeviceIds(storedConfig));
    const candidates = this.collectBoundDeviceIds(agencyConfig).filter((id) => !existing.has(id));
    if (candidates.length === 0) return;

    const rows = await this.db
      .select({ deviceId: devices.deviceId })
      .from(devices)
      .where(and(eq(devices.workspaceId, agentWorkspaceId), inArray(devices.deviceId, candidates)));
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
  };

  /**
   * A fixed workspace agent is a shared execution contract. It may use any
   * server-resolvable shared target; a concrete device additionally has to be
   * public in the same workspace. Use one generic device error for
   * missing/private/cross-workspace rows so the write path never reveals a
   * device the caller cannot otherwise see.
   */
  private assertFixedExecutionTarget = async (
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

    const row = await this.db.query.devices.findFirst({
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
  };

  getAgentConfigById = async (id: string) => {
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, id), this.ownership()),
    });

    if (!agent) return null;

    return this.enrichAgentWithKnowledge(agent);
  };

  /**
   * Returns the agent's visibility, scoped by the model's ownership filter, or
   * `null` when the agent is missing or not visible to the current caller.
   * Used by the task service to inherit a private agent's visibility onto
   * tasks created against it.
   */
  getAgentVisibility = async (id: string): Promise<'private' | 'public' | null> => {
    const rows = await this.db
      .select({ visibility: agents.visibility })
      .from(agents)
      .where(and(eq(agents.id, id), this.ownership()))
      .limit(1);
    return (rows[0]?.visibility as 'private' | 'public' | undefined) ?? null;
  };

  existsById = async (id: string): Promise<boolean> => {
    const rows = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), this.ownership()))
      .limit(1);

    return rows.length > 0;
  };

  /**
   * Stricter than {@link existsById}: the agent must be owned (created) by this
   * user, regardless of workspace visibility. `existsById` uses the visibility
   * -aware ownership predicate, so a *public* workspace agent created by another
   * member also returns true — which is only "can see", not "can edit". Callers
   * that bind credentials/config to an agent (e.g. agent-scoped connectors) must
   * use this so a member can't attach an account to someone else's shared agent.
   */
  existsOwnedById = async (id: string): Promise<boolean> => {
    const rows = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, this.userId)))
      .limit(1);

    return rows.length > 0;
  };

  /**
   * Lightweight lookup of an agent's currently-configured model + provider,
   * used to snapshot the model into a task config so later changes to the
   * agent's default model don't silently affect already-created tasks.
   * Returns null when the agent has no model/provider set, or the agent
   * cannot be found for this user.
   */
  getAgentModelConfig = async (
    idOrSlug: string,
  ): Promise<{ model: string; provider: string } | null> => {
    const rows = await this.db
      .select({ model: agents.model, provider: agents.provider })
      .from(agents)
      .where(and(this.ownership(), or(eq(agents.id, idOrSlug), eq(agents.slug, idOrSlug))))
      .limit(1);

    const row = rows[0];
    if (!row || !row.model || !row.provider) return null;
    return { model: row.model, provider: row.provider };
  };

  /**
   * Single-SELECT lookup of the fields `TaskService.createTask` needs in one
   * round-trip: the model/provider snapshot (for `task.config`) and the
   * visibility (for inference + cross-table invariant assertion). Replaces
   * the previous two-query path (`getAgentModelConfig` + `getAgentVisibility`).
   *
   * Returns `null` when the agent is not visible to the current caller. When
   * found, `snapshot` is non-null only if both `model` and `provider` are set
   * — same contract as `getAgentModelConfig`.
   */
  getAgentSnapshotForTaskCreate = async (
    idOrSlug: string,
  ): Promise<{
    snapshot: { model: string; provider: string } | null;
    visibility: 'private' | 'public';
  } | null> => {
    const rows = await this.db
      .select({
        model: agents.model,
        provider: agents.provider,
        visibility: agents.visibility,
      })
      .from(agents)
      .where(and(this.ownership(), or(eq(agents.id, idOrSlug), eq(agents.slug, idOrSlug))))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    const snapshot =
      row.model && row.provider ? { model: row.model, provider: row.provider } : null;
    return { snapshot, visibility: row.visibility as 'private' | 'public' };
  };

  /**
   * Build the where condition shared by queryAgents / countAgents:
   * non-virtual agents of the current user, with optional keyword filter.
   */
  private buildQueryAgentsWhere = (keyword?: string) => {
    // Include agents where virtual is false OR null (legacy data without virtual field)
    const baseConditions = and(
      this.ownership(),
      or(eq(agents.virtual, false), isNull(agents.virtual)),
    );

    // Add keyword search condition if provided
    return keyword
      ? and(
          baseConditions,
          or(ilike(agents.title, `%${keyword}%`), ilike(agents.description, `%${keyword}%`)),
        )
      : baseConditions;
  };

  /**
   * Query non-virtual agents with optional keyword filter.
   * Returns minimal agent info (id, title, description, avatar, backgroundColor),
   * plus `userId`/`visibility` so callers can gate per-agent actions (e.g.
   * transfer is creator/primary-owner only), and a compact `heteroType` derived
   * from `agencyConfig` so callers can tell which results are heterogeneous
   * (external CLI/device) agents.
   * Excludes virtual agents (like inbox, supervisors, etc).
   */
  queryAgents = async (params?: { keyword?: string; limit?: number; offset?: number }) => {
    const { keyword, limit = 9999, offset = 0 } = params ?? {};
    const searchCondition = this.buildQueryAgentsWhere(keyword);

    const rows = await this.db
      .select({
        agencyConfig: agents.agencyConfig,
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        description: agents.description,
        id: agents.id,
        name: agents.name,
        slug: agents.slug,
        title: agents.title,
        userId: agents.userId,
        visibility: agents.visibility,
      })
      .from(agents)
      .where(searchCondition)
      .orderBy(desc(agents.updatedAt))
      .limit(limit)
      .offset(offset);

    // Surface only the hetero runtime type, not the full agencyConfig payload.
    return rows.map(({ slug, agencyConfig, ...row }) =>
      normalizeInboxAgentMeta(
        { ...row, heteroType: agencyConfig?.heterogeneousProvider?.type },
        { slug },
      ),
    );
  };

  /**
   * Count non-virtual agents matching the same conditions as queryAgents.
   * Used to report real totals (and pagination) when queryAgents is limited.
   * Accepts the same date filters as SessionModel.count so callers can compare
   * current vs. prior-period totals without falling back to the legacy
   * sessions table.
   */
  countAgents = async (params?: {
    endDate?: string;
    keyword?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({ count: count() })
      .from(agents)
      .where(
        genWhere([
          this.buildQueryAgentsWhere(params?.keyword),
          params?.range
            ? genRangeWhere(params.range, agents.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, agents.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, agents.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return result[0]?.count ?? 0;
  };

  /**
   * Get minimal agent info (avatar, title, backgroundColor) by IDs.
   * For inbox agent (slug='inbox'), falls back to LobeAI defaults when avatar/title are missing.
   */
  getAgentAvatarsByIds = async (ids: string[]) => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        name: agents.name,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(and(this.ownership(), inArray(agents.id, ids)));

    return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
  };

  /**
   * List agents bindable by the System Bot messenger picker: real agents plus
   * the inbox (other virtual agents excluded), ordered by `updatedAt DESC` with
   * the inbox pinned to the top.
   *
   * Returns `name` and `title` separately — resolving them into one label is the
   * caller's job (see `agentDisplayName`), since only the caller knows whether it
   * can render an i18n fallback. `title` is still normalized here for the inbox
   * (LobeAI default) and falls back to `options.fallbackTitle` when blank
   * (default `null`, so a client caller can supply its own i18n default).
   */
  listMessengerBindableAgents = async (options?: {
    fallbackTitle?: string | null;
  }): Promise<
    Array<{
      avatar: string | null;
      backgroundColor: string | null;
      id: string;
      isInbox: boolean;
      isPrivate: boolean;
      name: string | null;
      title: string | null;
    }>
  > => {
    const fallbackTitle = options?.fallbackTitle ?? null;

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        name: agents.name,
        slug: agents.slug,
        title: agents.title,
        visibility: agents.visibility,
      })
      .from(agents)
      .where(and(this.ownership(), or(ne(agents.virtual, true), eq(agents.slug, INBOX_SESSION_ID))))
      .orderBy(desc(agents.updatedAt));

    const normalized = rows
      .filter((row) => row.id)
      .map(({ slug, visibility, ...row }) => {
        const meta = normalizeInboxAgentMeta(row, { slug });
        return {
          avatar: meta.avatar,
          backgroundColor: meta.backgroundColor,
          id: meta.id,
          isInbox: slug === INBOX_SESSION_ID,
          // Only meaningful in workspace mode: the ownership predicate already
          // scopes visible private rows to the caller, so `isPrivate` means
          // "the caller's own private agent in this workspace". Personal-mode
          // rows are all implicitly private, so the flag stays false there to
          // signal "no grouping needed".
          isPrivate: Boolean(this.workspaceId) && visibility === 'private',
          name: meta.name ?? null,
          // The inbox title is already resolved by normalizeInboxAgentMeta; any
          // other blank title falls back to the caller-provided default.
          title: meta.title?.trim() || fallbackTitle,
        };
      });

    // Pin the inbox agent to the top regardless of updatedAt — it's the
    // implicit "default" agent and should always be the first option.
    const inboxIdx = normalized.findIndex((row) => row.isInbox);
    if (inboxIdx > 0) {
      const [inbox] = normalized.splice(inboxIdx, 1);
      normalized.unshift(inbox);
    }

    return normalized;
  };

  /**
   * Get agent config by ID or slug (single query with OR condition)
   */
  getAgentConfig = async (idOrSlug: string) => {
    // Prefer an exact ID match over a slug match. The combined `or(id, slug)`
    // query has no inherent ordering, so resolve ID first for determinism.
    const agent =
      (await this.db.query.agents.findFirst({
        where: and(this.ownership(), eq(agents.id, idOrSlug)),
      })) ??
      (await this.db.query.agents.findFirst({
        where: and(this.ownership(), eq(agents.slug, idOrSlug)),
      }));

    if (!agent) return null;

    return this.enrichAgentWithKnowledge(agent);
  };

  /**
   * Enrich agent with knowledge base and files data
   */
  private enrichAgentWithKnowledge = async (agent: AgentItem) => {
    const knowledge = await this.getAgentAssignedKnowledge(agent.id);
    const normalizedAgent = normalizeInboxAgentMeta(agent, { slug: agent.slug });

    // Fetch document content for enabled files
    const enabledFileIds = knowledge.files
      .filter((f) => f.enabled)
      .map((f) => f.id)
      .filter((id) => id !== undefined);
    let files: Array<(typeof knowledge.files)[number] & { content?: string | null }> =
      knowledge.files;

    if (enabledFileIds.length > 0) {
      const documentsData = await this.db.query.documents.findMany({
        where: and(this.documentsOwnership(), inArray(documents.fileId, enabledFileIds)),
      });

      const documentMap = new Map(documentsData.map((doc) => [doc.fileId, doc.content]));
      files = knowledge.files.map((file) => ({
        ...file,
        content: file.enabled && file.id ? documentMap.get(file.id) : undefined,
      }));
    }

    return { ...normalizedAgent, ...knowledge, files };
  };

  getAgentAssignedKnowledge = async (id: string) => {
    // The junction tables carry the mount (created by whoever wired the agent
    // to the KB / file); the ownership() predicates below match the caller's
    // own mount rows within the same workspace.
    //
    // The joined `knowledgeBases` / `files` rows also need a visibility guard
    // in the `leftJoin` ON clause: without it, a KB or file that was later
    // flipped back to `private` via `setVisibility` would keep
    // leaking its name / description into every mounted-agent view across the
    // workspace. Enforcing the guard on the ON clause (rather than WHERE)
    // keeps the mount row in the result but nulls out the referenced entity —
    // callers can then treat `id === null` as "unavailable" and render a
    // placeholder in the editor list, while `resolveAgentKnowledgeBaseIds` in
    // the runtime naturally skips such rows via its `k.id` filter.
    const [knowledgeBaseResult, fileResult] = await Promise.all([
      this.db
        .select({ enabled: agentsKnowledgeBases.enabled, knowledgeBases })
        .from(agentsKnowledgeBases)
        .where(and(eq(agentsKnowledgeBases.agentId, id), this.agentsKnowledgeBasesOwnership()))
        .orderBy(desc(agentsKnowledgeBases.createdAt))
        .leftJoin(
          knowledgeBases,
          and(
            eq(knowledgeBases.id, agentsKnowledgeBases.knowledgeBaseId),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              knowledgeBases,
            ),
          ),
        ),
      this.db
        .select({ enabled: agentsFiles.enabled, files })
        .from(agentsFiles)
        .where(and(eq(agentsFiles.agentId, id), this.agentsFilesOwnership()))
        .orderBy(desc(agentsFiles.createdAt))
        .leftJoin(
          files,
          and(
            eq(files.id, agentsFiles.fileId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
          ),
        ),
    ]);

    return {
      files: fileResult.map((item) => ({
        ...item.files,
        enabled: item.enabled,
      })),
      knowledgeBases: knowledgeBaseResult.map((item) => ({
        ...item.knowledgeBases,
        enabled: item.enabled,
      })),
    };
  };

  /**
   * Find agent by session id
   */
  findBySessionId = async (sessionId: string) => {
    const item = await this.db.query.agentsToSessions.findFirst({
      where: and(eq(agentsToSessions.sessionId, sessionId), this.agentsToSessionsOwnership()),
    });

    if (!item) return;

    const agentId = item.agentId;

    return this.getAgentConfigById(agentId);
  };

  createAgentKnowledgeBase = async (
    agentId: string,
    knowledgeBaseId: string,
    enabled: boolean = true,
  ) => {
    return this.db
      .insert(agentsKnowledgeBases)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { agentId, enabled, knowledgeBaseId },
        ),
      );
  };

  deleteAgentKnowledgeBase = async (agentId: string, knowledgeBaseId: string) => {
    return this.db
      .delete(agentsKnowledgeBases)
      .where(
        and(
          eq(agentsKnowledgeBases.agentId, agentId),
          eq(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
          this.agentsKnowledgeBasesOwnership(),
        ),
      );
  };

  toggleKnowledgeBase = async (agentId: string, knowledgeBaseId: string, enabled?: boolean) => {
    return this.db
      .update(agentsKnowledgeBases)
      .set({ enabled })
      .where(
        and(
          eq(agentsKnowledgeBases.agentId, agentId),
          eq(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
          this.agentsKnowledgeBasesOwnership(),
        ),
      );
  };

  createAgentFiles = async (agentId: string, fileIds: string[], enabled: boolean = true) => {
    // Exclude the fileIds that already exist in agentsFiles, and then insert them
    const existingFiles = await this.db
      .select({ id: agentsFiles.fileId })
      .from(agentsFiles)
      .where(
        and(
          eq(agentsFiles.agentId, agentId),
          this.agentsFilesOwnership(),
          inArray(agentsFiles.fileId, fileIds),
        ),
      );

    const existingFilesIds = new Set(existingFiles.map((item) => item.id));

    const needToInsertFileIds = fileIds.filter((fileId) => !existingFilesIds.has(fileId));

    if (needToInsertFileIds.length === 0) return;

    return this.db
      .insert(agentsFiles)
      .values(
        needToInsertFileIds.map((fileId) =>
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            { agentId, enabled, fileId },
          ),
        ),
      );
  };

  deleteAgentFile = async (agentId: string, fileId: string) => {
    return this.db
      .delete(agentsFiles)
      .where(
        and(
          eq(agentsFiles.agentId, agentId),
          eq(agentsFiles.fileId, fileId),
          this.agentsFilesOwnership(),
        ),
      );
  };

  /**
   * Delete an agent and its associated session.
   * This will cascade delete messages, topics, etc. through the session deletion.
   */
  delete = async (agentId: string) => {
    return this.db.transaction(async (trx) => {
      // Lock the agent row BEFORE consulting the pending-copy guard — same
      // lock-then-guard order as transferAgents. A concurrent copy enqueue
      // locks the same source rows, so the guard here cannot run in the window
      // where the enqueue's job row exists but is not yet committed.
      await trx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), this.ownership()))
        .for('update');

      // The junction records every agent an unfinished job still maps, a
      // copy's TARGET included — and a group copy's drain writes those ids into
      // `messages.agent_id`. Deleting one leaves the queue rows behind, so the
      // drain hits a missing-agent FK and retries forever, stranding the copied
      // conversations as pending. Distinct from the source guard below: a copy
      // registers only its target here.
      if (await AgentTransferJobModel.hasPendingJobForAgents(trx, [agentId])) {
        throw new Error(AGENT_TRANSFER_IN_PROGRESS);
      }

      // Not covered above: a group transfer that left this agent behind and
      // took a clone does NOT register it as a covered agent (it never moved).
      // But its id is still the live value of `messages.agent_id` on every
      // topic the drain has not reached yet, and that column cascades — so
      // deleting it now would destroy the moved group history the remap is
      // partway through rescuing.
      if (await AgentTransferJobModel.hasPendingRemapForSourceAgents(trx, [agentId])) {
        throw new Error(AGENT_TRANSFER_IN_PROGRESS);
      }

      // A pending copy job still reads this agent's topics — deleting it would
      // cascade them away and the copy would silently complete with empty
      // conversations. Surface the in-progress state instead.
      if (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, [agentId])) {
        throw new Error(AGENT_COPY_IN_PROGRESS);
      }

      // 1. Get associated session IDs
      const links = await trx
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()));

      const sessionIds = links.map((link) => link.sessionId);

      // 2. Delete links in agentsToSessions
      await trx
        .delete(agentsToSessions)
        .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()));

      // 3. Delete associated sessions (this will cascade delete messages, topics, etc.)
      if (sessionIds.length > 0) {
        await trx
          .delete(sessions)
          .where(and(inArray(sessions.id, sessionIds), this.sessionsOwnership()));
      }

      // 4. Delete the agent itself
      return trx.delete(agents).where(and(eq(agents.id, agentId), this.ownership()));
    });
  };

  /**
   * Batch delete agents by IDs.
   * This is a simpler delete that only removes the agent records.
   * Use this for virtual agents that don't have associated sessions.
   */
  batchDelete = async (agentIds: string[]) => {
    if (agentIds.length === 0) return;

    return this.db.delete(agents).where(and(this.ownership(), inArray(agents.id, agentIds)));
  };

  toggleFile = async (agentId: string, fileId: string, enabled?: boolean) => {
    return this.db
      .update(agentsFiles)
      .set({ enabled })
      .where(
        and(
          eq(agentsFiles.agentId, agentId),
          eq(agentsFiles.fileId, fileId),
          this.agentsFilesOwnership(),
        ),
      );
  };

  /**
   * Builtin slugs are not decoration: `getBuiltinAgent` resolves infrastructure
   * agents BY slug, and authorization treats the collaborative ones as workspace
   * resources (`canPerformResourceAction`). A user-created row must therefore
   * never claim one — otherwise a member could squat `inbox` / `agent-builder`
   * before the real row is provisioned and have their own agent adopted as the
   * workspace's, with the shared-resource permissions that come with it.
   *
   * Every user-controlled write funnels through `create` / `batchCreate` (group
   * member batch-create takes a caller-supplied `slug`, as do imports and market
   * installs) or through `update` / `updateConfig` (the passthrough config
   * endpoint accepts one too — renaming an existing row is the same squat).
   * Builtin provisioning bypasses all four by inserting/updating directly inside
   * `getBuiltinAgent`, so dropping the field here closes every caller path at
   * once; on create the column's own default then assigns a random slug.
   */
  private stripImmutableFields = <T extends Record<string, any>>(data: T): T => {
    const carried = IMMUTABLE_AGENT_FIELDS.filter((field) => field in data);
    if (carried.length === 0) return data;

    const next = { ...data };
    for (const field of carried) delete next[field];
    return next;
  };

  private stripReservedSlug = <T extends { slug?: string | null }>(config: T): T => {
    if (!config.slug || !RESERVED_AGENT_SLUGS.has(config.slug)) return config;
    return { ...config, slug: undefined };
  };

  /**
   * Create an agent record only (without creating a session).
   * This is used for creating virtual agents (e.g., group chat members).
   */
  create = async (input: Partial<AgentItem>): Promise<AgentItem> => {
    const config = this.stripReservedSlug(input);
    const agencyConfig = this.withWorkspaceSelectionPolicyDefaults(config.agencyConfig);

    await this.assertWorkspaceDeviceBinding(this.workspaceId ?? null, agencyConfig);
    await this.assertFixedExecutionTarget(this.workspaceId ?? null, agencyConfig);

    const [result] = await this.db
      .insert(agents)
      .values([
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            ...config,
            agencyConfig,
            model: typeof config.model === 'string' ? config.model : null,
          },
        ),
      ])
      .returning();

    return result;
  };

  /**
   * Batch create multiple agents (without sessions).
   * Used for creating multiple virtual agents at once (e.g., group chat members).
   */
  batchCreate = async (configs: Partial<AgentItem>[]): Promise<AgentItem[]> => {
    if (configs.length === 0) return [];

    const normalizedConfigs = configs.map((config) => ({
      ...this.stripReservedSlug(config),
      agencyConfig: this.withWorkspaceSelectionPolicyDefaults(config.agencyConfig),
    }));

    await Promise.all(
      normalizedConfigs.flatMap((config) => [
        this.assertWorkspaceDeviceBinding(this.workspaceId ?? null, config.agencyConfig),
        this.assertFixedExecutionTarget(this.workspaceId ?? null, config.agencyConfig),
      ]),
    );

    return this.db
      .insert(agents)
      .values(
        normalizedConfigs.map((config) =>
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              ...config,
              model: typeof config.model === 'string' ? config.model : null,
            },
          ),
        ),
      )
      .returning();
  };

  update = async (agentId: string, data: Partial<AgentItem>) => {
    const sanitizedData = await this.stripAgentBuilderProtectedFields(
      agentId,
      this.stripImmutableFields(data),
    );

    return this.db
      .update(agents)
      .set({ ...sanitizedData, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), this.ownership()));
  };

  /**
   * Strip fields the Agent Builder's own row must never carry (see
   * {@link AGENT_BUILDER_PROTECTED_FIELDS}). Only looks up the target row's `slug` when the
   * incoming patch actually touches a protected field, so normal updates pay no extra query.
   */
  private stripAgentBuilderProtectedFields = async <T extends Record<string, any>>(
    agentId: string,
    data: T,
    protectedFields: readonly string[] = AGENT_BUILDER_PROTECTED_FIELDS,
  ): Promise<T> => {
    if (!protectedFields.some((field) => field in data)) return data;

    const agent = await this.db.query.agents.findFirst({
      columns: { slug: true },
      where: and(eq(agents.id, agentId), this.ownership()),
    });

    if (agent?.slug !== BUILTIN_AGENT_SLUGS.agentBuilder) return data;

    const sanitized = { ...data };
    for (const field of protectedFields) delete sanitized[field];
    return sanitized;
  };

  /**
   * Publish a private agent into the workspace. The `user_id = ?` +
   * `visibility = 'private'` guards lock the operation to the creator's own
   * still-private agent. The inverse transition (public → private) goes
   * through {@link setVisibility}, which the router gates to the creator or
   * a workspace owner.
   *
   * Use the existing `update` to change other fields; visibility is the only
   * one with these authorization rules.
   */
  publishToWorkspace = async (agentId: string) => {
    const agent = await this.db.query.agents.findFirst({
      columns: { agencyConfig: true, sessionGroupId: true, workspaceId: true },
      where: and(
        eq(agents.id, agentId),
        this.ownership(),
        eq(agents.userId, this.userId),
        eq(agents.visibility, 'private'),
      ),
    });

    if (!agent) {
      throw new Error('Agent not found, already published, or access denied');
    }

    // Re-check at the publication boundary. A legacy/stale fixed target may
    // predate the config-write guard; a concrete device must never be exposed
    // when workspace members cannot resolve it.
    await this.assertFixedExecutionTarget(agent.workspaceId, agent.agencyConfig);

    // Rehome exactly as `setVisibility` does: a folder cannot mix
    // visibilities, so publishing out of a private Category releases the
    // folder. Left in place the agent would be public while its folder is not,
    // and the sidebar would show it in Ungrouped rather than where it was
    // published from.
    const clearGroup = agent.sessionGroupId
      ? await this.getAssignableSessionGroupVisibility(agent.sessionGroupId)
          .then((visibility) => visibility !== 'public')
          .catch(() => true)
      : false;

    const [result] = await this.db
      .update(agents)
      .set({
        updatedAt: new Date(),
        visibility: 'public',
        ...(clearGroup ? { sessionGroupId: null } : {}),
      })
      .where(
        and(
          eq(agents.id, agentId),
          this.ownership(),
          eq(agents.userId, this.userId),
          eq(agents.visibility, 'private'),
        ),
      )
      .returning();

    if (!result) {
      throw new Error('Agent not found, already published, or access denied');
    }

    return result;
  };

  /**
   * Lightweight lookup used to authorize visibility changes: the agent's
   * creator, slug and current visibility, scoped by the ownership predicate
   * (other members' private agents resolve to `null`).
   */
  getAgentVisibilityMeta = async (
    id: string,
  ): Promise<{ slug: string | null; userId: string; visibility: 'private' | 'public' } | null> => {
    const rows = await this.db
      .select({ slug: agents.slug, userId: agents.userId, visibility: agents.visibility })
      .from(agents)
      .where(and(eq(agents.id, id), this.ownership()))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      slug: row.slug,
      userId: row.userId,
      visibility: (row.visibility as 'private' | 'public' | null) ?? 'public',
    };
  };

  /**
   * Bidirectional visibility switch. Authorization (creator OR
   * workspace owner, builtin agents excluded) is the router's responsibility —
   * this method only applies the ownership-scoped write.
   *
   * Uses UPDATE … RETURNING instead of a follow-up SELECT: when a workspace
   * owner demotes another member's agent to private, the post-update row no
   * longer matches the visibility-aware ownership predicate, so a read-back
   * would return 0 rows even though the write succeeded (same pattern as
   * TaskModel.updateVisibility).
   */
  setVisibility = async (agentId: string, visibility: 'private' | 'public') => {
    // A sidebar folder cannot mix visibilities (HomeRepository.processAgentList
    // buckets grouped items by item visibility under same-visibility groups),
    // so an agent crossing scopes while keyed to a group of the OLD scope
    // would be emitted nowhere and vanish from the sidebar. Rehome it to the
    // ungrouped section of its new scope when the group no longer matches.
    const [current] = await this.db
      .select({
        agencyConfig: agents.agencyConfig,
        groupVisibility: sessionGroups.visibility,
        workspaceId: agents.workspaceId,
      })
      .from(agents)
      .leftJoin(sessionGroups, eq(agents.sessionGroupId, sessionGroups.id))
      .where(and(eq(agents.id, agentId), this.ownership()))
      .limit(1);

    // `publishAgentToWorkspace` is the normal client path, but keep the
    // bidirectional visibility mutation equally safe for direct API callers.
    if (visibility === 'public' && current) {
      await this.assertFixedExecutionTarget(current.workspaceId, current.agencyConfig);
    }

    const groupVisibility = current?.groupVisibility as 'private' | 'public' | null | undefined;
    const clearGroup = groupVisibility != null && groupVisibility !== visibility;

    const [updated] = await this.db
      .update(agents)
      .set({
        updatedAt: new Date(),
        visibility,
        ...(clearGroup ? { sessionGroupId: null } : {}),
      })
      .where(and(eq(agents.id, agentId), this.ownership()))
      .returning();
    return updated ?? null;
  };

  touchUpdatedAt = async (agentId: string) => {
    return this.update(agentId, {});
  };

  /**
   * Check if an agent with the given marketIdentifier already exists
   * @returns true if exists, false otherwise
   */
  checkByMarketIdentifier = async (marketIdentifier: string): Promise<boolean> => {
    const result = await this.db.query.agents.findFirst({
      where: and(eq(agents.marketIdentifier, marketIdentifier), this.ownership()),
    });
    return !!result;
  };

  /**
   * Get an agent by marketIdentifier
   * If multiple agents match, returns the most recently updated one
   * @returns agent id if exists, null otherwise
   */
  getAgentByMarketIdentifier = async (marketIdentifier: string): Promise<string | null> => {
    const result = await this.db.query.agents.findFirst({
      columns: { id: true },
      orderBy: (agents, { desc }) => [desc(agents.updatedAt)],
      where: and(eq(agents.marketIdentifier, marketIdentifier), this.ownership()),
    });
    return result?.id ?? null;
  };

  /**
   * Get an agent by the forkedFromIdentifier stored in params
   * @param forkedFromIdentifier - The source agent's market identifier
   * @returns agent id if exists, null otherwise
   */
  getAgentByForkedFromIdentifier = async (forkedFromIdentifier: string): Promise<string | null> => {
    const result = await this.db.query.agents.findFirst({
      columns: { id: true },
      orderBy: (agents, { desc }) => [desc(agents.updatedAt)],
      where: and(
        this.ownership(),
        sql`${agents.params}->>'forkedFromIdentifier' = ${forkedFromIdentifier}`,
      ),
    });
    return result?.id ?? null;
  };

  updateConfig = async (agentId: string, input: PartialDeep<AgentItem> | undefined | null) => {
    if (!input || Object.keys(input).length === 0) return;

    const data = this.stripImmutableFields(input);

    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), this.ownership()),
    });

    if (!agent) return;

    await this.assertWorkspaceDeviceBinding(
      agent.workspaceId,
      data.agencyConfig,
      agent.agencyConfig,
    );

    // First process the params field: undefined means delete, null means disable flag
    const existingParams = agent.params ?? {};
    const updatedParams: Record<string, any> = { ...existingParams };

    if (data.params) {
      const incomingParams = data.params as Record<string, any>;
      Object.keys(incomingParams).forEach((key) => {
        const incomingValue = incomingParams[key];

        // undefined means explicitly delete this field
        if (incomingValue === undefined) {
          delete updatedParams[key];
          return;
        }

        // All other values (including null) are directly overwritten, null means disable this param on the frontend
        updatedParams[key] = incomingValue;
      });
    }

    // Build data to be merged, excluding params (processed separately)

    const { params: _params, ...restData } = data;

    // See AGENT_BUILDER_PROTECTED_FIELDS: some callers (e.g. the browser client's meta
    // editor) route title/avatar/etc. through updateConfig() rather than update().
    if (agent.slug === BUILTIN_AGENT_SLUGS.agentBuilder) {
      for (const field of AGENT_BUILDER_PROTECTED_FIELDS) delete restData[field];
    }

    const mergedValue = merge(agent, restData);

    // The inbox is LobeHub's built-in default cloud agent; it must never be
    // turned into a heterogeneous (external-CLI) agent. Two independent inputs can
    // flip it — a stray `agencyConfig.heterogeneousProvider`, and a legacy hetero
    // `model` id (amp / claude-code / codex / opencode), which AiAgentService still
    // treats as heterogeneous on its own even without a provider config. Either one
    // reroutes the whole chat surface through the device gateway and breaks it with
    // GATEWAY_NOT_CONFIGURED, so sanitize both at this write chokepoint regardless
    // of caller (mirrors AGENT_BUILDER_PROTECTED_FIELDS).
    if (agent.slug === INBOX_SESSION_ID) {
      if (mergedValue.agencyConfig?.heterogeneousProvider) {
        delete mergedValue.agencyConfig.heterogeneousProvider;
      }
      if (isHeterogeneousAgentModelId(mergedValue.model)) {
        mergedValue.model = null;
      }
    }

    // A ReasoningGraph is a complete executable document, not a partial chatConfig patch.
    if (data.chatConfig && Object.hasOwn(data.chatConfig, 'graph')) {
      mergedValue.chatConfig = {
        ...mergedValue.chatConfig,
        graph: data.chatConfig.graph,
      } as AgentItem['chatConfig'];
    }

    // Apply the processed parameters
    mergedValue.params = Object.keys(updatedParams).length > 0 ? updatedParams : undefined;

    // agencyConfig.workingDirByDevice: a per-device entry is cleared by sending
    // `undefined`, which merge() skips — prune those keys so the delete persists.
    pruneWorkingDirByDeviceDeletes(mergedValue.agencyConfig, data.agencyConfig);

    await this.assertFixedExecutionTarget(agent.workspaceId, mergedValue.agencyConfig);

    // Final cleanup: ensure no undefined or null values enter the database
    if (mergedValue.params) {
      const params = mergedValue.params as Record<string, any>;
      Object.keys(params).forEach((key) => {
        if (params[key] === undefined) {
          delete params[key];
        }
      });
      if (Object.keys(params).length === 0) {
        mergedValue.params = undefined;
      }
    }

    // Remove timestamp fields to let Drizzle's $onUpdate handle them automatically

    const { updatedAt: _, accessedAt: __, createdAt: ___, ...updateData } = mergedValue;

    return this.db
      .update(agents)
      .set(updateData)
      .where(and(eq(agents.id, agentId), this.ownership()));
  };

  /**
   * Update the sessionGroupId for an agent
   */
  /**
   * A move target must be a folder the caller can actually see, and a *public*
   * agent may only sit in a *public* folder — otherwise the agent stays
   * visible to the workspace while its folder does not, and everyone else
   * silently finds it in Ungrouped. Private agents are only visible to their
   * owner, so any folder that owner can see is fine.
   */
  /**
   * Resolve a folder the caller may put an item in, returning its visibility.
   * Shared by the move guard and the create path — both need the same
   * "visible in scope" check, and create additionally derives the new agent's
   * visibility from the result.
   */
  getAssignableSessionGroupVisibility = async (
    sessionGroupId: string,
  ): Promise<'private' | 'public'> => {
    const [group] = await this.db
      .select({ visibility: sessionGroups.visibility })
      .from(sessionGroups)
      .where(
        and(
          eq(sessionGroups.id, sessionGroupId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              userId: sessionGroups.userId,
              visibility: sessionGroups.visibility,
              workspaceId: sessionGroups.workspaceId,
            },
          ),
        ),
      )
      .limit(1);

    if (!group) throw new Error(`Session group ${sessionGroupId} not found in current scope`);

    return group.visibility as 'private' | 'public';
  };

  private assertSessionGroupAssignable = async (agentId: string, sessionGroupId: string) => {
    const groupVisibility = await this.getAssignableSessionGroupVisibility(sessionGroupId);
    const group = { visibility: groupVisibility };

    if (!this.workspaceId) return;

    const [agent] = await this.db
      .select({ visibility: agents.visibility })
      .from(agents)
      .where(and(eq(agents.id, agentId), this.ownership()))
      .limit(1);

    // Buckets must match exactly, not merely "public agent needs a public
    // folder". `processAgentList` resolves a private item's folder only against
    // the private folder set and a public item's only against the public one,
    // so a mismatch in either direction renders as Ungrouped rather than in
    // the folder the user picked.
    if (agent && agent.visibility !== group.visibility)
      throw new Error(
        `A ${agent.visibility} agent cannot be moved into a ${group.visibility} folder`,
      );
  };

  updateSessionGroupId = async (agentId: string, sessionGroupId: string | null) => {
    // The column is workspace-shared, so an unvalidated target corrupts the
    // sidebar for everyone, not just the caller. The foreign key only proves
    // the folder exists: another workspace's folder, or another member's
    // private one, passes it happily and then renders as Ungrouped for every
    // member who cannot see it.
    if (sessionGroupId) await this.assertSessionGroupAssignable(agentId, sessionGroupId);

    const result = await this.db
      .update(agents)
      .set({ sessionGroupId, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), this.ownership()))
      .returning();

    return result[0];
  };

  /**
   * Duplicate an agent.
   * Returns the new agent ID.
   */
  duplicate = async (agentId: string, newTitle?: string): Promise<{ agentId: string } | null> => {
    // Get the source agent
    const sourceAgent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), this.ownership()),
    });

    if (!sourceAgent) return null;

    // The copy is owned by the caller, so device references must be resolvable
    // by the caller too. A public workspace agent may still carry a legacy
    // personal-device `boundDeviceId` / `workingDirByDevice` that `updateConfig`
    // grandfathers; duplicating it verbatim would point the new agent at a
    // device outside the workspace instead of defaulting to the caller's own
    // device. Sanitize exactly like `transferAgents` does when moving into a
    // workspace. Personal-scope copies keep existing bindings (any device is
    // reachable there).
    const agencyConfig = this.workspaceId
      ? (
          await this.sanitizeAgencyConfigForWorkspace(this.db, this.workspaceId, [
            sourceAgent.agencyConfig,
          ])
        )[0]
      : (sourceAgent.agencyConfig ?? null);

    // Create new agent with explicit include fields
    const [newAgent] = await this.db
      .insert(agents)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            // Agency config (heterogeneous provider, execution target, device
            // binding, sub-agent defaults, verify rubric...). Duplicating must
            // preserve it, otherwise a heterogeneous agent is copied as a plain
            // one and its external runtime config is silently lost.
            agencyConfig,
            avatar: sourceAgent.avatar,
            backgroundColor: sourceAgent.backgroundColor,
            chatConfig: sourceAgent.chatConfig,
            description: sourceAgent.description,
            fewShots: sourceAgent.fewShots,
            model: sourceAgent.model,
            openingMessage: sourceAgent.openingMessage,
            openingQuestions: sourceAgent.openingQuestions,
            params: sourceAgent.params,
            pinned: sourceAgent.pinned,
            // Config
            plugins: sourceAgent.plugins,
            provider: sourceAgent.provider,

            // Session group. Visibility has to travel with it: the column
            // defaults to `public`, and now that folder placement is shared and
            // authoritative, a private agent duplicated into its private folder
            // would be published to the workspace and still render in Ungrouped,
            // since a public item resolves only against public folders.
            sessionGroupId: sourceAgent.sessionGroupId,
            visibility: sourceAgent.visibility,
            systemRole: sourceAgent.systemRole,

            tags: sourceAgent.tags,
            // Metadata
            title: newTitle || (sourceAgent.title ? `${sourceAgent.title} (Copy)` : 'Copy'),
            tts: sourceAgent.tts,
          },
        ),
      )
      .returning();

    return { agentId: newAgent.id };
  };

  /**
   * Resolve a user-facing slug to its agent id, scoped by the caller's ownership
   * predicate. Returns `null` when no visible agent owns that slug — callers must
   * treat that as "not found" and must NOT distinguish it from "exists but not
   * yours", or the endpoint becomes an existence oracle for other users' agents.
   */
  resolveIdBySlug = async (slug: string): Promise<string | null> => {
    const trimmed = slug.trim();
    if (!trimmed) return null;

    const rows = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(this.ownership(), eq(agents.slug, trimmed)))
      .limit(1);

    return rows[0]?.id ?? null;
  };

  /**
   * Rename an agent's url slug.
   *
   * Deliberately its own method rather than a field on `updateConfig`: `slug`
   * stays in {@link IMMUTABLE_AGENT_FIELDS} so it can never ride along in a
   * passthrough config patch. Renaming needs validation the config path has no
   * place for — shape, reserved builtin slugs, and a uniqueness scope that
   * differs between personal and workspace rows.
   *
   * Returns a discriminated result instead of throwing so the caller can render
   * a field-level message; only a genuinely missing agent throws.
   */
  updateSlug = async (
    agentId: string,
    slug: string,
  ): Promise<{ reason?: 'builtin' | 'invalid' | 'reserved' | 'taken'; success: boolean }> => {
    const next = slug.trim().toLowerCase();

    if (!AGENT_SLUG_PATTERN.test(next)) return { reason: 'invalid', success: false };

    const current = await this.db.query.agents.findFirst({
      columns: { slug: true },
      where: and(eq(agents.id, agentId), this.ownership()),
    });
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
    if (current.slug === next) return { success: true };

    // A builtin agent IS its slug: `getBuiltinAgent` resolves it by that string,
    // so renaming one away would silently mint a second, empty inbox / page
    // agent and strand the original's history on an ordinary agent.
    if (current.slug && RESERVED_AGENT_SLUGS.has(current.slug))
      return { reason: 'builtin', success: false };
    if (RESERVED_AGENT_SLUGS.has(next)) return { reason: 'reserved', success: false };

    // Check within the same scope the unique indexes use, so the pre-check and
    // the constraint agree. The insert can still lose a race, hence the catch.
    const clash = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(this.ownership(), eq(agents.slug, next)))
      .limit(1);
    if (clash.length > 0) return { reason: 'taken', success: false };

    try {
      await this.db
        .update(agents)
        .set({ slug: next, updatedAt: new Date() })
        .where(and(eq(agents.id, agentId), this.ownership()));
    } catch {
      // Unique violation from a concurrent rename — same user-facing outcome.
      return { reason: 'taken', success: false };
    }

    return { success: true };
  };

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * Builtin agents are standalone agents not bound to sessions.
   *
   */
  getBuiltinAgent = async (slug: string): Promise<AgentItem | null> => {
    const persistConfig = getAgentPersistConfig(slug);

    // 1. First try to find existing agent by slug
    const existing = await this.db.query.agents.findFirst({
      where: and(eq(agents.slug, slug), this.ownership()),
    });

    if (existing) {
      if (persistConfig?.chatConfig) {
        const [updated] = await this.db
          .update(agents)
          .set({ chatConfig: persistConfig.chatConfig })
          .where(eq(agents.id, existing.id))
          .returning();
        return normalizeInboxAgentMeta(updated ?? existing, { slug: existing.slug });
      }
      return normalizeInboxAgentMeta(existing, { slug: existing.slug });
    }

    // For inbox agent, it has special compatibility handling:
    // Historical inbox was stored as session with slug='inbox' and linked agent via agentsToSessions
    // If found, update the agent's slug to 'inbox' for future direct queries
    if (slug === INBOX_SESSION_ID) {
      // Use join query for better performance instead of multiple findFirst calls
      const result = await this.db
        .select({ agent: agents })
        .from(sessions)
        .innerJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
        .innerJoin(agents, eq(agentsToSessions.agentId, agents.id))
        .where(and(eq(sessions.slug, INBOX_SESSION_ID), this.sessionsOwnership()))
        .limit(1);

      if (result.length > 0 && result[0].agent) {
        // Update the agent's slug to 'inbox' for future direct queries
        // Use both id and userId to ensure we only update current user's agent
        const [updatedAgent] = await this.db
          .update(agents)
          .set({ slug: INBOX_SESSION_ID, virtual: true })
          .where(eq(agents.id, result[0].agent.id))
          .returning();

        return normalizeInboxAgentMeta(updatedAgent, { slug: updatedAgent.slug });
      }
    }

    // 3. Check if this is a known builtin agent
    if (!persistConfig) return null;

    // 4. Create the builtin agent with persist config.
    // Idempotent under concurrent callers: two parallel requests for the same
    // (userId, slug) both see no existing row and race to insert. Without
    // `onConflictDoNothing`, the loser hits the `agents_slug_user_id_unique`
    // constraint; with it, the loser's `.returning()` is empty and we re-read
    // the row that won.
    // Bare `onConflictDoNothing()` (no target) does NOT pin an arbiter index,
    // so it works whether `agents_slug_user_id_unique` is the legacy full
    // unique or the migration-0109 partial (WHERE workspace_id IS NULL) — this
    // is the transition-safe form while 0109 rolls out. Tighten back to a
    // partitioned { target, where } once 0109 has flipped the index in every
    // environment. Payload still carries workspaceId so workspace-scoped
    // builtin agents land in the right workspace.
    const result = await this.db
      .insert(agents)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            agencyConfig: this.withWorkspaceSelectionPolicyDefaults(undefined),
            chatConfig: persistConfig.chatConfig,
            model: persistConfig.model,
            provider: persistConfig.provider,
            slug: persistConfig.slug,
            virtual: true,
          },
        ),
      )
      .onConflictDoNothing()
      .returning();

    if (result[0]) return normalizeInboxAgentMeta(result[0], { slug: result[0].slug });

    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.slug, slug), this.ownership()),
    });

    return agent ? normalizeInboxAgentMeta(agent, { slug: agent.slug }) : null;
  };

  /**
   * Transfer an agent and all its associated data to a different workspace or personal account.
   * Runs in a single transaction to ensure atomicity.
   *
   * When moving into a workspace, `targetVisibility` picks the resulting scope
   * within that workspace (`private` = only the target user sees it,
   * `public` = every member does). Ignored when moving to a personal account.
   */
  /**
   * Whether the agent's transfer cascade (topics / messages / threads / tasks
   * linked to it) contains rows created by someone else. Transfers rehome every
   * cascaded row, so non-owner members must not move an agent that carries
   * teammates' conversations.
   */
  transferHasForeignRows = async (agentId: string | string[]): Promise<boolean> => {
    const agentIds = Array.isArray(agentId) ? agentId : [agentId];
    if (agentIds.length === 0) return false;

    const links = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(inArray(agentsToSessions.agentId, agentIds));
    const sessionIds = [...new Set(links.map((link) => link.sessionId))];

    // A member who merely opened the shared agent already owns a linked
    // session, even with no topics/messages yet — the transfer would rewrite
    // that session row too.
    if (sessionIds.length > 0) {
      const [foreignSession] = await this.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(inArray(sessions.id, sessionIds), ne(sessions.userId, this.userId)))
        .limit(1);
      if (foreignSession) return true;
    }

    const topicWhere =
      sessionIds.length > 0
        ? or(inArray(topics.sessionId, sessionIds), inArray(topics.agentId, agentIds))
        : inArray(topics.agentId, agentIds);
    const [foreignTopic] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .where(and(topicWhere, ne(topics.userId, this.userId)))
      .limit(1);
    if (foreignTopic) return true;

    // Comments move (or die, when the target is personal scope) with their
    // topics — a teammate's comment on the caller's own topic is still their
    // work. NULL authors (deleted accounts) count as foreign too.
    if (await hasForeignTopicComments(this.db, this.userId, topicWhere!)) return true;

    const messageWhere =
      sessionIds.length > 0
        ? or(inArray(messages.sessionId, sessionIds), inArray(messages.agentId, agentIds))
        : inArray(messages.agentId, agentIds);
    const [foreignMessage] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(messageWhere, ne(messages.userId, this.userId)))
      .limit(1);
    if (foreignMessage) return true;

    const [foreignThread] = await this.db
      .select({ id: threads.id })
      .from(threads)
      .where(and(inArray(threads.agentId, agentIds), ne(threads.userId, this.userId)))
      .limit(1);
    if (foreignThread) return true;

    const [foreignTask] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          or(inArray(tasks.assigneeAgentId, agentIds), inArray(tasks.createdByAgentId, agentIds)),
          ne(tasks.createdByUserId, this.userId),
        ),
      )
      .limit(1);
    return !!foreignTask;
  };

  /**
   * Chat-group memberships of the given agents, split by who owns the
   * membership.
   *
   * Read from the RAW junction rows: whether an agent may move is a fact about
   * the data, not about what the caller happens to see, and a group hidden
   * from them would otherwise silently drop out of the guard. Only the TITLE is
   * gated on visibility — a private group's name is its members' business —
   * which is why `groupTitle` is nullable.
   */
  private queryGroupMemberships = async (
    executor: Transaction | LobeChatDatabase,
    agentIds: string[],
  ): Promise<{ blocked: AgentGroupMembershipRef[]; leaving: AgentGroupMembershipRef[] }> => {
    if (agentIds.length === 0) return { blocked: [], leaving: [] };

    const rows = await executor
      .select({
        agentId: chatGroupsAgents.agentId,
        avatar: chatGroups.avatar,
        backgroundColor: chatGroups.backgroundColor,
        groupId: chatGroups.id,
        role: chatGroupsAgents.role,
        slug: agents.slug,
        title: chatGroups.title,
        virtual: agents.virtual,
        visible: sql<boolean>`(${buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            userId: chatGroups.userId,
            visibility: chatGroups.visibility,
            workspaceId: chatGroups.workspaceId,
          },
        )})`,
      })
      .from(chatGroupsAgents)
      .innerJoin(chatGroups, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(inArray(chatGroupsAgents.agentId, agentIds));

    const blocked: AgentGroupMembershipRef[] = [];
    const leaving: AgentGroupMembershipRef[] = [];

    for (const row of rows) {
      // Identity is withheld as a unit: a hidden group leaks neither its name
      // nor its avatar. The membership itself still counts toward the guard.
      const ref: AgentGroupMembershipRef = {
        agentId: row.agentId,
        groupAvatar: row.visible ? row.avatar : null,
        groupBackgroundColor: row.visible ? row.backgroundColor : null,
        // Withheld as a unit — id included. This is the one place these refs
        // are built, so the transfer error's `groups` payload is covered too.
        groupId: row.visible ? row.groupId : null,
        groupTitle: row.visible ? row.title : null,
        groupVisible: !!row.visible,
      };

      if (resolveGroupMembershipType(row) === 'owned') blocked.push(ref);
      else leaving.push(ref);
    }

    return { blocked, leaving };
  };

  private findOwnedGroupMemberships = async (
    executor: Transaction | LobeChatDatabase,
    agentIds: string[],
  ): Promise<AgentGroupMembershipRef[]> =>
    (await this.queryGroupMemberships(executor, agentIds)).blocked;

  /**
   * What moving these agents would do to the chat groups they are in, asked
   * BEFORE the move so the UI can block or confirm.
   *
   * `blocked` refuses the transfer outright (see the guard in
   * {@link transferAgents}); `leaving` is the silent side effect the user is
   * entitled to see first — a transfer drops every group link the agent holds,
   * and until now did so without a word.
   *
   * Reports only on agents the caller can already see, so the endpoint cannot
   * be used to probe which groups an arbitrary agent id sits in. The scoping
   * lives HERE rather than in the router because {@link queryGroupMemberships}
   * is deliberately unscoped — the transfer guard has to see a membership even
   * in a group hidden from the caller — and that difference is too easy to
   * lose track of one call site away.
   */
  getGroupMembershipImpact = async (
    agentIds: string[],
  ): Promise<{ blocked: AgentGroupMembershipRef[]; leaving: AgentGroupMembershipRef[] }> => {
    const uniqueIds = [...new Set(agentIds)];
    if (uniqueIds.length === 0) return { blocked: [], leaving: [] };

    // One query for the whole batch: the endpoint accepts up to 100 ids, and a
    // visibility probe per id is 100 round trips for a modal that opens on a
    // click.
    const visibleRows = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(inArray(agents.id, uniqueIds), this.ownership()));

    return this.queryGroupMemberships(
      this.db,
      visibleRows.map((row) => row.id),
    );
  };

  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
    options: { rejectForeignTopicCommentAuthors?: boolean } = {},
  ): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }> => {
    const [result] = await this.transferAgents(
      [agentId],
      targetWorkspaceId,
      targetUserId,
      targetVisibility,
      options,
    );
    return result;
  };

  /**
   * Batch variant of {@link transferAgent}: moves several agents (and their
   * cascaded topics / messages / threads / tasks / …) in ONE transaction, with
   * every large-table UPDATE issued once via `inArray` instead of once per
   * agent. All-or-nothing: a failure on any agent rolls back the whole batch.
   */
  transferAgents = async (
    agentIds: string[],
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
    options: { rejectForeignTopicCommentAuthors?: boolean } = {},
  ): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }[]> => {
    if (agentIds.length === 0) return [];

    return this.db.transaction(async (trx) => {
      // 1. Verify all agents exist and belong to current scope. FOR UPDATE so
      // two concurrent transfers of the same agent serialize HERE, before the
      // pending-job guard below: the loser re-reads after the winner commits
      // and either no longer finds the agent in its scope, or sees the
      // winner's freshly inserted job. Without the lock both would pass the
      // guard first (check-then-act) and enqueue duplicate jobs.
      const foundAgents = await trx
        .select()
        .from(agents)
        .where(and(inArray(agents.id, agentIds), this.ownership()))
        .for('update');
      if (foundAgents.length !== new Set(agentIds).size) throw new Error('Agent not found');
      const agentById = new Map(foundAgents.map((agent) => [agent.id, agent]));

      // 1a. An unfinished backfill still owns these agents' message rewrite —
      // a second transfer would race it (and re-enqueue topics the first job
      // is still draining). Runs under the row locks above, so the check is
      // race-free against a concurrent transfer's own job insert.
      if (await AgentTransferJobModel.hasPendingJobForAgents(trx, agentIds)) {
        throw new Error(AGENT_TRANSFER_IN_PROGRESS);
      }

      // 1b. A pending copy job reads from these agents' topics by id — moving
      // them to another scope would make it drain empty topics. Copy jobs
      // register only their TARGET agents in the junction, so the source side
      // needs its own payload-based guard.
      if (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, agentIds)) {
        throw new Error(AGENT_COPY_IN_PROGRESS);
      }

      // 1c. A group-owned agent has no existence apart from its group: the
      // synthetic supervisor, and members built through the group builder.
      // Step 14 below drops every chat-group link the moved agents hold, which
      // for an owned member means the group silently loses it — and for a
      // supervisor means the group is left headless, at which point
      // `findByIdWithAgents` quietly mints a blank replacement and the
      // configured systemRole/model are gone for good.
      //
      // Refuse instead, naming the groups so the caller can act. Nothing in the
      // product can reach this: owned implies `virtual`, and `queryAgents`
      // filters virtual agents out of every transfer surface. It is a guard
      // against a caller that reaches the model directly.
      const ownedGroups = await this.findOwnedGroupMemberships(trx, agentIds);
      if (ownedGroups.length > 0) throw new AgentOwnedByGroupError(ownedGroups);

      // 2. Resolve slug conflicts in the target scope with a single query:
      //    fetch every existing slug that could collide (exact match or
      //    `<slug>-<n>` suffix), then pick free suffixes in memory. Agents
      //    inside the batch also compete with each other for the same slug.
      const targetScopeWhere = targetWorkspaceId
        ? eq(agents.workspaceId, targetWorkspaceId)
        : and(eq(agents.userId, targetUserId), isNull(agents.workspaceId));
      const sluggedAgents = foundAgents.filter((agent) => agent.slug);
      const resolvedSlugs = new Map<string, string | null>();
      if (sluggedAgents.length > 0) {
        const conflictRows = await trx
          .select({ slug: agents.slug })
          .from(agents)
          .where(
            and(
              targetScopeWhere,
              notInArray(agents.id, agentIds),
              or(
                ...sluggedAgents.map((agent) =>
                  or(eq(agents.slug, agent.slug!), like(agents.slug, `${agent.slug}-%`)),
                ),
              ),
            ),
          );
        const taken = new Set(conflictRows.map((row) => row.slug));
        for (const agent of sluggedAgents) {
          let slug = agent.slug!;
          if (taken.has(slug)) {
            let suffix = 1;
            while (suffix < 100) {
              const candidate = `${slug}-${suffix}`;
              if (!taken.has(candidate)) {
                slug = candidate;
                break;
              }
              suffix++;
            }
          }
          taken.add(slug);
          resolvedSlugs.set(agent.id, slug);
        }
      }

      // 3. Build ownership update payload
      const ownershipUpdate = {
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      };

      // 3a. Strip stale device bindings when moving INTO a workspace: any
      // boundDeviceId / workingDirByDevice entry that isn't enrolled in the
      // target workspace is silently dropped. Otherwise the moved agent would
      // reference a device only the previous owner can reach. Moving to a
      // personal scope (`targetWorkspaceId === null`) keeps existing bindings.
      // Device rows for the whole batch are fetched with one query.
      const resolvedAgencyConfigs = new Map<string, LobeAgentAgencyConfig | null>();
      if (targetWorkspaceId) {
        const cleanedConfigs = await this.sanitizeAgencyConfigForWorkspace(
          trx,
          targetWorkspaceId,
          foundAgents.map((agent) => agent.agencyConfig),
        );
        foundAgents.forEach((agent, index) =>
          resolvedAgencyConfigs.set(agent.id, cleanedConfigs[index]),
        );
      }

      // 4. Update the agent records. slug / agencyConfig differ per agent, so
      //    these are per-row PK updates (cheap); the large cascaded tables
      //    below are still one bulk UPDATE each.
      //    Only apply visibility when moving into a workspace — visibility is
      //    a no-op in personal scope where every row is implicitly private.
      //    `sessionGroupId` is cleared because sidebar folders belong to the
      //    source scope (same rationale as dropping chatGroupsAgents below);
      //    a stale reference would orphan the agent out of the target sidebar.
      const visibilityUpdate =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};
      for (const agent of foundAgents) {
        await trx
          .update(agents)
          .set({
            ...ownershipUpdate,
            ...visibilityUpdate,
            agencyConfig: targetWorkspaceId
              ? (resolvedAgencyConfigs.get(agent.id) ?? null)
              : (agent.agencyConfig ?? null),
            // Pins are shared state now, exactly like the folder above: a pin
            // the previous owner set for themselves would arrive as a pin for
            // every member of the target workspace. Both belong to the source
            // scope and are dropped with it.
            pinned: false,
            sessionGroupId: null,
            slug: resolvedSlugs.get(agent.id) ?? agent.slug,
            // A scope transfer does not make the agent's content newer. Keep the
            // original recency so home/search ordering is not reshuffled.
            updatedAt: agents.updatedAt,
          })
          .where(eq(agents.id, agent.id));
      }

      // 5. Update sessions linked via agentsToSessions
      const links = await trx
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(inArray(agentsToSessions.agentId, agentIds));

      const sessionIds = [...new Set(links.map((l) => l.sessionId))];

      if (sessionIds.length > 0) {
        // `groupId` is cleared for the same reason as the agent's
        // `sessionGroupId`: folders stay in the source scope.
        await trx
          .update(sessions)
          .set({ ...ownershipUpdate, groupId: null, updatedAt: sessions.updatedAt })
          .where(inArray(sessions.id, sessionIds));
      }

      await trx
        .update(agentsToSessions)
        .set(ownershipUpdate)
        .where(inArray(agentsToSessions.agentId, agentIds));

      // 5b. Drop label assignments. Unlike sessions, these cannot travel: a
      // label belongs to the source registry, and the target scope has its own
      // (or none). Re-homing them would need a name-matched label in the
      // target, which is a merge decision, not a transfer one. Leaving them
      // instead would keep inflating the source label's usage count and make
      // the labels reappear if the agent ever moves back — same reasoning as
      // the device bindings stripped above.
      await trx
        .delete(agentLabelAssignments)
        .where(inArray(agentLabelAssignments.agentId, agentIds));

      // 6. Update topics (linked via sessionId or agentId)
      const topicCondition =
        sessionIds.length > 0
          ? or(inArray(topics.sessionId, sessionIds), inArray(topics.agentId, agentIds))
          : inArray(topics.agentId, agentIds);

      // Create locks the topic before inserting a comment. Lock every topic in
      // the same order before the authoritative transfer authorization check,
      // so either the create becomes visible here or it observes the moved
      // scope and fails after this transaction commits.
      await trx
        .select({ id: topics.id })
        .from(topics)
        .where(topicCondition!)
        .orderBy(asc(topics.id))
        .for('update');

      if (
        options.rejectForeignTopicCommentAuthors &&
        (await hasForeignTopicComments(trx, this.userId, topicCondition!))
      ) {
        throw new Error(TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS);
      }
      const movedTopics = await trx
        .update(topics)
        .set({ ...ownershipUpdate, updatedAt: topics.updatedAt })
        .where(topicCondition!)
        .returning({ id: topics.id, updatedAt: topics.updatedAt });

      // 6a. Topic comments denormalize the topic's workspaceId — move them
      // with the topic (or drop them when leaving workspace scope entirely),
      // otherwise workspace-filtered comment reads go stale. See the helper doc.
      await syncTopicCommentsOnTopicTransfer(
        trx,
        movedTopics.map((topic) => topic.id),
        targetWorkspaceId,
      );

      // 7. Message scope rewrite — fast/slow split. Rewriting a message row
      // maintains every message index (incl. the multi-GB BM25 index), so a
      // heavy agent's history cannot be rewritten inside this transaction:
      // above the threshold the rewrite is recorded as an async backfill job
      // (drained topic-by-topic; see AgentTransferJobModel) and the rows keep
      // their source-scope snapshot until the job reaches them.
      //
      // Both paths anchor on the moved topics (plus a topicless residual by
      // session/agent linkage) rather than the legacy session/agent-only
      // condition, so topic-only rows (OpenAPI create shape) and the message
      // child tables move too instead of stranding in the source scope.
      const messageCondition =
        sessionIds.length > 0
          ? or(inArray(messages.sessionId, sessionIds), inArray(messages.agentId, agentIds))
          : inArray(messages.agentId, agentIds);
      const movedTopicIds = movedTopics.map((topic) => topic.id);
      const [{ affectedMessages }] = await trx
        .select({ affectedMessages: count() })
        .from(messages)
        .where(
          movedTopicIds.length > 0
            ? or(inArray(messages.topicId, movedTopicIds), messageCondition!)
            : messageCondition!,
        );

      const targetScope = { userId: targetUserId, workspaceId: targetWorkspaceId };
      let transferJobId: string | null = null;
      if (affectedMessages <= getAgentTransferSyncMessageThreshold()) {
        await rewriteMessageScopeForTopics(trx, movedTopicIds, targetScope);
        await rewriteResidualMessageScope(trx, { agentIds, sessionIds }, targetScope);
      } else {
        transferJobId = await AgentTransferJobModel.createJob(trx, {
          agentIds,
          sessionIds,
          source: { userId: this.userId, workspaceId: this.workspaceId ?? null },
          target: targetScope,
          topics: movedTopics.map((topic) => ({ activityAt: topic.updatedAt, id: topic.id })),
        });
      }

      // 8. Update threads (linked via agentId)
      await trx
        .update(threads)
        .set({ ...ownershipUpdate, updatedAt: threads.updatedAt })
        .where(inArray(threads.agentId, agentIds));

      // 9. Update agent files associations
      await trx
        .update(agentsFiles)
        .set({ ...ownershipUpdate, updatedAt: agentsFiles.updatedAt })
        .where(inArray(agentsFiles.agentId, agentIds));

      // 10. Update agent knowledge base associations
      await trx
        .update(agentsKnowledgeBases)
        .set({ ...ownershipUpdate, updatedAt: agentsKnowledgeBases.updatedAt })
        .where(inArray(agentsKnowledgeBases.agentId, agentIds));

      // 11. Update agent cron jobs
      await trx
        .update(agentCronJobs)
        .set({ ...ownershipUpdate, updatedAt: agentCronJobs.updatedAt })
        .where(inArray(agentCronJobs.agentId, agentIds));

      // 12. Update tasks assigned to or created by these agents. The scheduled
      // task dispatcher uses `createdByUserId` as the execution owner, so tasks
      // must move with the agent instead of staying under the old owner.
      // Visibility is cascaded to tasks and child rows so a `private` transfer
      // does not leak previously-personal task data to every workspace member:
      // personal rows keep the schema default (`visibility='public'`) but ignore
      // it, whereas workspace rows honor it — without this cascade a `private`
      // transfer would silently downgrade to workspace-public.
      const movedTasks = await trx
        .update(tasks)
        .set({
          createdByUserId: targetUserId,
          updatedAt: tasks.updatedAt,
          workspaceId: targetWorkspaceId,
          ...visibilityUpdate,
        })
        .where(
          or(inArray(tasks.assigneeAgentId, agentIds), inArray(tasks.createdByAgentId, agentIds)),
        )
        .returning({ id: tasks.id });
      const movedTaskIds = movedTasks.map((task) => task.id);

      if (movedTaskIds.length > 0) {
        await trx
          .update(taskDependencies)
          .set({ ...ownershipUpdate, ...visibilityUpdate })
          .where(inArray(taskDependencies.taskId, movedTaskIds));
        await trx
          .update(taskDocuments)
          .set({ ...ownershipUpdate, ...visibilityUpdate })
          .where(inArray(taskDocuments.taskId, movedTaskIds));
        await trx
          .update(taskTopics)
          .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: taskTopics.updatedAt })
          .where(inArray(taskTopics.taskId, movedTaskIds));
        await trx
          .update(taskComments)
          .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: taskComments.updatedAt })
          .where(inArray(taskComments.taskId, movedTaskIds));
        await trx.update(briefs).set(ownershipUpdate).where(inArray(briefs.taskId, movedTaskIds));
      }

      await trx.update(briefs).set(ownershipUpdate).where(inArray(briefs.agentId, agentIds));

      // 13. Update agent bot providers (transfer, not delete)
      await trx
        .update(agentBotProviders)
        .set({ ...ownershipUpdate, updatedAt: agentBotProviders.updatedAt })
        .where(inArray(agentBotProviders.agentId, agentIds));

      // 14. Leave every chat group: a group belongs to the source scope, and a
      // roster row pointing at an agent that now lives elsewhere would render
      // as a member nobody in either scope can use. Guard 1c above has already
      // rejected the memberships where leaving would damage the GROUP, so
      // everything reaching here is a `referenced` link the caller confirmed.
      await trx.delete(chatGroupsAgents).where(inArray(chatGroupsAgents.agentId, agentIds));

      return agentIds.map((id) => ({
        agentId: id,
        slug: resolvedSlugs.get(id) ?? agentById.get(id)?.slug ?? null,
        transferJobId,
      }));
    });
  };
}
