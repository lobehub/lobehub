import type { WorkingDirConfig } from '@lobechat/types';
import { normalizeDirectoryPath } from '@lobechat/types';

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
  webhookThread?: InternalExecAgentParams['webhookThread'];
}

/**
 * The worktree the composer created for this topic on its first send
 * (Better Coding Experience "New worktree"), when it was cut from the project
 * directory the topic is born in. The project directory still names the
 * source; the worktree is where the topic runs, so it must survive the
 * project override below.
 */
const preparedProjectWorktree = (
  supplied: WorkingDirConfig | undefined,
  projectPath: string,
): WorkingDirConfig | undefined =>
  supplied?.git?.autoCreated &&
  supplied.git.activeWorktree &&
  normalizeDirectoryPath(supplied.path) === normalizeDirectoryPath(projectPath)
    ? supplied
    : undefined;

/**
 * Metadata a NEW topic is written with: cronJobId, taskId, botContext, the
 * generic webhook thread, bound device, and any client-supplied initial metadata (e.g. repos selected before
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
  webhookThread,
}: NewTopicMetadataInput) => {
  const preparedWorktree = projectDirectory
    ? preparedProjectWorktree(
        appContext?.initialTopicMetadata?.workingDirectoryConfig,
        projectDirectory.path,
      )
    : undefined;
  const initialTopicMeta = projectDirectory
    ? {
        ...appContext?.initialTopicMetadata,
        workingDirectory: preparedWorktree?.git?.activeWorktree ?? projectDirectory.path,
        workingDirectoryConfig: preparedWorktree
          ? { ...preparedWorktree, path: projectDirectory.path }
          : { path: projectDirectory.path },
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
    !editingAgentId &&
    !webhookThread
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
    ...(webhookThread && { webhook: webhookThread }),
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
