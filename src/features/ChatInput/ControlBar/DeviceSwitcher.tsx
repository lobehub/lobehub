'use client';

import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

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
      onSelect={handleSelect}
    />
  );
};

/**
 * A blank conversation staged in a project directory has nothing persisted
 * yet, so switching devices just restages it in that device's directory.
 */
const StagedProjectDeviceSwitcher = ({ agentId }: { agentId: string }) => {
  const { directories, directoryId } = useStagedProjectDirectory(agentId);

  return (
    <ProjectDeviceSwitcher
      agentId={agentId}
      directories={directories}
      directoryId={directoryId}
      onSelect={({ directory }) =>
        useChatStore
          .getState()
          .setPendingNewTopicDirectory({ agentId, projectWorkingDirectoryId: directory.id })
      }
    />
  );
};

/**
 * The execution-device control for whichever conversation is open. A
 * project-directory conversation — or a blank one a project group's "+"
 * staged in a directory — runs in its project's directory, so it only
 * chooses among the project's devices; everything else gets the general
 * execution-target picker. Every bar that shows a device control mounts this,
 * so no surface can fall back to the general picker for a project topic.
 */
const DeviceSwitcher = ({ agentId }: DeviceSwitcherProps) => {
  const projectTopicId = useActiveProjectDirectoryTopicId();
  const stagedDirectoryId = useStagedProjectDirectoryId(agentId);

  if (projectTopicId)
    return <ProjectTopicDeviceSwitcher agentId={agentId} topicId={projectTopicId} />;
  if (stagedDirectoryId) return <StagedProjectDeviceSwitcher agentId={agentId} />;
  return <HeteroDeviceSwitcher agentId={agentId} />;
};

export default DeviceSwitcher;
