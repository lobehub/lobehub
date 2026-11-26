'use client';

import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { useTopicId } from '../hooks/useTopicId';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import ProjectDeviceSwitcher from './ProjectDeviceSwitcher';
import { type ProjectDeviceTarget } from './projectDeviceTargets';
import {
  useActiveProjectDirectoryTopicId,
  useProjectTopicDirectory,
  useStagedProjectDirectory,
  useStagedProjectDirectoryId,
} from './useProjectTopicDirectory';

interface DeviceSwitcherProps {
  agentId: string;
}

/** A project-directory topic moves to another device's directory once confirmed. */
const ProjectTopicDeviceSwitcher = ({ agentId, topicId }: { agentId: string; topicId: string }) => {
  const { t } = useTranslation('chat');
  const { directories, directoryId } = useProjectTopicDirectory(topicId);
  const moveTopic = useProjectDirectoryStore((s) => s.moveTopic);
  const refreshTopic = useChatStore((s) => s.refreshTopic);

  const handleSelect = ({ directory, label }: ProjectDeviceTarget) => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('heteroAgent.executionTarget.switchProjectTopic.content', {
        device: label,
        directory: directory.name,
      }),
      okText: t('heteroAgent.executionTarget.switchTopic.ok'),
      onOk: async () => {
        try {
          await moveTopic({ directoryId: directory.id, topicId });
          await refreshTopic();
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      title: t('heteroAgent.executionTarget.switchTopic.title'),
    });
  };

  return (
    <ProjectDeviceSwitcher
      activeTag={t('heteroAgent.executionTarget.topicTag')}
      agentId={agentId}
      directories={directories}
      directoryId={directoryId}
      // A conversation bound to a folder keeps a folder: moving it to the
      // sandbox is not something a started conversation can do.
      sandbox={{ active: false }}
      onSelect={handleSelect}
    />
  );
};

/** The project a conversation without a folder belongs to: its topic's, or its blank draft's. */
const useProjectWithoutFolder = (agentId: string) => {
  const topicId = useTopicId();
  const topicProjectId = useChatStore((s) => {
    if (!topicId) return undefined;
    const topic = topicSelectors.getTopicById(topicId)(s);
    return topic?.projectId && !topic.projectWorkingDirectoryId ? topic.projectId : undefined;
  });
  const draftProjectId = useChatStore((s) => {
    const pending = s.pendingNewTopicDirectory;
    return !topicId && pending?.agentId === agentId && 'projectId' in pending
      ? pending.projectId
      : undefined;
  });
  if (topicProjectId) return { projectId: topicProjectId, started: true };
  if (draftProjectId) return { projectId: draftProjectId, started: false };
  return undefined;
};

/**
 * A project conversation in the cloud sandbox. A blank one can still move to
 * one of the project's folders — it is only restaged there — while a started
 * one stays in the sandbox it began in.
 */
const ProjectSandboxSwitcher = ({
  agentId,
  projectId,
  started,
}: {
  agentId: string;
  projectId: string;
  started: boolean;
}) => {
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const directories = useProjectDirectories(projectId);

  return (
    <ProjectDeviceSwitcher
      agentId={agentId}
      directories={directories}
      projectId={projectId}
      sandbox={{ active: true }}
      onSelect={
        started
          ? undefined
          : ({ directory }) =>
              useChatStore
                .getState()
                .setPendingNewTopicDirectory({ agentId, projectWorkingDirectoryId: directory.id })
      }
    />
  );
};

/**
 * A blank conversation staged in a project directory has nothing persisted
 * yet, so switching devices just restages it in that device's directory.
 */
const StagedProjectDeviceSwitcher = ({ agentId }: { agentId: string }) => {
  const { directories, directoryId } = useStagedProjectDirectory(agentId);
  const selectExecutionTarget = useSelectExecutionTarget(agentId);
  const projectId = directories.find((d) => d.id === directoryId)?.projectId;

  return (
    <ProjectDeviceSwitcher
      agentId={agentId}
      directories={directories}
      directoryId={directoryId}
      projectId={projectId}
      sandbox={{
        active: false,
        // Restaged on the project alone, in the cloud sandbox: the first send
        // starts it there with the project's environment.
        onSelect: projectId
          ? () => {
              useChatStore.getState().setPendingNewTopicDirectory({ agentId, projectId });
              void selectExecutionTarget('sandbox');
            }
          : undefined,
      }}
      onSelect={({ directory }) =>
        useChatStore
          .getState()
          .setPendingNewTopicDirectory({ agentId, projectWorkingDirectoryId: directory.id })
      }
    />
  );
};

/**
 * The execution-device control for whichever conversation is open. A project
 * conversation — in one of its folders or in the cloud sandbox, started or
 * still blank — only chooses among the project's own execution environments;
 * everything else gets the general execution-target picker. Every bar that shows a device control mounts this,
 * so no surface can fall back to the general picker for a project topic.
 */
const DeviceSwitcher = ({ agentId }: DeviceSwitcherProps) => {
  const projectTopicId = useActiveProjectDirectoryTopicId();
  const stagedDirectoryId = useStagedProjectDirectoryId(agentId);
  const sandboxProject = useProjectWithoutFolder(agentId);

  if (projectTopicId)
    return <ProjectTopicDeviceSwitcher agentId={agentId} topicId={projectTopicId} />;
  if (stagedDirectoryId) return <StagedProjectDeviceSwitcher agentId={agentId} />;
  if (sandboxProject)
    return (
      <ProjectSandboxSwitcher
        agentId={agentId}
        projectId={sandboxProject.projectId}
        started={sandboxProject.started}
      />
    );
  return <HeteroDeviceSwitcher agentId={agentId} />;
};

export default DeviceSwitcher;
