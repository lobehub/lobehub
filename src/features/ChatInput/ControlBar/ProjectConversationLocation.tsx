'use client';

import { confirmModal, toast } from '@lobehub/ui';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import ProjectWorkLocationPicker from '@/features/Projects/Workspace/ProjectWorkLocationPicker';
import { directoriesOnDevice } from '@/features/Projects/Workspace/useProjectDirectory';
import {
  NO_ENVIRONMENT,
  useProjectRepository,
} from '@/features/Projects/Workspace/useProjectRepository';
import { useProjectWorkLocation } from '@/features/Projects/Workspace/useProjectWorkLocation';
import { SANDBOX_STORAGE_PATH } from '@/features/ResourceHome/paths';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import {
  getPendingSandboxSelection,
  subscribePendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { useTopicId } from '../hooks/useTopicId';
import type { SandboxDriveFolderPick } from './SandboxDriveMenu';
import { useIsSharedAgent } from './useSandboxEnvironmentList';
import { isPersistentSelection, useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';

/**
 * The project a composer's conversation belongs to: its topic's, or the one a
 * blank project conversation was opened in — by the project's "+", whether on
 * the project or in one of its folders. Undefined outside a project.
 */
export const useConversationProjectId = (agentId: string): string | undefined => {
  const topicId = useTopicId();
  const { projectId } = useSandboxPlacement(agentId, topicId);
  const stagedDirectoryId = useChatStore((s) =>
    !topicId && s.pendingNewTopicDirectory?.agentId === agentId
      ? s.pendingNewTopicDirectory.projectWorkingDirectoryId
      : undefined,
  );
  useProjectDirectoryStore((s) => s.useFetchDirectories)(undefined, !!stagedDirectoryId);
  const stagedProjectId = useProjectDirectoryStore((s) =>
    stagedDirectoryId
      ? Object.values(s.directoriesMap)
          .flat()
          .find((directory) => directory.id === stagedDirectoryId)?.projectId
      : undefined,
  );
  return projectId ?? stagedProjectId;
};

interface ProjectConversationLocationProps {
  agentId: string;
  projectId: string;
}

/**
 * Where a project conversation works, in the same picker the project home
 * offers before it starts: the cloud sandbox in one of the project's code
 * environments, or one of the project's folders on a device. Here it reads
 * and moves the open conversation — its environment, the machine it ran on
 * (moving off it is confirmed first) and its folder — or, before the first
 * message, the blank conversation staged for it.
 */
const ProjectConversationLocation = ({ agentId, projectId }: ProjectConversationLocationProps) => {
  const { t } = useTranslation('chat');
  const topicId = useTopicId();
  const sharedAgent = useIsSharedAgent(agentId);
  const canManage = useCanManageProject();
  const location = useProjectWorkLocation(agentId, topicId);

  // The code environment is the conversation's own pick, kept on it (or on the
  // pending selection before the first message).
  const { selection, setSelection } = useSandboxPlacement(agentId, topicId);
  const repositoryBase = useProjectRepository(projectId, sharedAgent);
  const pending = useSyncExternalStore(subscribePendingSandboxSelection, () =>
    getPendingSandboxSelection(agentId),
  );
  // A blank conversation nobody placed starts in the project's environment —
  // the server applies it — so it shows that one rather than none.
  const projectDefault = !topicId && !pending;
  const repository = projectDefault
    ? repositoryBase.repository
    : repositoryBase.repositories.find((item) => item.id === selection.environmentId);
  const onDrive = isPersistentSelection(selection);
  const withoutEnvironment = !repository && !onDrive;
  const repositoryState = {
    ...repositoryBase,
    repository,
    setPickedId: (environmentId: string) => {
      setSelection({
        environmentId: environmentId === NO_ENVIRONMENT ? undefined : environmentId,
      }).catch(() => toast.error(t('sandboxEnvironment.saveFailed')));
    },
    withoutEnvironment,
  };

  // The folder: the topic's binding, or the folder a blank conversation was staged in.
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const directories = useProjectDirectories(projectId);
  const directoryId = useChatStore((s) =>
    topicId
      ? (topicSelectors.getTopicById(topicId)(s)?.projectWorkingDirectoryId ?? undefined)
      : s.pendingNewTopicDirectory?.agentId === agentId
        ? s.pendingNewTopicDirectory.projectWorkingDirectoryId
        : undefined,
  );
  const directory = directories.find((item) => item.id === directoryId);
  const directoryState = {
    directory,
    directoriesOn: (deviceId: string) => directoriesOnDevice(directories, deviceId),
    setPickedId: () => {},
  };

  // The drive: offered when the plan includes one. A folder on it is the
  // persistent sandbox — the conversation keeps its files there — and takes
  // the place of the environment, which only a temporary sandbox clones.
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId();
  const { status: driveStatus } = useSandboxStorageAccess(agentId);
  const pickDriveFolder = async (folder: SandboxDriveFolderPick) => {
    try {
      await setSelection({ drive: folder.drive, workingDirectory: folder.workingDirectory });
      if (location.target !== 'sandbox') await location.select('sandbox');
    } catch {
      toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
    }
  };
  const driveLabel =
    onDrive && selection.workingDirectory !== undefined
      ? selection.workingDirectory === '.'
        ? t('sandboxDrive.root')
        : selection.workingDirectory.split('/').pop() || selection.workingDirectory
      : undefined;
  const drive =
    driveStatus === 'ready'
      ? {
          label: driveLabel,
          onBrowse: () =>
            openSandboxDirectoryModal({
              defaultPath:
                selection.workingDirectory && selection.workingDirectory !== '.'
                  ? selection.workingDirectory
                  : undefined,
              drive: selection.drive,
              isWorkspace: !!workspaceId,
              onPick: pickDriveFolder,
            }),
          onOpenStorage: () => navigate(SANDBOX_STORAGE_PATH),
          onPick: (folder: SandboxDriveFolderPick) => void pickDriveFolder(folder),
          selectedPath: onDrive ? selection.workingDirectory : undefined,
        }
      : undefined;

  const moveTopic = useProjectDirectoryStore((s) => s.moveTopic);
  const refreshTopic = useChatStore((s) => s.refreshTopic);
  const pickDirectory = (nextId: string) => {
    if (nextId === directoryId) return;
    const next = directories.find((item) => item.id === nextId);
    if (!next) return;
    if (!topicId) {
      useChatStore
        .getState()
        .setPendingNewTopicDirectory({ agentId, projectWorkingDirectoryId: nextId });
      return;
    }
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('heteroAgent.executionTarget.switchProjectTopic.content', {
        device: next.deviceName || next.deviceId,
        directory: next.name,
      }),
      okText: t('heteroAgent.executionTarget.switchTopic.ok'),
      onOk: async () => {
        try {
          await moveTopic({ directoryId: nextId, topicId });
          await refreshTopic();
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      title: t('heteroAgent.executionTarget.switchTopic.title'),
    });
  };

  return (
    <ProjectWorkLocationPicker
      align={'left'}
      canManage={canManage}
      directoryState={directoryState}
      drive={drive}
      location={location}
      projectId={projectId}
      state={repositoryState}
      onPickDirectory={pickDirectory}
    />
  );
};

export default ProjectConversationLocation;
