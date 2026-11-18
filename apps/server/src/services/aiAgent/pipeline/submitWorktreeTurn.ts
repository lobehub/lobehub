import type {
  ComposerUserMessage,
  FirstSendWorktree,
  WorkingDirConfig,
  WorktreeStartRun,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { DeviceModel } from '@/database/models/device';
import { MessageModel } from '@/database/models/message';
import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';
import { TopicModel } from '@/database/models/topic';
import { agentOperations } from '@/database/schemas/agentOperations';
import { issueWorktreeReceipt } from '@/server/services/worktreeCleanup/receipt';
import { toTitleText } from '@/utils/markdownToTxt';

import type { InternalExecAgentParams } from '../types';
import { type PrecreatedTopicDeps, resolvePrecreatedTopicSnapshot } from './precreatedTopic';
import { resolveTurnProjectId } from './topicProject';

export interface SubmitWorktreeTurnInput {
  agentId: string;
  assistantMessageId: string;
  fileIds?: string[];
  mentionedAgents?: InternalExecAgentParams['mentionedAgents'];
  projectId?: string;
  projectWorkingDirectoryId?: string;
  prompt: string;
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  topicId: string;
  userInterventionConfig?: InternalExecAgentParams['userInterventionConfig'];
  userMessage?: ComposerUserMessage;
  userMessageId: string;
  worktree: FirstSendWorktree;
}

export type WorktreeTurnJob = Pick<
  SubmitWorktreeTurnInput,
  | 'assistantMessageId'
  | 'fileIds'
  | 'mentionedAgents'
  | 'selectedSkillIds'
  | 'selectedToolIds'
  | 'userInterventionConfig'
> & {
  checkout?: WorkingDirConfig;
  deviceWorkspaceId?: string;
  userMessageId: string;
  worktree: FirstSendWorktree & { branch?: string; ownerNonce?: string; ownerToken?: string };
};

/** Persist the conversation, first message and dispatch reservation together. */
export const submitWorktreeTurn = async (
  deps: PrecreatedTopicDeps,
  input: SubmitWorktreeTurnInput,
) => {
  const { db, userId, workspaceId } = deps;
  const { agentId, fileIds, prompt, topicId, userMessage, userMessageId, worktree } = input;
  let deviceWorkspaceId: string | undefined;
  if (workspaceId) {
    const devices = new DeviceModel(db, userId, workspaceId);
    if (await devices.findWorkspaceDeviceById(worktree.deviceId)) deviceWorkspaceId = workspaceId;
    else if (!(await devices.findPersonalByDeviceId(worktree.deviceId)))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found.' });
  }
  const { agentConfig, snapshot } = await resolvePrecreatedTopicSnapshot(deps, agentId);
  const config = agentConfig.agencyConfig;
  if (config?.heterogeneousProvider?.authMode === 'api') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This agent uses a provider binding that requires local Desktop execution.',
    });
  }
  const directory = input.projectWorkingDirectoryId
    ? await new ProjectWorkingDirectoryModel(db, userId, workspaceId).resolve(
        input.projectWorkingDirectoryId,
      )
    : undefined;
  if (directory && directory.deviceId !== worktree.deviceId)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The worktree must use the project directory’s device.',
    });
  const projectId = await resolveTurnProjectId(deps, {
    directoryProjectId: directory?.projectId,
    requestedProjectId: input.projectId,
  });
  if (
    config?.executionTargetSelectionPolicy === 'fixed' &&
    (config.executionTarget !== 'device' || config.boundDeviceId !== worktree.deviceId)
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The agent is fixed to another execution target.',
    });
  }

  const now = new Date();
  const at = now.toISOString();
  const operationId = `op_worktree_${topicId}`;
  const scheduledRun: WorktreeStartRun = {
    createdAt: at,
    kind: 'worktree_start',
    operationId,
    runAt: at,
    updatedAt: at,
    userMessageId,
  };
  const receipt = issueWorktreeReceipt(userId);
  const job: WorktreeTurnJob = {
    assistantMessageId: input.assistantMessageId,
    deviceWorkspaceId,
    fileIds,
    mentionedAgents: input.mentionedAgents,
    selectedSkillIds: input.selectedSkillIds,
    selectedToolIds: input.selectedToolIds,
    userInterventionConfig: input.userInterventionConfig,
    userMessageId,
    worktree: {
      ...worktree,
      ownerNonce: receipt?.nonce,
      ownerToken: receipt?.token,
    },
  };
  const title = toTitleText(prompt).slice(0, 50);

  return db.transaction(async (tx) => {
    // The client keeps these ids when retrying an ambiguous HTTP response.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${operationId}))`);
    const topics = new TopicModel(tx, userId, workspaceId);
    const messages = new MessageModel(tx, userId, workspaceId);
    const existing = await topics.findOwnTopicById(topicId);
    if (existing) {
      const persisted = await messages.findById(userMessageId);
      if (
        persisted?.topicId !== topicId ||
        existing.agentId !== agentId ||
        existing.userId !== userId
      )
        throw new TRPCError({ code: 'CONFLICT', message: 'This conversation already exists.' });
      return { topic: existing, userMessageId };
    }

    const topic = await topics.create(
      {
        ...snapshot,
        agentId,
        metadata: {
          ...snapshot.metadata,
          boundDeviceId: worktree.deviceId,
          deviceBindingPinned: true,
          scheduledRun,
        },
        projectId,
        projectWorkingDirectoryId: directory?.id,
        status: 'scheduled',
        title,
        trigger: RequestTrigger.Chat,
      },
      topicId,
    );
    await messages.create(
      {
        agentId,
        content: prompt,
        editorData: userMessage?.editorData,
        files: fileIds,
        metadata: { ...userMessage?.metadata, trigger: RequestTrigger.Chat },
        role: 'user',
        topicId,
      },
      userMessageId,
    );
    await tx.insert(agentOperations).values({
      agentId,
      id: operationId,
      metadata: { firstSendWorktree: job },
      status: 'idle',
      topicId,
      trigger: RequestTrigger.Chat,
      userId,
      workspaceId,
    });
    return { topic, userMessageId };
  });
};
