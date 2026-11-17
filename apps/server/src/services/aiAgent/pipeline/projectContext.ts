import type { LobeChatDatabase } from '@lobechat/database';
import type { ProjectContextRepository } from '@lobechat/prompts';
import { buildProjectContextPrompt } from '@lobechat/prompts';
import debug from 'debug';

import { ProjectModel } from '@/database/models/project';
import { resolveTopicCheckoutConfiguration } from '@/server/services/sandbox/session';

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
 * The repository a cloud-sandbox run's working directory is a checkout of: the
 * first git source of what the session checks out — a persistent instance's
 * snapshot, otherwise the environment the topic picked — read the way the
 * sandbox reads it so the run is never told about a checkout it will not get.
 * A project conversation picks its project's repository when it is created.
 * Never throws.
 */
export const resolveSandboxRepository = async (
  deps: ProjectContextDeps,
  topicId: string,
): Promise<ProjectContextRepository | undefined> => {
  try {
    const environment = await resolveTopicCheckoutConfiguration({
      serverDB: deps.db,
      topicId,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    });
    const source = environment?.configuration?.sources?.find(
      (item) => item.kind === 'git' && !!item.url,
    );
    if (!environment || !source || source.kind !== 'git') return;

    return { name: environment.name, ref: source.ref, url: source.url };
  } catch (error) {
    log('execAgent: failed to read the repository of topic %s: %O', topicId, error);
    return;
  }
};

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
  options: {
    channelMessaging?: boolean;
    coordinationRules?: boolean;
    /**
     * The conversation, when the run works in the cloud sandbox: the
     * repository it checks out is named, so the agent reads the code from its
     * first turn instead of asking where it is.
     */
    sandboxTopicId?: string;
  } = {},
): Promise<string | undefined> => {
  if (!projectId) return;

  try {
    const projectModel = new ProjectModel(deps.db, deps.userId, deps.workspaceId);
    const [project, members, knowledgeBases, tasks, repository] = await Promise.all([
      projectModel.findById(projectId),
      projectModel.listAgents(projectId),
      projectModel.listKnowledgeBases(projectId),
      projectModel.listTasks(projectId),
      options.sandboxTopicId
        ? resolveSandboxRepository(deps, options.sandboxTopicId)
        : Promise.resolve(undefined),
    ]);
    if (!project) return;
    const [resolvedProject] = await projectModel.resolveCoordinatorAgents([project]);

    const openTasks = (tasks ?? []).filter((task) => !CLOSED_TASK_STATUSES.has(task.status));
    return buildProjectContextPrompt({
      channelMessaging: options.channelMessaging,
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
      repository,
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
