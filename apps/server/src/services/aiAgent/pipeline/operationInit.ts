import type { LobeChatDatabase } from '@lobechat/database';
import type { AgentRunInitRequest, RequestTrigger } from '@lobechat/types';

import type { AgentModel } from '@/database/models/agent';
import type { ConnectorModel } from '@/database/models/connector';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { MessageModel } from '@/database/models/message';
import type { PluginModel } from '@/database/models/plugin';
import type { TopicModel } from '@/database/models/topic';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import type { ComposioService } from '@/server/services/composio';
import type { MarketService } from '@/server/services/market';

import type { ExecRunContext, InternalExecAgentParams } from '../types';
import { buildApprovalResumeContext, type ClaimedApprovalResume } from './approvalResume';
import {
  type OperationPrepDeps,
  type OperationPrepResult,
  prepareOperation,
} from './operationPrep';
import { discoverTools, type ToolDiscoveryResult } from './toolDiscovery';

/**
 * The turn's raw ask. Declared in `@lobechat/types` because it is also the shape
 * of `AgentState.request`: a run whose init is deferred carries it there until
 * the step-0 worker consumes it.
 */
export type OperationInitRequest = AgentRunInitRequest;

/** The live half: models, services and the two loaders the stages call back into. */
export interface OperationInitDeps {
  agentDocumentsService: AgentDocumentsService;
  agentModel: AgentModel;
  /** Same contract `prepareOperation` calls with — `{ config, currentWorkingDirectory, topicId }`. */
  bindTopicWorkingDirectory: OperationPrepDeps['bindTopicWorkingDirectory'];
  composioService: ComposioService;
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
  db: LobeChatDatabase;
  getMarketService: () => Promise<MarketService>;
  /** Shared lazy loader — tool discovery probes media availability, prep assembles messages. */
  loadHistoryMessages: () => Promise<any[]>;
  messageModel: MessageModel;
  pluginModel: PluginModel;
  /**
   * The parsed body of an attachment, read back from the documents table. Only
   * called for the ids a persisted request detached — see
   * `toPersistedInitRequest`.
   */
  readFileContent: (fileId: string) => Promise<string | undefined>;
  throwIfExecutionAborted: (stage: string) => Promise<void>;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}

export interface OperationInitResult {
  discovery: ToolDiscoveryResult;
  /** Prep's runtime context with the human approval decision applied. */
  initialContext: OperationPrepResult['initialContext'];
  prep: OperationPrepResult;
}

/**
 * Collect the init stage's serializable inputs in one place, so the caller can
 * hand the same request to a synchronous init or (later) persist it for a
 * deferred one.
 */
export const buildOperationInitRequest = (
  input: Omit<OperationInitRequest, 'approvedToolEntries' | 'externalFileTypes'> & {
    /** The claim's entries, `createdAt` and all — dropped here. */
    approvedToolEntries: ClaimedApprovalResume['approvedToolEntries'];
    files?: InternalExecAgentParams['files'];
  },
): OperationInitRequest => {
  const { approvedToolEntries, files, ...rest } = input;
  return {
    ...rest,
    // Keep only what the resume context reads. The claim orders the batch by
    // `createdAt`, a `Date` that JSON would turn into a string — and this
    // request has to survive that round trip byte for byte.
    approvedToolEntries: approvedToolEntries.map(({ plugin, toolMessageId }) => ({
      plugin,
      toolMessageId,
    })),
    ...(files && { externalFileTypes: files.map((file) => file.mimeType ?? '') }),
  };
};

/**
 * The request as it may be written to the operation state: parsed attachment
 * bodies stay in the documents table and only their ids travel. The state is a
 * single Redis write with a hard size ceiling, and a supported attachment can
 * parse to tens of MB on its own.
 */
export const toPersistedInitRequest = (request: OperationInitRequest): OperationInitRequest => {
  const fileList = request.runAttachments.fileList;
  const detached = (fileList ?? []).filter((file) => file.content !== undefined).map((f) => f.id);
  if (detached.length === 0) return request;
  return {
    ...request,
    detachedFileContentIds: detached,
    runAttachments: {
      ...request.runAttachments,
      fileList: fileList?.map(({ content: _content, ...file }) => file),
    },
  };
};

/**
 * Put back the bodies `toPersistedInitRequest` detached. Only those ids are
 * read: a file whose parse failed at turn setup has no body on purpose, and must
 * not be re-parsed here.
 */
export const rehydrateDetachedFileContent = async (
  request: OperationInitRequest,
  readFileContent: OperationInitDeps['readFileContent'],
): Promise<OperationInitRequest> => {
  const detached = new Set(request.detachedFileContentIds ?? []);
  if (detached.size === 0 || !request.runAttachments.fileList) return request;
  const fileList = await Promise.all(
    request.runAttachments.fileList.map(async (file) =>
      detached.has(file.id) ? { ...file, content: await readFileContent(file.id) } : file,
    ),
  );
  const { detachedFileContentIds: _ids, ...rest } = request;
  return { ...rest, runAttachments: { ...request.runAttachments, fileList } };
};

/**
 * Resolve everything an operation needs before it can take a step: the tool
 * surface, the message/context assembly, and the human decision that a resumed
 * approval turns into the first context.
 *
 * Runs on the send path today. It takes `(deps, ctx, request)` rather than
 * reading a service instance so the same call can be made from a step-0 worker
 * that rebuilt `deps` and `ctx` from the request.
 */
export const runOperationInit = async (
  deps: OperationInitDeps,
  ctx: ExecRunContext,
  request: OperationInitRequest,
  operationId: string,
): Promise<OperationInitResult> => {
  request = await rehydrateDetachedFileContent(request, deps.readFileContent);

  // Stage 5 (5a–5f) — tool discovery (see `pipeline/toolDiscovery`).
  const discovery = await discoverTools(
    {
      agentDocumentsService: deps.agentDocumentsService,
      composioService: deps.composioService,
      connectorModel: deps.connectorModel,
      connectorToolModel: deps.connectorToolModel,
      db: deps.db,
      getMarketService: deps.getMarketService,
      messageModel: deps.messageModel,
      pluginModel: deps.pluginModel,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    },
    ctx,
    {
      additionalPluginIds: request.additionalPluginIds,
      agentSlug: request.agentSlug,
      attachedFileIds: request.attachedFileIds,
      botContext: ctx.botContext,
      disableLocalSystem: request.disableLocalSystem,
      disableSelfFeedbackIntentTool: request.disableSelfFeedbackIntentTool,
      disableTools: request.disableTools,
      disabledPluginIds: ctx.disabledPluginIds,
      discordContext: ctx.discordContext,
      exclusivePluginIds: request.exclusivePluginIds,
      externalFileTypes: request.externalFileTypes,
      functionTools: request.functionTools,
      globalMemoryEnabled: request.globalMemoryEnabled,
      hasMentionedAgents: request.hasMentionedAgents,
      isFixedDeviceTarget: request.isFixedDeviceTarget,
      loadHistoryMessages: deps.loadHistoryMessages,
      localDeviceId: request.localDeviceId,
      requestTrigger: request.requestTrigger as RequestTrigger | undefined,
      requestedDeviceId: request.requestedDeviceId,
      selectedToolIds: request.selectedToolIds,
      throwIfExecutionAborted: deps.throwIfExecutionAborted,
      topicBoundDeviceId: request.topicBoundDeviceId,
    },
  );

  // Stages 9.4–18 — device system info, agent-management context, persona
  // memory, history + message assembly, the base initial runtime context,
  // workspace init, the OperationSkillSet, and the expertise snapshot
  // (see `pipeline/operationPrep`).
  const prep = await prepareOperation(
    {
      agentDocumentsService: deps.agentDocumentsService,
      agentModel: deps.agentModel,
      bindTopicWorkingDirectory: deps.bindTopicWorkingDirectory,
      db: deps.db,
      topicModel: deps.topicModel,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    },
    ctx,
    {
      botPlatformContext: ctx.botPlatformContext,
      disabledPluginIds: ctx.disabledPluginIds,
      discovery,
      ephemeralUserMessage: request.ephemeralUserMessage,
      globalMemoryEnabled: request.globalMemoryEnabled,
      hasMentionedAgents: request.hasMentionedAgents,
      loadHistoryMessages: deps.loadHistoryMessages,
      mentionedAgents: request.mentionedAgents,
      operationId,
      runAttachments: request.runAttachments,
      runFromHistory: request.resumeFromHistory,
      throwIfExecutionAborted: deps.throwIfExecutionAborted,
    },
  );

  // 16b/16c — override the initial context with the human decision
  // (see `pipeline/approvalResume`). Pure; no-op on a fresh send.
  const initialContext = buildApprovalResumeContext({
    approvalOwnerAssistantId: request.approvalOwnerAssistantId,
    approvedToolEntries: request.approvedToolEntries,
    assistantMessageId: ctx.assistantMessageId,
    initialContext: prep.initialContext,
    messageCount: prep.allMessages.length,
    operationId,
    parentMessageId: request.parentMessageId,
    resumeApproval: request.resumeApproval,
    resumeApprovalPlugin: request.resumeApprovalPlugin,
    resumeApprovals: request.resumeApprovals,
    resumeToolResult: request.resumeToolResult,
  });

  return { discovery, initialContext, prep };
};
