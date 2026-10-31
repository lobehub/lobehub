import { TRPCError } from '@trpc/server';
import { and, eq, inArray, ne } from 'drizzle-orm';

import type { NewChatGroupAgent } from '../../schemas';
import { agents, chatGroupsAgents } from '../../schemas';
import type { GroupMemberRole } from '../../utils/groupMembership';
import { GROUP_SUPERVISOR_ROLE, resolveGroupMembershipType } from '../../utils/groupMembership';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { RESERVED_BUILTIN_AGENT_SLUGS } from './constants';
import { type ChatGroupContext, groupAgentsOwnership } from './scope';

export const addAgentToGroup = async (
  ctx: ChatGroupContext,
  groupId: string,
  agentId: string,
  options?: { order?: number; role?: GroupMemberRole },
): Promise<NewChatGroupAgent> => {
  const params: NewChatGroupAgent = {
    agentId,
    chatGroupId: groupId,
    order: options?.order || 0,
    role: options?.role || 'assistant',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  };

  const [result] = await ctx.db.insert(chatGroupsAgents).values(params).returning();
  return result;
};

/**
 * Add multiple agents to a group.
 * Automatically skips agents that are already in the group.
 *
 * @returns Object containing:
 * - `added`: Agents that were newly added to the group
 * - `existing`: Agent IDs that were already in the group (skipped)
 */
export const addAgentsToGroup = async (
  ctx: ChatGroupContext,
  groupId: string,
  agentIds: string[],
): Promise<{ added: NewChatGroupAgent[]; existing: string[] }> => {
  const group = await ctx.model.findById(groupId);
  if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });

  // Composite visibility rule for group membership:
  // - A caller-owned private group may admit the caller's own private agents
  //   alongside public ones.
  // - Any public group, or any group the caller doesn't own, must contain
  //   only public agents — even the caller's own private agent can't be
  //   added, because that would expose it to the other members.
  // `findById` already scopes by visibility, so reaching here with
  // `group.visibility === 'private'` implies `group.userId === ctx.userId`.
  const allowPrivateMembers = group.visibility === 'private' && group.userId === ctx.userId;

  if (agentIds.length > 0) {
    // Resolve each requested agent through the workspace + visibility
    // predicate so another user's private agent never enters this set; it
    // simply doesn't match the row filter, and we surface NOT_FOUND below.
    const visibleAgents = await ctx.db
      .select({
        id: agents.id,
        slug: agents.slug,
        userId: agents.userId,
        virtual: agents.virtual,
        visibility: agents.visibility,
      })
      .from(agents)
      .where(
        and(
          inArray(agents.id, agentIds),
          buildWorkspaceWhere(
            { userId: ctx.userId, workspaceId: ctx.workspaceId },
            {
              isDeleted: agents.isDeleted,
              userId: agents.userId,
              workspaceId: agents.workspaceId,
              visibility: agents.visibility,
            },
          ),
        ),
      );

    const visibleById = new Map(visibleAgents.map((row) => [row.id, row]));
    for (const agentId of agentIds) {
      const row = visibleById.get(agentId);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
      }
      if (row.visibility === 'private' && !allowPrivateMembers) {
        // Caller owns this private agent (visibility predicate would have
        // hidden it otherwise) but the group can't hold private members.
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
      }
    }

    // `resolveGroupMembershipType` treats a virtual member as OWNED by its
    // group: the delete path takes it down with the group, the transfer path
    // rehomes it. Both are sound only while such an agent belongs to exactly
    // ONE group — otherwise deleting either group destroys an agent the
    // other still lists.
    //
    // The invariant is "exactly one", not "never joins one": the group agent
    // builder legitimately creates a `virtual: true` agent and adds it here,
    // and that is its first and only membership. So reject only a virtual
    // agent that is ALREADY on another group's roster — which nothing in the
    // product does, since the member picker filters virtual agents
    // (`buildQueryAgentsWhere`), leaving this enforced by a query rather
    // than by the write until now.
    // Builtins (Inbox, the agent builders) are provisioned per user and are
    // `virtual` like a group's own members, so the membership rules would
    // classify one as group-OWNED the moment it joined a roster — and
    // `removeAgentsFromGroup` deletes owned members. Letting someone add
    // their Inbox to a group and then leave the group would delete the
    // Inbox. They are nobody's group member; refuse at the door.
    const builtinAgentId = agentIds.find((id) => {
      const slug = visibleById.get(id)?.slug;
      return !!slug && RESERVED_BUILTIN_AGENT_SLUGS.includes(slug);
    });
    if (builtinAgentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A builtin agent cannot join a chat group',
      });
    }

    const virtualAgentIds = agentIds.filter((id) => visibleById.get(id)?.virtual);
    if (virtualAgentIds.length > 0) {
      const [poached] = await ctx.db
        .select({ agentId: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .where(
          and(
            inArray(chatGroupsAgents.agentId, virtualAgentIds),
            ne(chatGroupsAgents.chatGroupId, groupId),
          ),
        )
        .limit(1);

      if (poached) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A group-owned agent cannot join another group',
        });
      }
    }
  }

  const existingAgents = await ctx.model.getGroupAgents(groupId);
  const existingAgentIds = new Set(existingAgents.map((a) => a.agentId));

  const newAgentIds = agentIds.filter((id) => !existingAgentIds.has(id));
  const existingIds = agentIds.filter((id) => existingAgentIds.has(id));

  if (newAgentIds.length === 0) {
    return { added: [], existing: existingIds };
  }

  // Append new members after the current highest order so an incremental add
  // never collapses everyone to the default `order = 0` (which would make the
  // roster re-shuffle on every refetch). Supervisor rows sit at `order = -1`,
  // so a group holding only a supervisor yields maxOrder = -1 → the first
  // member gets order 0.
  const maxOrder = existingAgents.reduce((max, agent) => Math.max(max, agent.order ?? 0), -1);

  const newAgents: NewChatGroupAgent[] = newAgentIds.map((agentId, index) => ({
    agentId,
    chatGroupId: groupId,
    enabled: true,
    order: maxOrder + 1 + index,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  }));

  const added = await ctx.db.insert(chatGroupsAgents).values(newAgents).returning();

  return { added, existing: existingIds };
};

export const removeAgentFromGroup = async (
  ctx: ChatGroupContext,
  groupId: string,
  agentId: string,
): Promise<void> => {
  await ctx.db
    .delete(chatGroupsAgents)
    .where(
      and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        eq(chatGroupsAgents.agentId, agentId),
        groupAgentsOwnership(ctx),
      ),
    );
};

/**
 * Batch remove multiple agents from a group.
 * More efficient than calling removeAgentFromGroup multiple times.
 */
export const removeAgentsFromGroup = async (
  ctx: ChatGroupContext,
  groupId: string,
  agentIds: string[],
): Promise<void> => {
  if (agentIds.length === 0) return;

  await ctx.db
    .delete(chatGroupsAgents)
    .where(
      and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        inArray(chatGroupsAgents.agentId, agentIds),
        groupAgentsOwnership(ctx),
      ),
    );
};

export const updateAgentInGroup = async (
  ctx: ChatGroupContext,
  groupId: string,
  agentId: string,
  updates: Partial<Pick<NewChatGroupAgent, 'enabled' | 'order'>> & { role?: GroupMemberRole },
): Promise<NewChatGroupAgent> => {
  // A supervisor is the group's own synthetic orchestrator: every path that
  // creates one creates a fresh virtual agent for it, and the delete/transfer
  // paths rely on `supervisor ⟹ owned`. Promoting a `referenced` member would
  // break that invariant and put a member's personal agent on the group's
  // lifecycle, so it is refused rather than silently reclassified.
  if (updates.role === GROUP_SUPERVISOR_ROLE) {
    const [row] = await ctx.db
      .select({ role: chatGroupsAgents.role, slug: agents.slug, virtual: agents.virtual })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.agentId, agentId),
          groupAgentsOwnership(ctx),
        ),
      );

    if (row && resolveGroupMembershipType(row) !== 'owned') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only a group-owned member can act as the group supervisor',
      });
    }
  }

  const [result] = await ctx.db
    .update(chatGroupsAgents)
    .set({ ...updates, updatedAt: new Date() })
    .where(
      and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        eq(chatGroupsAgents.agentId, agentId),
        groupAgentsOwnership(ctx),
      ),
    )
    .returning();

  return result;
};
