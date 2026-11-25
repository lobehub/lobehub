import { getProjectDraftPath, getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { projectService } from '@/services/project';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import {
  type BoundDirectoryLike,
  normalizeComparablePath,
  pickLatestTopic,
  resolveDirectoryMatch,
} from './openDirectorySelection';

export interface OpenDirectoryResult {
  /** Directory the launch resolved to, when any. */
  directory?: BoundDirectoryLike;
  /** Matched by an ancestor rather than the path itself. */
  matchedParent?: boolean;
  projectId?: string;
  status:
    | 'created-project'
    | 'created-project-unbound'
    | 'directory-not-bound'
    | 'directory-unavailable'
    | 'opened-draft'
    | 'opened-topic';
  topicId?: string;
}

const folderName = (path: string) => path.split(/[/\\]/).findLast(Boolean) || path;

// Without a known LobeAI id (still loading on a cold start) the server creates
// the main agent, so the launch never waits on the agent store.
const createProjectForDirectory = async ({
  deviceId,
  navigate,
  path,
}: {
  deviceId: string;
  navigate: (path: string) => void;
  path: string;
}): Promise<OpenDirectoryResult> => {
  const name = folderName(path);
  const inboxAgentId = builtinAgentSelectors.inboxAgentId(useAgentStore.getState());
  const project = await useProjectStore
    .getState()
    .createProject(inboxAgentId ? { coordinatorAgentId: inboxAgentId, name } : { name });

  try {
    const directory = await useProjectDirectoryStore
      .getState()
      .bind({ deviceId, name, path, projectId: project.id });

    if (project.coordinatorAgentId) {
      navigate(getProjectDraftPath(project.id, project.coordinatorAgentId, directory.id));
      return { projectId: project.id, status: 'created-project' };
    }
  } catch (error) {
    console.error(`[openDirectory] Failed to bind ${path} to project ${project.id}`, error);
  }

  navigate(`/project/${project.id}`);
  return { projectId: project.id, status: 'created-project-unbound' };
};

/**
 * Land a shell launch on the right conversation.
 *
 * Reusing the conversation already bound to the directory is what makes the
 * command feel like `code .`: running it twice focuses the same window instead
 * of stacking duplicates. Only when the directory has no conversation yet do
 * we stage a draft — the first message creates the topic, the same way a
 * sidebar "+" does, so a stray launch never leaves an empty topic behind.
 */
export const openDirectoryInApp = async ({
  getDeviceId,
  navigate,
  reuseExisting = true,
  targetPath,
  timeoutMs,
}: {
  /** Polled until known: device identity arrives after the renderer boots. */
  getDeviceId: () => string | undefined;
  navigate: (path: string) => void;
  /** `false` for `lh app --new-window`: stage a fresh conversation instead. */
  reuseExisting?: boolean;
  targetPath: string;
  timeoutMs?: number;
}): Promise<OpenDirectoryResult> => {
  const target = normalizeComparablePath(targetPath);
  const resolution = await resolveDirectoryMatch({
    getDeviceId,
    list: async () => (await projectWorkingDirectoryService.list()).data,
    targetPath: target,
    timeoutMs,
  });

  if (resolution.status === 'unavailable') {
    console.warn(
      `[openDirectory] Could not resolve ${target}: no device identity or server answer`,
    );
    // The list route is `/projects` — `/project` renders the not-found page.
    navigate('/projects');
    return { status: 'directory-unavailable' };
  }

  if (resolution.status === 'unbound')
    return createProjectForDirectory({ deviceId: resolution.deviceId, navigate, path: target });

  const { directory, matchedParent } = resolution;
  const { data: topics } = await projectWorkingDirectoryService.listTopics(directory.id);
  const latest = reuseExisting ? pickLatestTopic(topics ?? []) : undefined;

  if (latest) {
    navigate(getProjectTopicPath(directory.projectId, latest.id));
    return { directory, matchedParent, status: 'opened-topic', topicId: latest.id };
  }

  // A draft needs the agent that will answer in it; the project's coordinator
  // is the same default a fresh project conversation starts on.
  const { data: project } = await projectService.find(directory.projectId);
  const agentId = project?.coordinatorAgentId;
  if (!agentId) {
    console.warn(`[openDirectory] Project ${directory.projectId} has no coordinator agent`);
    navigate('/projects');
    return { directory, matchedParent, status: 'directory-not-bound' };
  }

  navigate(getProjectDraftPath(directory.projectId, agentId, directory.id));
  return { directory, matchedParent, status: 'opened-draft' };
};
