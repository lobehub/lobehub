import { createProjectCoordinatorAgentConfig } from '@lobechat/builtin-agents';
import type { ProjectVisibility } from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { agentLabelAssignments, agentLabels } from '../schemas/agentLabel';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '../schemas/resourcePermission';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { AgentModel } from './agent';
import { ResourcePermissionModel } from './resourcePermission';

/**
 * Every agent a project creates for itself carries this label, so they group
 * together in the agents list. One label per scope, shared by all projects.
 */
export const PROJECT_AGENT_LABEL = 'Project';

interface Scope {
  userId: string;
  workspaceId?: string;
}

const findOrCreateProjectLabel = async (db: LobeChatDatabase, scope: Scope) => {
  const ownership = buildWorkspaceWhere(scope, {
    userId: agentLabels.userId,
    workspaceId: agentLabels.workspaceId,
  });
  const find = async () => {
    const [label] = await db
      .select({ id: agentLabels.id })
      .from(agentLabels)
      .where(
        and(
          eq(agentLabels.name, PROJECT_AGENT_LABEL),
          // An archived label is retired and cannot take new agents.
          eq(agentLabels.archived, false),
          ownership,
        ),
      )
      .limit(1);
    return label?.id;
  };

  const existing = await find();
  if (existing) return existing;

  const [created] = await db
    .insert(agentLabels)
    .values(buildWorkspacePayload(scope, { name: PROJECT_AGENT_LABEL }))
    // Another project created in the same scope may have just added it.
    .onConflictDoNothing()
    .returning({ id: agentLabels.id });

  const id = created?.id ?? (await find());
  if (!id) throw new Error('Failed to create the project agent label');
  return id;
};

/**
 * Create the agent that leads a new project when none was picked: an ordinary
 * agent named after the project, wearing its avatar and the shared project
 * label. Once the project row exists the caller marks it as the project's own
 * ({@link markProjectOwnedAgent}). Unlike the virtual coordinators earlier
 * projects got, it outlives the project: deleting the project only clears the
 * mark (`ON DELETE SET NULL`).
 */
export const createProjectMainAgent = async (
  db: LobeChatDatabase,
  scope: Scope,
  input: {
    avatar?: string;
    /** Reserved by the create form so its generated avatar matches the preview. */
    id?: string;
    name: string;
    visibility?: ProjectVisibility;
  },
) => {
  const agent = await new AgentModel(db, scope.userId, scope.workspaceId).create({
    ...createProjectCoordinatorAgentConfig({ avatar: input.avatar, name: input.name }),
    ...(input.id && { id: input.id }),
    // A project's work outlives a conversation and needs no machine of the
    // member's to be online: the cloud sandbox keeps the project's checkout on
    // its drive. Left unset, a web client would resolve the agent to no
    // execution target at all, and the project would start with nowhere to run.
    agencyConfig: { executionTarget: 'sandbox' },
    visibility: input.visibility,
  });

  // Same as an agent created from the agents list: a shared workspace agent
  // starts at the default access level.
  if (scope.workspaceId && agent.visibility !== 'private') {
    await new ResourcePermissionModel(db, scope.workspaceId).setAccessLevel(
      'agent',
      agent.id,
      DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
      scope.userId,
    );
  }

  const labelId = await findOrCreateProjectLabel(db, scope);
  await db
    .insert(agentLabelAssignments)
    .values(buildWorkspacePayload(scope, { agentId: agent.id, labelId }))
    .onConflictDoNothing();

  return agent;
};

/**
 * Mark an agent as the project's own coordinator (`agents.owner_project_id`), so
 * it is configured through the project and hidden from standalone agent lists.
 * Called once the project row exists, inside the create transaction. Only an
 * unowned agent is marked: an agent another project owns is never taken over.
 */
export const markProjectOwnedAgent = async (
  db: LobeChatDatabase,
  { agentId, projectId }: { agentId: string; projectId: string },
) => {
  const [marked] = await db
    .update(agents)
    .set({ ownerProjectId: projectId })
    .where(and(eq(agents.id, agentId), isNull(agents.ownerProjectId)))
    .returning({ id: agents.id, ownerProjectId: agents.ownerProjectId });
  return marked ?? null;
};

/**
 * Hand an agent the project owned back to the standalone agents list, e.g. once
 * it stops leading the project. Its configuration and history stay untouched.
 */
export const releaseProjectOwnedAgent = async (
  db: LobeChatDatabase,
  { agentId, projectId }: { agentId: string; projectId: string },
) => {
  await db
    .update(agents)
    .set({ ownerProjectId: null })
    .where(and(eq(agents.id, agentId), eq(agents.ownerProjectId, projectId)));
};
