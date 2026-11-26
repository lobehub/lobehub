import { getProjectDraftPath, getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { projectService } from '@/services/project';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import {
  normalizeComparablePath,
  pickDirectoryForPath,
  pickLatestTopic,
} from './openDirectorySelection';

const folderName = (path: string) => path.split(/[/\\]/).findLast(Boolean) || path;

const openInNewProject = async (
  deviceId: string,
  path: string,
  navigate: (path: string) => void,
) => {
  const name = folderName(path);
  const project = await useProjectStore.getState().createProject({
    coordinatorAgentId: builtinAgentSelectors.inboxAgentId(useAgentStore.getState()),
    name,
  });
  const directory = await useProjectDirectoryStore
    .getState()
    .bind({ deviceId, name, path, projectId: project.id });

  navigate(getProjectDraftPath(project.id, project.coordinatorAgentId!, directory.id));
};

/**
 * Land a shell launch on the right conversation, the way `code .` does: the
 * conversation already bound to the directory is revealed, a bound directory
 * without one gets a draft, and a directory bound nowhere becomes a new project
 * of its own. A draft creates no topic until its first message.
 */
export const openDirectoryInApp = async ({
  navigate,
  reuseExisting = true,
  targetPath,
}: {
  navigate: (path: string) => void;
  /** `false` for `lh app --new-window`: stage a fresh conversation instead. */
  reuseExisting?: boolean;
  targetPath: string;
}): Promise<void> => {
  // Asked over IPC rather than read from the store: on a cold start the cached
  // id is still the install fallback, which names no binding.
  const deviceId = await useElectronStore.getState().resolveGatewayDeviceId();
  if (!deviceId) {
    // The list route is `/projects` — `/project` renders the not-found page.
    navigate('/projects');
    return;
  }

  const target = normalizeComparablePath(targetPath);
  const { data: directories } = await projectWorkingDirectoryService.list();
  const match = pickDirectoryForPath(directories ?? [], target, { deviceId });
  if (!match) return openInNewProject(deviceId, target, navigate);

  const { directory } = match;
  const { data: topics } = await projectWorkingDirectoryService.listTopics(directory.id);
  const latest = reuseExisting ? pickLatestTopic(topics ?? []) : undefined;
  if (latest) return navigate(getProjectTopicPath(directory.projectId, latest.id));

  const { data: project } = await projectService.find(directory.projectId);
  const agentId = project?.coordinatorAgentId;
  if (!agentId) {
    console.warn(`[openDirectory] Project ${directory.projectId} has no coordinator agent`);
    navigate('/projects');
    return;
  }

  navigate(getProjectDraftPath(directory.projectId, agentId, directory.id));
};
