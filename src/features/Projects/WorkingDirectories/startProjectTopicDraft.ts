import { useChatStore } from '@/store/chat';

import { getProjectDraftPath } from '../Layout/navigation';

interface RunnableDirectoryLike {
  environmentId?: string | null;
  instanceId?: string | null;
  permission?: string | null;
}

/**
 * Whether a blank conversation may be staged on this directory: it needs a
 * linked environment instance and write access — the same rule the send
 * preflight and the composer's device switcher apply. A blank draft has no
 * topic for that preflight to check, so a "+" must only pick such a directory.
 */
export const isRunnableProjectDirectory = (directory: RunnableDirectoryLike) =>
  !!directory.instanceId && !!directory.environmentId && directory.permission === 'readWrite';

/**
 * A runnable directory the draft's agent may also run in: an agent fixed to
 * one device is refused anywhere else, so its draft must stay on that device —
 * and one fixed to a non-device target (e.g. a sandbox) can't use any.
 */
export const canStageDraftOn = (
  directory: RunnableDirectoryLike & { deviceId?: string | null },
  /** Undefined: not fixed. Null: fixed to a target that is not a device. */
  fixedDeviceId?: string | null,
) =>
  isRunnableProjectDirectory(directory) &&
  (fixedDeviceId === undefined || (!!fixedDeviceId && directory.deviceId === fixedDeviceId));

/**
 * Open a blank project conversation, the same habit as an agent's "+": no
 * topic row is created here. A staged directory pins the agent and device for
 * the composer; without one the project alone is staged. Either way the first
 * message creates the topic inside it (see `pendingNewTopicDirectory`).
 */
export const startProjectTopicDraft = ({
  agentId,
  directoryId,
  navigate,
  projectId,
}: {
  agentId: string;
  /** Omitted when the agent has no directory it can run in: conversation-only. */
  directoryId?: string;
  navigate: (path: string) => void;
  projectId: string;
}) => {
  const chat = useChatStore.getState();
  // Clean the target agent's blank bucket, not the view the "+" was clicked
  // from — the draft is that agent's conversation.
  chat.switchTopic(null, {
    clearNewKeyContext: { agentId, groupId: null },
    skipRefreshMessage: true,
  });
  chat.setPendingNewTopicDirectory(
    directoryId ? { agentId, projectWorkingDirectoryId: directoryId } : { agentId, projectId },
  );
  navigate(getProjectDraftPath(projectId, agentId, directoryId));
};
