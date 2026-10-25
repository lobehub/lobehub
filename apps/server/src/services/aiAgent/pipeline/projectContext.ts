import type { LobeChatDatabase } from '@lobechat/database';
import { buildProjectContextPrompt } from '@lobechat/prompts';
import debug from 'debug';

import { ProjectModel } from '@/database/models/project';

const log = debug('lobe-server:ai-agent-service');

/** Open work is anything a member may still act on. */
const CLOSED_TASK_STATUSES = new Set(['canceled', 'completed']);
/** Enough for the coordinator to plan from without crowding the turn. */
const MAX_LISTED_TASKS = 20;

export interface ProjectContextDeps {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * The project context injected into every turn of a run inside a project.
 * Read live each turn — the coordinator's own systemRole only carries its
 * identity, so renames and membership changes reach it immediately. A failed
 * read leaves the turn without the block rather than failing it.
 */
export const buildRunProjectContextPrompt = async (
  deps: ProjectContextDeps,
  projectId: string | undefined,
  agentId: string,
  options: { coordinationRules?: boolean } = {},
): Promise<string | undefined> => {
  if (!projectId) return;

  try {
    const projectModel = new ProjectModel(deps.db, deps.userId, deps.workspaceId);
    const [project, members, knowledgeBases, tasks] = await Promise.all([
      projectModel.findById(projectId),
      projectModel.listAgents(projectId),
      projectModel.listKnowledgeBases(projectId),
      projectModel.listTasks(projectId),
    ]);
    if (!project) return;
    const [resolvedProject] = await projectModel.resolveCoordinatorAgents([project]);

    const openTasks = (tasks ?? []).filter((task) => !CLOSED_TASK_STATUSES.has(task.status));
    return buildProjectContextPrompt({
      coordinationRules: options.coordinationRules,
      currentAgentId: agentId,
      knowledgeBases: (knowledgeBases ?? [])
        .filter(({ binding }) => binding.enabled)
        .map(({ knowledgeBase }) => ({
          description: knowledgeBase.description,
          id: knowledgeBase.id,
          name: knowledgeBase.name,
        })),
      members: (members ?? [])
        .filter(({ binding }) => binding.enabled)
        .map(({ agent, binding }) => ({
          agentId: agent.id,
          responsibility: binding.responsibility,
          role: binding.role,
          title: agent.title,
        })),
      openTasks: openTasks.slice(0, MAX_LISTED_TASKS).map((task) => ({
        assigneeAgentId: task.assigneeAgentId,
        identifier: task.identifier,
        name: task.name,
        priority: task.priority,
        status: task.status,
      })),
      project: resolvedProject,
      totalOpenTasks: openTasks.length,
    });
  } catch (error) {
    log('execAgent: failed to build project context for %s: %O', projectId, error);
    return;
  }
};

/**
 * The same project context for a heterogeneous (CLI) agent's system context,
 * which has no context engine to wrap it and no LobeHub task tools to follow
 * delegation rules with.
 */
export const buildHeteroProjectContext = async (
  deps: ProjectContextDeps,
  projectId: string | undefined,
  agentId: string,
): Promise<string | undefined> => {
  const prompt = await buildRunProjectContextPrompt(deps, projectId, agentId, {
    coordinationRules: false,
  });
  return prompt && `<project_context>\n${prompt}\n</project_context>`;
};
