import { getProjectDraftPath, getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { projectService } from '@/services/project';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

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
  status: 'directory-not-bound' | 'opened-draft' | 'opened-topic';
  topicId?: string;
}

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
}: {
  /** Polled until known: device identity arrives after the renderer boots. */
  getDeviceId: () => string | undefined;
  navigate: (path: string) => void;
  /** `false` for `lh app --new-window`: stage a fresh conversation instead. */
  reuseExisting?: boolean;
  targetPath: string;
}): Promise<OpenDirectoryResult> => {
  const target = normalizeComparablePath(targetPath);
  const match = await resolveDirectoryMatch({
    getDeviceId,
    list: async () => (await projectWorkingDirectoryService.list()).data,
    targetPath: target,
  });

  if (!match) {
    console.warn(`[openDirectory] No project directory is bound to ${target}`);
    // Land where binding happens instead of a silent no-op. The list route is
    // `/projects` — `/project` renders the not-found page.
    navigate('/projects');
    return { status: 'directory-not-bound' };
  }

  const { directory, matchedParent } = match;
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
