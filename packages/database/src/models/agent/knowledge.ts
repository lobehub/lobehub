import { and, desc, eq, inArray } from 'drizzle-orm';

import { agentsFiles, agentsKnowledgeBases, files, knowledgeBases } from '../../schemas';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../../utils/workspace';
import { type AgentModelContext } from './context';

export const getAgentAssignedKnowledge = async (ctx: AgentModelContext, id: string) => {
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
    ctx.db
      .select({ enabled: agentsKnowledgeBases.enabled, knowledgeBases })
      .from(agentsKnowledgeBases)
      .where(and(eq(agentsKnowledgeBases.agentId, id), ctx.agentsKnowledgeBasesOwnership()))
      .orderBy(desc(agentsKnowledgeBases.createdAt))
      .leftJoin(
        knowledgeBases,
        and(
          eq(knowledgeBases.id, agentsKnowledgeBases.knowledgeBaseId),
          buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, knowledgeBases),
        ),
      ),
    ctx.db
      .select({ enabled: agentsFiles.enabled, files })
      .from(agentsFiles)
      .where(and(eq(agentsFiles.agentId, id), ctx.agentsFilesOwnership()))
      .orderBy(desc(agentsFiles.createdAt))
      .leftJoin(
        files,
        and(
          eq(files.id, agentsFiles.fileId),
          buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, files),
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

export const createAgentKnowledgeBase = async (
  ctx: AgentModelContext,
  agentId: string,
  knowledgeBaseId: string,
  enabled: boolean = true,
) => {
  return ctx.db
    .insert(agentsKnowledgeBases)
    .values(
      buildWorkspacePayload(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        { agentId, enabled, knowledgeBaseId },
      ),
    );
};

export const deleteAgentKnowledgeBase = async (
  ctx: AgentModelContext,
  agentId: string,
  knowledgeBaseId: string,
) => {
  return ctx.db
    .delete(agentsKnowledgeBases)
    .where(
      and(
        eq(agentsKnowledgeBases.agentId, agentId),
        eq(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
        ctx.agentsKnowledgeBasesOwnership(),
      ),
    );
};

export const toggleKnowledgeBase = async (
  ctx: AgentModelContext,
  agentId: string,
  knowledgeBaseId: string,
  enabled?: boolean,
) => {
  return ctx.db
    .update(agentsKnowledgeBases)
    .set({ enabled })
    .where(
      and(
        eq(agentsKnowledgeBases.agentId, agentId),
        eq(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
        ctx.agentsKnowledgeBasesOwnership(),
      ),
    );
};

export const createAgentFiles = async (
  ctx: AgentModelContext,
  agentId: string,
  fileIds: string[],
  enabled: boolean = true,
) => {
  // Exclude the fileIds that already exist in agentsFiles, and then insert them
  const existingFiles = await ctx.db
    .select({ id: agentsFiles.fileId })
    .from(agentsFiles)
    .where(
      and(
        eq(agentsFiles.agentId, agentId),
        ctx.agentsFilesOwnership(),
        inArray(agentsFiles.fileId, fileIds),
      ),
    );

  const existingFilesIds = new Set(existingFiles.map((item) => item.id));

  const needToInsertFileIds = fileIds.filter((fileId) => !existingFilesIds.has(fileId));

  if (needToInsertFileIds.length === 0) return;

  return ctx.db
    .insert(agentsFiles)
    .values(
      needToInsertFileIds.map((fileId) =>
        buildWorkspacePayload(
          { userId: ctx.userId, workspaceId: ctx.workspaceId },
          { agentId, enabled, fileId },
        ),
      ),
    );
};

export const deleteAgentFile = async (ctx: AgentModelContext, agentId: string, fileId: string) => {
  return ctx.db
    .delete(agentsFiles)
    .where(
      and(
        eq(agentsFiles.agentId, agentId),
        eq(agentsFiles.fileId, fileId),
        ctx.agentsFilesOwnership(),
      ),
    );
};

export const toggleFile = async (
  ctx: AgentModelContext,
  agentId: string,
  fileId: string,
  enabled?: boolean,
) => {
  return ctx.db
    .update(agentsFiles)
    .set({ enabled })
    .where(
      and(
        eq(agentsFiles.agentId, agentId),
        eq(agentsFiles.fileId, fileId),
        ctx.agentsFilesOwnership(),
      ),
    );
};
