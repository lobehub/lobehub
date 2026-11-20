import { and, eq } from 'drizzle-orm';

import { projectAgents } from '../../schemas/project';
import type { LobeChatDatabase } from '../../type';

export interface ProjectAgentInput {
  agentId: string;
  enabled?: boolean;
  responsibility?: string | null;
  role?: string | null;
  sortOrder?: number;
}

export type ProjectAgentPatch = Partial<Omit<ProjectAgentInput, 'agentId'>>;

/** Who adds a binding and the scope it lives in; the caller has already checked the project. */
interface BindingScope {
  addedByUserId: string;
  projectId: string;
  workspaceId: string | null;
}

const bindingOf = (projectId: string, agentId: string) =>
  and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId));

export const hasProjectAgentBinding = async (
  db: LobeChatDatabase,
  projectId: string,
  agentId: string,
) => {
  const [binding] = await db
    .select({ id: projectAgents.id })
    .from(projectAgents)
    .where(bindingOf(projectId, agentId))
    .limit(1);
  return !!binding;
};

/** Binds an Agent to a project, or updates its existing binding in place. */
export const upsertProjectAgent = async (
  db: LobeChatDatabase,
  scope: BindingScope,
  input: ProjectAgentInput,
) => {
  const [binding] = await db
    .insert(projectAgents)
    .values({ ...input, ...scope })
    .onConflictDoUpdate({
      set: {
        enabled: input.enabled,
        responsibility: input.responsibility,
        role: input.role,
        sortOrder: input.sortOrder,
        updatedAt: new Date(),
      },
      target: [projectAgents.projectId, projectAgents.agentId],
    })
    .returning();
  return binding;
};

export const updateProjectAgent = async (
  db: LobeChatDatabase,
  projectId: string,
  agentId: string,
  patch: ProjectAgentPatch,
) => {
  const [binding] = await db
    .update(projectAgents)
    .set({ ...patch, updatedAt: new Date() })
    .where(bindingOf(projectId, agentId))
    .returning();
  return binding ?? null;
};

export const deleteProjectAgent = async (
  db: LobeChatDatabase,
  projectId: string,
  agentId: string,
) => {
  const deleted = await db
    .delete(projectAgents)
    .where(bindingOf(projectId, agentId))
    .returning({ id: projectAgents.id });
  return deleted.length > 0;
};

/**
 * Seats a new main agent as an enabled member. The project role belonged to the main agent, so
 * the predecessor stays on as a member that reads like any other.
 */
export const seatCoordinator = async (
  db: LobeChatDatabase,
  scope: BindingScope & { agentId: string; previousId: string | null },
) => {
  const { agentId, previousId, ...binding } = scope;
  await db
    .insert(projectAgents)
    .values({ ...binding, agentId })
    .onConflictDoUpdate({
      set: { enabled: true, updatedAt: new Date() },
      target: [projectAgents.projectId, projectAgents.agentId],
    });
  if (!previousId) return;
  await db
    .update(projectAgents)
    .set({ role: null, updatedAt: new Date() })
    .where(and(bindingOf(binding.projectId, previousId), eq(projectAgents.role, 'coordinator')));
};
