import type { GoalVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { agents, goalNodes, tasks } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

/**
 * Whether any of the goal's agents (supervisor, dedicated executor) is private.
 * Callers have already checked each agent is usable by them; this only reads
 * the flag, so it does not repeat the ownership filter.
 */
const hasPrivateAgent = async (
  db: LobeChatDatabase | Transaction,
  agentIds: (string | null | undefined)[],
) => {
  const ids = [...new Set(agentIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return false;
  const rows = await db
    .select({ visibility: agents.visibility })
    .from(agents)
    .where(inArray(agents.id, ids));
  return rows.some((row) => row.visibility === 'private');
};

const PUBLIC_WITH_PRIVATE_AGENT =
  'A public goal cannot be run by a private agent; make the goal private or pick a public agent';

/**
 * The visibility a goal is created with. Mirrors `TaskService.createTask`:
 * an explicit value wins, a private agent makes the goal private, else the
 * column default ('public'). A public goal on a private agent is refused —
 * members would see a goal whose agent, tasks and runs they cannot open.
 */
export const resolveGoalVisibility = async (
  db: LobeChatDatabase | Transaction,
  requested: GoalVisibility | undefined,
  agentIds: (string | null | undefined)[],
): Promise<GoalVisibility> => {
  const privateAgent = await hasPrivateAgent(db, agentIds);
  if (requested === 'public' && privateAgent)
    throw new TRPCError({ code: 'BAD_REQUEST', message: PUBLIC_WITH_PRIVATE_AGENT });
  return requested ?? (privateAgent ? 'private' : 'public');
};

/** Refuse handing a public goal to a private agent (set-agent / set-task-agent / bind-topic). */
export const assertGoalAgentVisibilityCompat = async (
  db: LobeChatDatabase | Transaction,
  goal: { visibility: GoalVisibility; workspaceId: string | null },
  agentIds: (string | null | undefined)[],
) => {
  // Personal goals are private to their owner whatever the column says.
  if (!goal.workspaceId || goal.visibility !== 'public') return;
  if (await hasPrivateAgent(db, agentIds))
    throw new TRPCError({ code: 'BAD_REQUEST', message: PUBLIC_WITH_PRIVATE_AGENT });
};

/**
 * The goal's own Tasks that move with it: the ones its owner created (the
 * coordinator files them under the owner). A Task another member created stays
 * theirs — demoting it would hand it to them privately and hide it from the
 * goal's owner.
 */
export const goalTasksToCascade = async (
  db: LobeChatDatabase | Transaction,
  goal: { id: string; userId: string },
  visibility: GoalVisibility,
) => {
  const rows = await db
    .select({ agentVisibility: agents.visibility, id: tasks.id })
    .from(goalNodes)
    .innerJoin(tasks, eq(goalNodes.taskId, tasks.id))
    .leftJoin(agents, eq(agents.id, tasks.assigneeAgentId))
    .where(
      and(
        eq(goalNodes.goalId, goal.id),
        eq(tasks.createdByUserId, goal.userId),
        ne(tasks.visibility, visibility),
      ),
    );
  return (
    rows
      // A Task on a private agent stays private: a public Task never runs on one.
      .filter((row) => visibility === 'private' || row.agentVisibility !== 'private')
      .map((row) => row.id)
  );
};
