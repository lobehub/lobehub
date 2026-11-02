import type { InternalExecAgentParams } from '../types';
import { pickSandboxPlacement } from './sandboxPlacement';

export interface NewTopicMetadataInput {
  appContext?: InternalExecAgentParams['appContext'];
  botContext?: InternalExecAgentParams['botContext'];
  cronJobId?: string;
  /** The bound device was chosen explicitly for this conversation, not auto-picked. */
  deviceBindingPinned?: boolean;
  editingAgentId?: string;
  /** Working directory the topic is born in; overrides the client-supplied one. */
  projectDirectory?: { path: string };
  taskId?: string;
  topicBoundDeviceId?: string;
}

/**
 * Metadata a NEW topic is written with: cronJobId, taskId, botContext, bound
 * device, and any client-supplied initial metadata (e.g. repos selected before
 * the first message). Returns undefined when there is nothing to record.
 *
 * Deliberately untyped: `taskId` is a durable key the topic schema type does
 * not declare, so the caller merges the result into `ChatTopicMetadata`.
 */
export const buildNewTopicMetadata = ({
  appContext,
  botContext,
  cronJobId,
  deviceBindingPinned,
  editingAgentId,
  projectDirectory,
  taskId,
  topicBoundDeviceId,
}: NewTopicMetadataInput) => {
  const initialTopicMeta = projectDirectory
    ? {
        ...appContext?.initialTopicMetadata,
        workingDirectory: projectDirectory.path,
        workingDirectoryConfig: { path: projectDirectory.path },
      }
    : appContext?.initialTopicMetadata;
  // Builder conversations are owned by a builtin builder agent and get no
  // `groupId` / `sessionId` (those columns mark the target's own chat), so
  // without this the row keeps no trace of what it was configuring. The
  // association exists only at run time: a topic written without it can
  // never be attributed afterwards, which is why it is stamped even though
  // nothing filters on it yet.
  const { editingGroupId } = appContext ?? {};
  if (
    !cronJobId &&
    !taskId &&
    !botContext &&
    !topicBoundDeviceId &&
    !initialTopicMeta &&
    !editingGroupId &&
    !editingAgentId
  )
    return;

  return {
    bot: botContext,
    boundDeviceId: topicBoundDeviceId,
    cronJobId: cronJobId || undefined,
    ...(deviceBindingPinned && { deviceBindingPinned }),
    ...(editingAgentId && { editingAgentId }),
    ...(editingGroupId && { editingGroupId }),
    taskId,
    ...(initialTopicMeta?.repos && { repos: initialTopicMeta.repos }),
    ...pickSandboxPlacement(initialTopicMeta),
    ...(initialTopicMeta?.workingDirectory && {
      workingDirectory: initialTopicMeta.workingDirectory,
    }),
    ...(initialTopicMeta?.workingDirectoryConfig && {
      workingDirectoryConfig: initialTopicMeta.workingDirectoryConfig,
    }),
  };
};
