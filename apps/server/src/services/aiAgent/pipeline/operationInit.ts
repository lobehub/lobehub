import type { LobeChatDatabase } from '@lobechat/database';
import type { RequestTrigger } from '@lobechat/types';

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
import {
  type ApprovedToolEntry,
  buildApprovalResumeContext,
  type ClaimedApprovalResume,
} from './approvalResume';
import {
  type OperationPrepDeps,
  type OperationPrepResult,
  prepareOperation,
} from './operationPrep';
import { discoverTools, type ToolDiscoveryResult } from './toolDiscovery';
import type { RunAttachments } from './turnSetup';

/**
 * Everything the init stage reads that is NOT a live object: ids, flags and
 * already-resolved values. Plain JSON on purpose — an operation that defers its
 * init (LOBE-13745) has to carry this on its state through Redis and rebuild the
 * live half (models, services, the history loader) in the step-0 worker.
 *
 * Keep it that way: a `Date`, a `Buffer` or a model instance in here silently
 * degrades once the request round-trips as JSON. `buildOperationInitRequest` has
 * a test that holds the line.
 */
export interface OperationInitRequest {
  additionalPluginIds?: string[];
  agentSlug?: string | null;
  approvalOwnerAssistantId?: string;
  /** Narrowed from the claim: the entries there carry a `Date` that JSON would flatten. */
  approvedToolEntries: ApprovedToolEntry[];
  attachedFileIds?: string[];
  botContext?: InternalExecAgentParams['botContext'];
  botPlatformContext?: InternalExecAgentParams['botPlatformContext'];
  disabledPluginIds: string[];
  disableLocalSystem?: boolean;
  disableSelfFeedbackIntentTool?: boolean;
  disableTools?: boolean;
  discordContext?: InternalExecAgentParams['discordContext'];
  ephemeralUserMessage?: string;
  exclusivePluginIds?: string[];
  /** Mime types of the raw bot/IM uploads — the only thing discovery reads off them. */
  externalFileTypes?: string[];
  functionTools?: InternalExecAgentParams['functionTools'];
  globalMemoryEnabled: boolean;
  hasMentionedAgents: boolean;
  isFixedDeviceTarget: boolean;
  localDeviceId?: string;
  mentionedAgents?: InternalExecAgentParams['mentionedAgents'];
  operationId: string;
  parentMessageId?: string;
  requestedDeviceId?: string;
  requestTrigger?: RequestTrigger;
  resumeApproval?: InternalExecAgentParams['resumeApproval'];
  resumeApprovalPlugin?: Parameters<typeof buildApprovalResumeContext>[0]['resumeApprovalPlugin'];
  resumeApprovals?: InternalExecAgentParams['resumeApprovals'];
  resumeFromHistory: boolean;
  resumeToolResult?: InternalExecAgentParams['resumeToolResult'];
  runAttachments: RunAttachments;
  selectedToolIds?: string[];
  topicBoundDeviceId?: string | null;
}

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
 * Resolve everything an operation needs before it can take a step: the tool
 * surface, the message/context assembly, and the human decision that a resumed
 * approval turns into the first context.
 *
 * Runs on the send path today. It takes `(deps, ctx, request)` rather than
 * reading a service instance so the same call can be made from a step-0 worker
 * that rebuilt `deps` and `ctx` from the request — see LOBE-13745.
 */
export const runOperationInit = async (
  deps: OperationInitDeps,
  ctx: ExecRunContext,
  request: OperationInitRequest,
): Promise<OperationInitResult> => {
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
      botContext: request.botContext,
      disableLocalSystem: request.disableLocalSystem,
      disableSelfFeedbackIntentTool: request.disableSelfFeedbackIntentTool,
      disableTools: request.disableTools,
      disabledPluginIds: request.disabledPluginIds,
      discordContext: request.discordContext,
      exclusivePluginIds: request.exclusivePluginIds,
      externalFileTypes: request.externalFileTypes,
      functionTools: request.functionTools,
      globalMemoryEnabled: request.globalMemoryEnabled,
      hasMentionedAgents: request.hasMentionedAgents,
      isFixedDeviceTarget: request.isFixedDeviceTarget,
      loadHistoryMessages: deps.loadHistoryMessages,
      localDeviceId: request.localDeviceId,
      requestTrigger: request.requestTrigger,
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
      botPlatformContext: request.botPlatformContext,
      disabledPluginIds: request.disabledPluginIds,
      discovery,
      ephemeralUserMessage: request.ephemeralUserMessage,
      globalMemoryEnabled: request.globalMemoryEnabled,
      hasMentionedAgents: request.hasMentionedAgents,
      loadHistoryMessages: deps.loadHistoryMessages,
      mentionedAgents: request.mentionedAgents,
      operationId: request.operationId,
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
    operationId: request.operationId,
    parentMessageId: request.parentMessageId,
    resumeApproval: request.resumeApproval,
    resumeApprovalPlugin: request.resumeApprovalPlugin,
    resumeApprovals: request.resumeApprovals,
    resumeToolResult: request.resumeToolResult,
  });

  return { discovery, initialContext, prep };
};
