import type { GoalVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { agents, goalNodes, projects, tasks } from '@/database/schemas';
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

const PUBLIC_IN_PRIVATE_PROJECT =
  'A goal in a private project must be private; members cannot see the project';

/** Whether the goal's project is a private workspace project. */
const isPrivateProject = async (
  db: LobeChatDatabase | Transaction,
  projectId: string | null | undefined,
) => {
  if (!projectId) return false;
  const [row] = await db
    .select({ visibility: projects.visibility, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return !!row?.workspaceId && row.visibility === 'private';
};

/**
 * The visibility a goal is created with. Mirrors `TaskService.createTask`:
 * an explicit value wins, a private agent or project makes the goal private,
 * else the column default ('public'). A public goal on a private agent or in
 * a private project is refused — members would see a goal whose agent, tasks,
 * runs or project they cannot open.
 */
export const resolveGoalVisibility = async (
  db: LobeChatDatabase | Transaction,
  requested: GoalVisibility | undefined,
  agentIds: (string | null | undefined)[],
  projectId?: string | null,
): Promise<GoalVisibility> => {
  const [privateAgent, privateProject] = await Promise.all([
    hasPrivateAgent(db, agentIds),
    isPrivateProject(db, projectId),
  ]);
  if (requested === 'public' && privateAgent)
    throw new TRPCError({ code: 'BAD_REQUEST', message: PUBLIC_WITH_PRIVATE_AGENT });
  if (requested === 'public' && privateProject)
    throw new TRPCError({ code: 'BAD_REQUEST', message: PUBLIC_IN_PRIVATE_PROJECT });
  return requested ?? (privateAgent || privateProject ? 'private' : 'public');
};

/** Refuse publishing a goal that sits in a private project. */
export const assertGoalProjectVisibilityCompat = async (
  db: LobeChatDatabase | Transaction,
  goal: { projectId: string | null; visibility: GoalVisibility; workspaceId: string | null },
) => {
  if (!goal.workspaceId || goal.visibility !== 'public') return;
  if (await isPrivateProject(db, goal.projectId))
    throw new TRPCError({ code: 'BAD_REQUEST', message: PUBLIC_IN_PRIVATE_PROJECT });
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
