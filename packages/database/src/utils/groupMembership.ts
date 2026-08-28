import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { and, eq, isNull, notInArray, or, type SQL } from 'drizzle-orm';

import { agents, chatGroupsAgents } from '../schemas';

/**
 * Builtins (Inbox, the agent builders) are provisioned per user and carry
 * `virtual: true` just like a group's own members — so without this they would
 * classify as OWNED the moment one landed on a roster, and the owned paths
 * delete them (group delete, roster removal) or rehome them into another scope
 * (group transfer). `addAgentsToGroup` refuses them at the door; this keeps a
 * malformed row from costing somebody their Inbox anyway.
 */
const RESERVED_BUILTIN_AGENT_SLUGS: string[] = Object.values(BUILTIN_AGENT_SLUGS);

/**
 * How a `chat_groups_agents` row binds an agent's LIFECYCLE to its group.
 *
 * This is deliberately separate from `chat_groups_agents.role`, which says what
 * the member DOES in the conversation (`supervisor` / `participant` / …):
 * `role` governs function, membership governs ownership.
 *
 * - `owned` — the agent exists only to serve this group (the synthetic
 *   supervisor, and members created through the group builder). It travels
 *   with the group on a transfer, and dies with the group on a delete or a
 *   removal from the roster.
 * - `referenced` — a standalone agent that was linked INTO the group. Its life
 *   is its own: leaving the roster only drops the link, deleting the group
 *   leaves it untouched, and a group transfer must not drag it into another
 *   scope (a clone is made there instead).
 */
export const GROUP_MEMBERSHIP_TYPES = ['owned', 'referenced'] as const;

export type GroupMembershipType = (typeof GROUP_MEMBERSHIP_TYPES)[number];

/**
 * Roles a `chat_groups_agents` row may carry. `supervisor` is the group's own
 * synthetic orchestrator and is `owned` by construction — every code path that
 * writes `role: 'supervisor'` creates a fresh virtual agent for it, there is no
 * path that promotes an existing agent.
 */
export const GROUP_MEMBER_ROLES = ['supervisor', 'participant', 'assistant'] as const;

export type GroupMemberRole = (typeof GROUP_MEMBER_ROLES)[number];

export const GROUP_SUPERVISOR_ROLE = 'supervisor';

interface GroupMembershipSource {
  /** `chat_groups_agents.role` of the membership row. */
  role?: string | null;
  /**
   * `agents.slug` of the member agent. Pass it wherever the read has it: a
   * reserved builtin slug forces `referenced`, so no owned path can delete or
   * rehome someone's Inbox.
   */
  slug?: string | null;
  /** `agents.virtual` of the member agent. */
  virtual?: boolean | null;
}

/**
 * The single judgement four paths share — group delete, roster removal, group
 * transfer and agent transfer.
 *
 * Having it in ONE place is the whole point. The rule itself is not new: it is
 * what `duplicateGroup` always did. What went wrong before was that the rule
 * lived only there — `transferAgents`, `ChatGroupModel.delete` and
 * `transferToWorkspace` carried no judgement at all and simply acted on every
 * member, which is where the group-lifecycle bugs came from. Re-deriving it per
 * call site is how they drift apart again, so every caller reads this.
 *
 * It matches what the UI already shows: the `External` badge is
 * `isExternal={!agent.virtual}`, so `virtual → owned` keeps the two aligned row
 * for row, and a supervisor is owned regardless of what its agent row says.
 *
 * The rule leans on a product-level invariant: a `virtual` agent belongs to
 * exactly one group, because the member picker excludes virtual agents
 * (`buildQueryAgentsWhere`). If a future feature ever lets a group-built agent
 * join a second group, that invariant breaks and this judgement has to be
 * replaced by an explicit per-membership fact — deleting one group would
 * otherwise delete an agent the other one still uses.
 */
export const resolveGroupMembershipType = (
  membership: GroupMembershipSource,
): GroupMembershipType => {
  // Ahead of every other rule, including `supervisor`: a builtin is nobody's
  // group member, and no roster row should be able to make it one.
  if (membership.slug && RESERVED_BUILTIN_AGENT_SLUGS.includes(membership.slug)) {
    return 'referenced';
  }

  if (membership.role === GROUP_SUPERVISOR_ROLE) return 'owned';

  return membership.virtual ? 'owned' : 'referenced';
};

/**
 * SQL form of {@link resolveGroupMembershipType}, for set-based work (cleanup
 * on group delete, partitioning a roster during a transfer).
 *
 * Requires `agents` to be joined onto `chat_groups_agents`. Both `role` and
 * `virtual` are nullable, and a NULL on either side yields NULL (not owned),
 * which is the safe direction: an unclassifiable row is left alone rather than
 * deleted.
 */
export const isOwnedMembership = (): SQL =>
  and(
    or(eq(chatGroupsAgents.role, GROUP_SUPERVISOR_ROLE), eq(agents.virtual, true)),
    // Mirrors the builtin carve-out above. A NULL slug predates slug
    // generation and is not a builtin; `NOT IN` alone would evaluate to NULL
    // and drop those rows from the owned set.
    or(isNull(agents.slug), notInArray(agents.slug, RESERVED_BUILTIN_AGENT_SLUGS)),
  )!;
