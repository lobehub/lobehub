import type { TopicOpenedBy, WorkingDirConfig } from '@lobechat/types';
import { normalizeDirectoryPath } from '@lobechat/types';

import type { TopicModel } from '@/database/models/topic';

import type { InternalExecAgentParams } from '../types';
import { pickSandboxPlacement } from './sandboxPlacement';

export interface NewTopicMetadataInput {
  appContext?: InternalExecAgentParams['appContext'];
  botContext?: InternalExecAgentParams['botContext'];
  cronJobId?: string;
  /** The bound device was chosen explicitly for this conversation, not auto-picked. */
  deviceBindingPinned?: boolean;
  editingAgentId?: string;
  /** The topic this one was opened from (a sub-topic); see `resolveTopicOpenedBy`. */
  openedBy?: TopicOpenedBy;
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
  openedBy,
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
    !openedBy &&
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
    ...(openedBy && { openedBy }),
    taskId,
    ...(webhookThread && { webhook: webhookThread }),
    // Claude Code permission mode the composer chip showed (Better Coding Experience).
    ...(initialTopicMeta?.heteroPermissionMode && {
      heteroPermissionMode: initialTopicMeta.heteroPermissionMode,
    }),
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

/**
 * The `metadata.openedBy` link of a topic opened from `openerTopicId`. The
 * opener is read through the caller's own topic scope, so a stale, foreign or
 * mistyped id (an env var a long-lived shell kept) records no link rather than
 * failing a run that is otherwise valid.
 */
export const resolveTopicOpenedBy = async (
  topicModel: Pick<TopicModel, 'findById'>,
  openerTopicId: string | undefined,
): Promise<TopicOpenedBy | undefined> => {
  if (!openerTopicId) return;
  const opener = await topicModel.findById(openerTopicId).catch(() => undefined);
  if (!opener) return;

  return {
    agentId: opener.agentId ?? undefined,
    at: new Date().toISOString(),
    topicId: opener.id,
  };
};
