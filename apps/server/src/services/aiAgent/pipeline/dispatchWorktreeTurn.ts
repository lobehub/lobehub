import { generateWorktreeBranchName } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ExecAgentResult, WorktreeStartRun } from '@lobechat/types';
import { RequestTrigger, toComposerUserMessage } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { AiAgentService } from '@/server/services/aiAgent';
import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import { scheduleWorktreeCleanup } from '@/server/services/worktreeCleanup';

import { createFirstSendWorktree } from './createFirstSendWorktree';
import type { WorktreeTurnJob } from './submitWorktreeTurn';

/** Execute the saved first turn against its checkout, even when no client is connected. */
export const dispatchWorktreeTurn = async (
  run: WorktreeStartRun,
  {
    db,
    topic,
    workspaceId,
  }: {
    db: LobeChatDatabase;
    topic: { agentId: string | null; id: string; userId: string };
    workspaceId?: string;
  },
): Promise<{ error?: string; retryAt?: string; retryable?: boolean; success: boolean }> => {
  const { agentId, userId } = topic;
  const topics = new TopicModel(db, userId, workspaceId);
  const messages = new MessageModel(db, userId, workspaceId);
  const operations = new AgentOperationModel(db, userId, workspaceId);
  const [operation, message] = await Promise.all([
    operations.findById(run.operationId),
    messages.findById(run.userMessageId),
  ]);
  if (
    !agentId ||
    operation?.topicId !== topic.id ||
    operation.userId !== userId ||
    operation.agentId !== agentId ||
    message?.topicId !== topic.id ||
    message.role !== 'user' ||
    message.userId !== userId
  ) {
    return { error: 'The queued conversation or message no longer exists.', success: false };
  }
  // The reserved id is consumed by execAgent. A redelivered job must never
  // start a second turn after another worker has consumed that reservation.
  if (operation.status !== 'idle') {
    const succeeded =
      operation.status === 'done' || operation.metadata?.firstSendWorktreeHandedOff === true;
    return {
      error: succeeded
        ? undefined
        : (operation.error?.message ?? 'The queued turn could not be confirmed as dispatched.'),
      success: succeeded,
    };
  }
  let job = operation.metadata?.firstSendWorktree as WorktreeTurnJob | undefined;
  if (!job || job.userMessageId !== message.id)
    return { error: 'The worktree request no longer exists.', success: false };

  const { deviceId } = job.worktree;
  const deviceWorkspaceId = job.deviceWorkspaceId;
  try {
    await assertCanUseWorkspaceAgent({ agentId, db, userId, workspaceId });
  } catch (error) {
    console.error('[dispatchWorktreeTurn] execution permission changed', error);
    return { error: 'You can no longer use this agent.', success: false };
  }
  if (await resolveDeviceDispatchAuthorizationFailure(db, userId, deviceId, deviceWorkspaceId))
    return {
      error: 'The selected device is no longer available in this workspace.',
      success: false,
    };
  const devices = await getScopedOnlineDevices(db, userId, deviceWorkspaceId);
  if (!devices.some((device) => device.deviceId === deviceId && device.online))
    return { retryAt: new Date(Date.now() + 30_000).toISOString(), success: false };

  let workingDirectory = job.checkout;
  try {
    if (!workingDirectory) {
      const principal = { userId, workspaceId: deviceWorkspaceId };
      let branch = job.worktree.branch;
      if (!branch) {
        const refs = await deviceGateway.listGitBranches({
          ...principal,
          deviceId,
          path: job.worktree.path,
        });
        if (!refs) throw new Error('The device could not list the repository’s branches.');
        branch = generateWorktreeBranchName({
          exclude: refs.map(({ name }) => name),
          now: new Date(run.createdAt),
        });
        job = { ...job, worktree: { ...job.worktree, branch } };
        // Retrying a write with an ambiguous result must target the same checkout.
        const saved = await operations.mergeMetadata(operation.id, { firstSendWorktree: job });
        if (!saved) throw new Error('Could not save the branch for the queued worktree.');
      }
      workingDirectory = await createFirstSendWorktree({ ...job.worktree, branch }, principal);
    }
  } catch (error) {
    console.error('[dispatchWorktreeTurn] could not create worktree', error);
    return {
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
      success: false,
    };
  }

  const { canDispatch, cleanupTrigger } = await topics.recordFirstSendWorktreeCheckout(topic.id, {
    claimId: run.claim?.id,
    deviceId,
    workingDirectoryConfig: workingDirectory,
  });
  if (cleanupTrigger) {
    scheduleWorktreeCleanup({
      db,
      topicIds: [topic.id],
      trigger: cleanupTrigger,
      userId,
      workspaceId,
    });
  }
  if (!job.checkout)
    await operations.mergeMetadata(operation.id, {
      firstSendWorktree: { ...job, checkout: workingDirectory },
    });

  if (!canDispatch)
    return { error: 'The queued worktree turn lost its dispatch claim.', success: false };

  let result: ExecAgentResult;
  try {
    result = await new AiAgentService(db, userId, {
      withholdGatewayToken: true,
      workspaceId,
    }).execAgent({
      agentId,
      appContext: { topicId: topic.id },
      deviceId,
      fileIds: job.fileIds,
      mentionedAgents: job.mentionedAgents,
      markTopicRunning: true,
      parentMessageId: message.id,
      persistedUserMessageId: message.id,
      prompt: message.content ?? '',
      requireDevice: true,
      reservedAssistantMessageId: job.assistantMessageId,
      reservedOperationId: operation.id,
      selectedSkillIds: job.selectedSkillIds,
      selectedToolIds: job.selectedToolIds,
      suppressUserMessage: true,
      trigger: RequestTrigger.Chat,
      userInterventionConfig: job.userInterventionConfig,
      userMessage: toComposerUserMessage({
        editorData: message.editorData,
        metadata: message.metadata,
      }),
    });
  } catch (error) {
    const current = await operations.findById(operation.id);
    if (current?.status === 'done') return { success: true };
    const reason = error instanceof Error ? error.message : String(error);
    if (current?.status === 'running') {
      if (!(await operations.recordDispatchFailure(operation.id, reason))) throw error;
      await messages
        .update(job.assistantMessageId, {
          error: { message: reason, type: 'AgentRuntimeError' },
        })
        .catch((updateError) => {
          console.error(
            '[dispatchWorktreeTurn] could not update the failed assistant message',
            updateError,
          );
        });
    }
    return {
      error: reason,
      retryable: current?.status === 'idle',
      success: false,
    };
  }
  if (result.success)
    await operations.mergeMetadata(operation.id, { firstSendWorktreeHandedOff: true });
  return result;
};
