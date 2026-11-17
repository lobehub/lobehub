import { CloudSandboxIdentifier } from '@lobechat/builtin-tool-cloud-sandbox';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
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
 * Whether the run's commands land in the cloud sandbox, where a project
 * repository is checked out. The Cloud Sandbox tool always runs there; the
 * always-on Skills tool's runCommand / execScript open the same session only
 * when no device is routed — a routed (or waking) device runs them in its own
 * working directory, not in a cloud checkout.
 */
export const runReachesCloudSandbox = ({
  deviceRouted,
  enabledToolIds,
}: {
  deviceRouted: boolean;
  enabledToolIds?: string[];
}): boolean =>
  !!enabledToolIds?.includes(CloudSandboxIdentifier) ||
  (!deviceRouted && !!enabledToolIds?.includes(SkillsIdentifier));

/**
 * A repository URL with nothing secret left in it, or `undefined` when it
 * cannot be read as one. A stored source may carry a token in its userinfo,
 * query or fragment, and the model context — and every trace of it — must
 * never receive one.
 */
export const toCredentialFreeRepositoryUrl = (value: string): string | undefined => {
  const raw = value.trim();
  // An scp-style remote (`git@github.com:owner/repo.git`): the user is a fixed
  // login name, not a secret, but it is dropped all the same.
  const scp = /^[^\s/@:]+@([\w.-]+):([^\s?#]+)$/.exec(raw);
  if (scp) return `${scp[1]}:${scp[2]}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (!['git:', 'http:', 'https:', 'ssh:'].includes(url.protocol) || !url.host) return;

  return `${url.protocol}//${url.host}${url.pathname}`;
};

/** The folder of the working directory a source is cloned into; `undefined` for the root. */
const checkoutFolder = (path: string | undefined): string | undefined => {
  const folder = path
    ?.trim()
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  return folder && folder !== '.' ? folder : undefined;
};

/**
 * The repository a cloud-sandbox run checks out: the first git source of what
 * the session checks out — a persistent instance's snapshot, otherwise the
 * environment the topic picked — decided the way the sandbox decides it, so
 * the run is never told about a checkout it will not get. A project
 * conversation picks its project's repository when it is created.
 * Never throws.
 */
export const resolveSandboxRepository = async (
  deps: ProjectContextDeps & { isShareVisitorRun?: boolean },
  topicId: string,
): Promise<ProjectContextRepository | undefined> => {
  try {
    const checkout = await resolveTopicCheckoutConfiguration({
      isShareVisitorRun: !!deps.isShareVisitorRun,
      serverDB: deps.db,
      topicId,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    });
    const source = checkout?.configuration?.sources?.find(
      (item) => item.kind === 'git' && !!item.url,
    );
    if (!checkout || !source || source.kind !== 'git') return;

    const url = toCredentialFreeRepositoryUrl(source.url);
    if (!url) return;

    const path = checkoutFolder(source.path);
    return { name: checkout.name, ref: source.ref, url, ...(path && { path }) };
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
  deps: ProjectContextDeps & { isShareVisitorRun?: boolean },
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
