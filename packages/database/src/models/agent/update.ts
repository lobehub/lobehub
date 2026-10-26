import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID, isHeterogeneousAgentModelId } from '@lobechat/const';
import { applyWorkingDirByDevicePatch } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { stripLegacyEffortKeys } from 'model-bank/aiModel';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';

import type { AgentItem } from '../../schemas';
import { agents, sessionGroups } from '../../schemas';
import { sanitizeAgentApiConfig } from '../../utils/sanitizeAgentApiConfig';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { RESERVED_AGENT_SLUGS } from './constants';
import { type AgentModelContext } from './context';

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
 *
 * Such a write is rejected, not silently trimmed: the writer is almost always aiming at a
 * different agent (the one the builder is editing), and a trimmed write still reports
 * success — the caller would believe the prompt/name landed when nothing changed.
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

const assertNoAgentBuilderProtectedFields = (data: Record<string, unknown>) => {
  const fields = AGENT_BUILDER_PROTECTED_FIELDS.filter((field) => data[field] !== undefined);
  if (fields.length === 0) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message:
      `The Agent Builder's own ${fields.join(', ')} cannot be changed, so nothing was updated. ` +
      'Target the agent being edited instead.',
  });
};

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
export const stripImmutableFields = <T extends Record<string, any>>(data: T): T => {
  const carried = IMMUTABLE_AGENT_FIELDS.filter((field) => field in data);
  if (carried.length === 0) return data;

  const next = { ...data };
  for (const field of carried) delete next[field];
  return next;
};

export const update = async (ctx: AgentModelContext, agentId: string, data: Partial<AgentItem>) => {
  const apiSafeData = Object.hasOwn(data, 'agencyConfig')
    ? { ...data, agencyConfig: sanitizeAgentApiConfig(data.agencyConfig) }
    : data;
  const sanitizedData = stripImmutableFields(apiSafeData);
  await assertNotAgentBuilderProtectedWrite(ctx, agentId, sanitizedData);

  return ctx.db
    .update(agents)
    .set({ ...sanitizedData, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), ctx.ownership()));
};

/**
 * Reject a write of fields the Agent Builder's own row must never carry (see
 * {@link AGENT_BUILDER_PROTECTED_FIELDS}). Only looks up the target row's `slug` when the
 * incoming patch actually touches a protected field, so normal updates pay no extra query.
 */
export const assertNotAgentBuilderProtectedWrite = async (
  ctx: AgentModelContext,
  agentId: string,
  data: Record<string, unknown>,
) => {
  if (!AGENT_BUILDER_PROTECTED_FIELDS.some((field) => data[field] !== undefined)) return;

  const agent = await ctx.db.query.agents.findFirst({
    columns: { slug: true },
    where: and(eq(agents.id, agentId), ctx.ownership()),
  });

  if (agent?.slug === BUILTIN_AGENT_SLUGS.agentBuilder) assertNoAgentBuilderProtectedFields(data);
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
export const setVisibility = async (
  ctx: AgentModelContext,
  agentId: string,
  visibility: 'private' | 'public',
) => {
  // A sidebar folder cannot mix visibilities (HomeRepository.processAgentList
  // buckets grouped items by item visibility under same-visibility groups),
  // so an agent crossing scopes while keyed to a group of the OLD scope
  // would be emitted nowhere and vanish from the sidebar. Rehome it to the
  // ungrouped section of its new scope when the group no longer matches.
  const [current] = await ctx.db
    .select({
      agencyConfig: agents.agencyConfig,
      groupVisibility: sessionGroups.visibility,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .leftJoin(sessionGroups, eq(agents.sessionGroupId, sessionGroups.id))
    .where(and(eq(agents.id, agentId), ctx.ownership()))
    .limit(1);

  // `publishAgentToWorkspace` is the normal client path, but keep the
  // bidirectional visibility mutation equally safe for direct API callers.
  if (visibility === 'public' && current) {
    await ctx.assertFixedExecutionTarget(current.workspaceId, current.agencyConfig);
  }

  const groupVisibility = current?.groupVisibility as 'private' | 'public' | null | undefined;
  const clearGroup = groupVisibility != null && groupVisibility !== visibility;

  const [updated] = await ctx.db
    .update(agents)
    .set({
      updatedAt: new Date(),
      visibility,
      ...(clearGroup ? { sessionGroupId: null } : {}),
    })
    .where(and(eq(agents.id, agentId), ctx.ownership()))
    .returning();
  return updated ?? null;
};

export const updateConfig = async (
  ctx: AgentModelContext,
  agentId: string,
  input: PartialDeep<AgentItem> | undefined | null,
  replaceWorkingDirDeviceIds?: string[],
) => {
  if (!input || Object.keys(input).length === 0) return;

  const data = stripImmutableFields(input);

  const agent = await ctx.db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), ctx.ownership()),
  });

  if (!agent) return;

  await ctx.assertWorkspaceDeviceBinding(agent.workspaceId, data.agencyConfig, agent.agencyConfig);

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
    assertNoAgentBuilderProtectedFields(restData as Record<string, unknown>);
  }

  // Only the columns this patch touches are written back. The row was read
  // before the awaits above, so writing the whole merged row would restore
  // any column another writer committed in between — e.g. a parallel
  // `updatePrompt` losing its new systemRole to a concurrent config write.
  const touchedColumns = new Set<string>(Object.keys(restData));
  if (data.params) touchedColumns.add('params');

  const mergedValue = merge(agent, restData);

  // API bindings follow updateConfig's partial deep-merge contract. A user-provider patch must
  // only clear the deployment discriminator retained from a previous server-default binding.
  const apiConfigPatch = toRecord(data.agencyConfig?.heterogeneousProvider?.apiConfig);
  const mergedApiConfig = toRecord(mergedValue.agencyConfig?.heterogeneousProvider?.apiConfig);
  if (
    apiConfigPatch &&
    apiConfigPatch.source !== 'server-default' &&
    typeof apiConfigPatch.providerId === 'string' &&
    mergedApiConfig
  ) {
    delete mergedApiConfig.source;
  }

  // A new sub-agent effort pick replaces the legacy per-model effort keys
  // (LOBE-14979) instead of merging next to them.
  const subAgentChatConfig = toRecord(mergedValue.agencyConfig?.subagent?.chatConfig);
  if (subAgentChatConfig && data.agencyConfig?.subagent?.chatConfig?.reasoningEffort) {
    mergedValue.agencyConfig!.subagent!.chatConfig = stripLegacyEffortKeys(subAgentChatConfig);
  }

  mergedValue.agencyConfig = sanitizeAgentApiConfig(mergedValue.agencyConfig) ?? null;

  // The inbox is LobeHub's built-in default cloud agent; it must never be
  // turned into a heterogeneous (external-CLI) agent. Two independent inputs can
  // flip it — a stray `agencyConfig.heterogeneousProvider`, and a legacy hetero
  // `model` id, which AiAgentService still treats as heterogeneous on its own even
  // without a provider config. Either one
  // reroutes the whole chat surface through the device gateway and breaks it with
  // GATEWAY_NOT_CONFIGURED, so sanitize both at this write chokepoint regardless
  // of caller (mirrors AGENT_BUILDER_PROTECTED_FIELDS).
  if (agent.slug === INBOX_SESSION_ID) {
    if (mergedValue.agencyConfig?.heterogeneousProvider) {
      delete mergedValue.agencyConfig.heterogeneousProvider;
      touchedColumns.add('agencyConfig');
    }
    if (isHeterogeneousAgentModelId(mergedValue.model)) {
      mergedValue.model = null;
      touchedColumns.add('model');
    }
  }

  // A character sheet is authored as a whole: the studio reads the current
  // profile and writes the version it wants. Deep-merging it would make a
  // cleared trait or a removed artwork impossible to express, since a missing
  // key reads as "leave it alone". Same reasoning as the graph below.
  if (Object.hasOwn(data, 'profile')) {
    mergedValue.profile = data.profile as AgentItem['profile'];
  }

  // A AgentGraph is a complete executable document, not a partial config
  // patch — replace it wholesale instead of deep-merging. The Graph Agent
  // (agencyConfig.graph) is the agent's behavior body; legacy clients may
  // still send `chatConfig.graph`, so write it through to `agencyConfig.graph`
  // (and forward the switch) to migrate the row on the next write.
  if (data.agencyConfig && Object.hasOwn(data.agencyConfig, 'graph')) {
    mergedValue.agencyConfig = {
      ...mergedValue.agencyConfig,
      graph: data.agencyConfig.graph,
    } as AgentItem['agencyConfig'];
    // An explicit agency-level graph — including `null` to clear it — takes
    // ownership of the graph: drop the legacy chatConfig fields so the
    // runtime's `??` fallback cannot resurrect an old snapshot.
    if (mergedValue.chatConfig) {
      touchedColumns.add('chatConfig');
      const {
        graph: _legacyGraph,
        enableGraphMode: _legacyEnableGraphMode,
        ...restChatConfig
      } = mergedValue.chatConfig as Record<string, unknown>;
      mergedValue.chatConfig = restChatConfig as AgentItem['chatConfig'];
    }
  } else if (data.chatConfig && Object.hasOwn(data.chatConfig, 'graph')) {
    touchedColumns.add('agencyConfig');
    const legacyChatConfig = data.chatConfig as Record<string, unknown>;
    mergedValue.agencyConfig = {
      ...mergedValue.agencyConfig,
      graph: legacyChatConfig.graph,
      ...(Object.hasOwn(legacyChatConfig, 'enableGraphMode') && {
        enableGraphMode: legacyChatConfig.enableGraphMode,
      }),
    } as AgentItem['agencyConfig'];
    /* v8 ignore next -- unreachable: this branch requires an object `data.chatConfig`, which `merge` copies into `mergedValue.chatConfig`, so the `?? {}` fallback never runs */
    const {
      graph: _legacyGraph,
      enableGraphMode: _legacyEnableGraphMode,
      ...restChatConfig
    } = (mergedValue.chatConfig ?? {}) as Record<string, unknown>;
    mergedValue.chatConfig = restChatConfig as AgentItem['chatConfig'];
  }

  // Apply the processed parameters
  mergedValue.params = Object.keys(updatedParams).length > 0 ? updatedParams : undefined;

  // Opt-in replacement prevents old clients' complete cached maps from
  // deleting Git metadata on devices they did not actually edit.
  applyWorkingDirByDevicePatch(
    mergedValue.agencyConfig,
    data.agencyConfig,
    replaceWorkingDirDeviceIds,
  );

  await ctx.assertFixedExecutionTarget(agent.workspaceId, mergedValue.agencyConfig);

  // Final cleanup: ensure no undefined or null values enter the database
  if (mergedValue.params) {
    const params = mergedValue.params as Record<string, any>;
    Object.keys(params).forEach((key) => {
      /* v8 ignore next -- unreachable: `updatedParams` drops incoming `undefined` keys and stored JSON cannot hold `undefined` */
      if (params[key] === undefined) {
        delete params[key];
      }
    });
    /* v8 ignore next -- unreachable: `mergedValue.params` is only set when `updatedParams` has a key, and the loop above never deletes one */
    if (Object.keys(params).length === 0) {
      mergedValue.params = undefined;
    }
  }

  // Timestamp fields are left to Drizzle's $onUpdate.
  touchedColumns.delete('updatedAt');
  touchedColumns.delete('accessedAt');
  touchedColumns.delete('createdAt');

  const updateData = Object.fromEntries(
    Object.entries(mergedValue).filter(([column]) => touchedColumns.has(column)),
  ) as Partial<typeof mergedValue>;
  if (!Object.values(updateData).some((value) => value !== undefined)) return;

  return ctx.db
    .update(agents)
    .set(updateData)
    .where(and(eq(agents.id, agentId), ctx.ownership()));
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
export const getAssignableSessionGroupVisibility = async (
  ctx: AgentModelContext,
  sessionGroupId: string,
): Promise<'private' | 'public'> => {
  const [group] = await ctx.db
    .select({ visibility: sessionGroups.visibility })
    .from(sessionGroups)
    .where(
      and(
        eq(sessionGroups.id, sessionGroupId),
        buildWorkspaceWhere(
          { userId: ctx.userId, workspaceId: ctx.workspaceId },
          {
            isDeleted: sessionGroups.isDeleted,
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
export const updateSlug = async (
  ctx: AgentModelContext,
  agentId: string,
  slug: string,
): Promise<{ reason?: 'builtin' | 'invalid' | 'reserved' | 'taken'; success: boolean }> => {
  const next = slug.trim().toLowerCase();

  if (!AGENT_SLUG_PATTERN.test(next)) return { reason: 'invalid', success: false };

  const current = await ctx.db.query.agents.findFirst({
    columns: { slug: true },
    where: and(eq(agents.id, agentId), ctx.ownership()),
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
  const clash = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(ctx.ownership(), eq(agents.slug, next)))
    .limit(1);
  if (clash.length > 0) return { reason: 'taken', success: false };

  try {
    await ctx.db
      .update(agents)
      .set({ slug: next, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), ctx.ownership()));
  } catch {
    // Unique violation from a concurrent rename — same user-facing outcome.
    return { reason: 'taken', success: false };
  }

  return { success: true };
};
