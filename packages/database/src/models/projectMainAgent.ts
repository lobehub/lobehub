import { createProjectCoordinatorAgentConfig } from '@lobechat/builtin-agents';
import type { ProjectVisibility } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

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
 * agent the user sees in the agents list, named after the project, wearing its
 * avatar and the shared project label. Unlike the virtual coordinators earlier
 * projects got, it outlives the project.
 */
export const createProjectMainAgent = async (
  db: LobeChatDatabase,
  scope: Scope,
  input: { avatar?: string; name: string; visibility?: ProjectVisibility },
) => {
  const agent = await new AgentModel(db, scope.userId, scope.workspaceId).create({
    ...createProjectCoordinatorAgentConfig({ avatar: input.avatar, name: input.name }),
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
