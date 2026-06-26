import type {
  CallSubAgentParams,
  VisualFileItem,
  VisualSourceMessage,
} from '@lobechat/builtin-tool-lobe-agent';
import {
  buildAnalyzeVisualMediaContent,
  createUrlVisualFileItems,
  createVisualFileItems,
  formatVisualMediaUrlValidationError,
  hasUserVisualFiles,
  LobeAgentIdentifier,
  normalizeAnalyzeVisualMediaInput,
  PlanExecutionRuntime,
  selectVisualFileItems,
  validateVisualMediaUrls,
} from '@lobechat/builtin-tool-lobe-agent';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { toolsEnv } from '@/envs/tools';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

import type { ToolExecutionContext } from '../types';
import { createServerPlanRuntimeService } from './lobeAgentPlan';
import type { ServerRuntimeRegistration } from './types';

interface AnalyzeVisualMediaParams {
  question: string;
  refs?: string[];
  urls?: string[];
}

interface LobeAgentRuntimeContext {
  agentId?: string | null;
  groupId?: string | null;
  messageId: string;
  /** The current Agent Run (`agent_operations.id`). */
  operationId?: string;
  serverDB: LobeChatDatabase;
  threadId?: string | null;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

const buildError = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

const getModelAbilities = async (model: string, provider: string) => {
  const { loadModels } = await import('@/business/client/model-bank/loadModels');
  const builtinModels = await loadModels();

  return (
    builtinModels.find((item) => item.id === model && item.providerId === provider) ??
    builtinModels.find((item) => item.id === model)
  )?.abilities;
};

interface ServerVisualSourceMessage extends VisualSourceMessage {
  agentId?: string | null;
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}

class LobeAgentExecutionRuntime {
  private agentId?: string | null;
  private db: LobeChatDatabase;
  private groupId?: string | null;
  private userId: string;
  private messageId: string;
  private operationId?: string;
  private threadId?: string | null;
  private topicId?: string;
  private planRuntime: PlanExecutionRuntime;
  private workspaceId?: string;

  constructor(context: LobeAgentRuntimeContext) {
    this.agentId = context.agentId;
    this.db = context.serverDB;
    this.groupId = context.groupId;
    this.messageId = context.messageId;
    this.operationId = context.operationId;
    this.threadId = context.threadId;
    this.topicId = context.topicId;
    this.userId = context.userId;
    this.workspaceId = context.workspaceId;
    this.planRuntime = new PlanExecutionRuntime(
      createServerPlanRuntimeService(context.serverDB, context.userId, context.workspaceId),
    );
  }

  // ==================== Plan / Todo (delegated to PlanExecutionRuntime) ====================

  createPlan = (params: any) =>
    this.planRuntime.createPlan(params, { messageId: this.messageId, topicId: this.topicId });

  updatePlan = (params: any) =>
    this.planRuntime.updatePlan(params, { messageId: this.messageId, topicId: this.topicId });

  createTodos = (params: any) =>
    this.planRuntime.createTodos(params, { messageId: this.messageId, topicId: this.topicId });

  updateTodos = (params: any) =>
    this.planRuntime.updateTodos(params, { messageId: this.messageId, topicId: this.topicId });

  clearTodos = (params: any) =>
    this.planRuntime.clearTodos(params, { messageId: this.messageId, topicId: this.topicId });

  // ==================== Sub-agent (async suspend/resume) ====================

  /**
   * Fork a sub-agent as an independent async operation.
   *
   * Returns a `deferred` result instead of a tool_result: the agent runtime
   * parks the parent op (`waiting_for_async_tool`) until the sub-op finishes,
   * at which point the completion bridge backfills the placeholder tool message
   * and resumes the parent. The placeholder + child-op kickoff are handled by
   * the injected `ctx.subAgent` runner (which owns the parent message anchor).
   */
  callSubAgent = async (
    params: CallSubAgentParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (ctx.isSubAgent) {
      return buildError(
        'Sub-agent calls cannot be triggered from within another sub-agent.',
        'NESTED_SUB_AGENT_NOT_ALLOWED',
      );
    }

    if (!ctx.subAgent) {
      return buildError(
        'Sub-agent execution is not available in this runtime.',
        'SUB_AGENT_UNAVAILABLE',
      );
    }

    const { description, instruction, timeout } = params;
    if (!instruction || typeof instruction !== 'string') {
      return buildError('instruction is required.', 'INVALID_ARGUMENTS');
    }

    const { started, error, threadId, subOperationId } = await ctx.subAgent.run({
      description,
      instruction,
      timeout,
    });

    // The child op failed to start — no completion bridge will ever fire to
    // backfill a placeholder, so we must NOT defer/park here. Return a normal
    // (non-deferred) tool error so the parent's LLM sees the failure and the
    // batch continues instead of hanging in `waiting_for_async_tool`.
    if (!started) {
      return buildError(
        error ? `Sub-agent failed to start: ${error}` : 'Sub-agent failed to start.',
        'SUB_AGENT_START_FAILED',
      );
    }

    return {
      // No tool_result yet — the bridge fills this in when the sub-op completes.
      content: '',
      deferred: true,
      state: { status: 'pending', subOperationId, threadId },
      success: true,
    };
  };

  private queryScopeMessages = (
    messageModel: MessageModel,
    sourceMessage: ServerVisualSourceMessage,
    postProcessUrl: (
      path: string | null,
      file: { fileType: string; id?: string | null },
    ) => Promise<string>,
  ) => {
    const topicId = this.topicId ?? sourceMessage.topicId ?? undefined;
    const threadId = sourceMessage.threadId ?? this.threadId ?? undefined;
    const groupId = sourceMessage.groupId ?? this.groupId ?? undefined;
    const agentId = sourceMessage.agentId ?? this.agentId ?? undefined;
    const sessionId = sourceMessage.sessionId ?? undefined;

    if (threadId) {
      return messageModel.query({ threadId, topicId }, { postProcessUrl });
    }

    if (groupId) {
      return messageModel.query({ groupId, topicId }, { postProcessUrl });
    }

    if (agentId) {
      return messageModel.query({ agentId, topicId }, { postProcessUrl });
    }

    if (sessionId) {
      return messageModel.query({ sessionId, topicId }, { postProcessUrl });
    }

    if (topicId) {
      return messageModel.query({ topicId }, { postProcessUrl });
    }

    return Promise.resolve([sourceMessage]);
  };

  analyzeVisualMedia = async (
    params: AnalyzeVisualMediaParams,
  ): Promise<BuiltinServerRuntimeOutput> => {
    const provider = toolsEnv.VISUAL_UNDERSTANDING_PROVIDER;
    const model = toolsEnv.VISUAL_UNDERSTANDING_MODEL;

    if (!provider || !model) {
      return buildError(
        'Visual understanding is not configured. Set VISUAL_UNDERSTANDING_PROVIDER and VISUAL_UNDERSTANDING_MODEL.',
        'VISUAL_UNDERSTANDING_NOT_CONFIGURED',
      );
    }

    if (!params.question || typeof params.question !== 'string') {
      return buildError('question is required.', 'INVALID_ARGUMENTS');
    }

    const { requestedRefs, requestedUrls } = normalizeAnalyzeVisualMediaInput(
      params as unknown as Record<PropertyKey, unknown>,
    );
    if (requestedRefs.length === 0 && requestedUrls.length === 0) {
      return buildError(
        'Either refs or urls is required and must include at least one visual file ref or media URL.',
        'INVALID_ARGUMENTS',
      );
    }

    const urlValidation = validateVisualMediaUrls(requestedUrls);
    const urlValidationError = formatVisualMediaUrlValidationError(urlValidation);
    if (urlValidationError) {
      return buildError(urlValidationError, 'UNSUPPORTED_VISUAL_MEDIA_URLS');
    }

    const selectedUrlItems = createUrlVisualFileItems(urlValidation.validUrls);
    let selectedRefItems: VisualFileItem[] = [];

    if (requestedRefs.length > 0) {
      const fileService = new FileService(this.db, this.userId, this.workspaceId);
      const messageModel = new MessageModel(this.db, this.userId, this.workspaceId);
      const postProcessUrl = (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => fileService.getFileAccessUrl({ id: file.id, url: path });
      const [sourceMessage] = await messageModel.queryByIds([this.messageId], {
        postProcessUrl,
      });

      const visualMessages = sourceMessage
        ? await this.queryScopeMessages(messageModel, sourceMessage, postProcessUrl)
        : [];
      const orderedVisualMessages = [
        ...(sourceMessage && hasUserVisualFiles(sourceMessage) ? [sourceMessage] : []),
        ...visualMessages.filter(
          (message) => message.id !== sourceMessage?.id && hasUserVisualFiles(message),
        ),
      ];

      if (!sourceMessage) {
        return buildError(
          `Source message not found: ${this.messageId}`,
          'SOURCE_MESSAGE_NOT_FOUND',
        );
      }

      const visualItems = orderedVisualMessages.flatMap((message) =>
        createVisualFileItems(message, message.imageList, message.videoList),
      );

      if (visualItems.length === 0) {
        return buildError(
          'No visual files are attached to the current message.',
          'NO_VISUAL_FILES',
        );
      }

      const { availableRefs, invalidRefs, selected } = selectVisualFileItems(
        visualItems,
        requestedRefs,
      );

      if (invalidRefs.length > 0) {
        return buildError(
          `Unknown visual file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}.`,
          'UNKNOWN_VISUAL_FILE_REFS',
        );
      }

      selectedRefItems = selected;
    }

    const selectedItems = [...selectedRefItems, ...selectedUrlItems];

    if (selectedItems.length === 0) {
      return buildError('No visual files selected.', 'NO_VISUAL_FILES_SELECTED');
    }

    const abilities = await getModelAbilities(model, provider);
    const hasImages = selectedItems.some((item) => item.type === 'image');
    const hasVideos = selectedItems.some((item) => item.type === 'video');

    if (hasImages && abilities?.vision === false) {
      return buildError(
        `Configured visual understanding model "${provider}/${model}" does not support image vision.`,
        'VISUAL_MODEL_IMAGE_UNSUPPORTED',
      );
    }

    if (hasVideos && abilities?.video === false) {
      return buildError(
        `Configured visual understanding model "${provider}/${model}" does not support video understanding.`,
        'VISUAL_MODEL_VIDEO_UNSUPPORTED',
      );
    }

    let content = '';
    let usage: unknown;
    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);
    const payload = {
      messages: [
        {
          content: buildAnalyzeVisualMediaContent(selectedItems, params.question),
          role: 'user' as const,
        },
      ],
      model,
      stream: false,
    } satisfies ChatStreamPayload;

    const response = await runtime.chat(payload, {
      callback: {
        onCompletion: (data) => {
          usage = data.usage;
        },
        onContentPart: (part) => {
          if (part.partType === 'text') content += part.content;
        },
        onText: (text) => {
          content += text;
        },
      },
      metadata: {
        trigger: RequestTrigger.VisualAnalysis,
      },
    });

    await consumeStreamUntilDone(response);

    return {
      content: content.trim(),
      state: {
        files: selectedItems.map(({ ref, id, type, name }) => ({ id, name, ref, type })),
        model,
        provider,
        trigger: RequestTrigger.VisualAnalysis,
        usage,
      },
      success: true,
    };
  };
}

export const lobeAgentRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for LobeAgent execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for LobeAgent execution');
    }
    if (!context.messageId) {
      throw new Error('messageId is required for LobeAgent execution');
    }

    return new LobeAgentExecutionRuntime({
      agentId: context.agentId,
      groupId: context.groupId,
      messageId: context.messageId,
      operationId: context.operationId,
      serverDB: context.serverDB,
      threadId: context.threadId,
      topicId: context.topicId,
      userId: context.userId,
      workspaceId: context.workspaceId,
    });
  },
  identifier: LobeAgentIdentifier,
};
