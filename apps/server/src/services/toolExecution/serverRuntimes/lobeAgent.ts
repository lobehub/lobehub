import type {
  AnalyzeMediaParams,
  CallSubAgentParams,
  MediaFileItem,
  MediaSourceMessage,
} from '@lobechat/builtin-tool-lobe-agent';
import {
  buildAnalyzeMediaContent,
  createMediaFileItems,
  createUrlMediaFileItems,
  formatMediaUrlValidationError,
  hasUserMediaFiles,
  LobeAgentIdentifier,
  normalizeAnalyzeMediaInput,
  selectMediaFileItems,
  validateMediaUrls,
} from '@lobechat/builtin-tool-lobe-agent';
import { PlanExecutionRuntime } from '@lobechat/builtin-tool-lobe-agent/planRuntime';
import { UserInteractionExecutionRuntime } from '@lobechat/builtin-tool-user-interaction/executionRuntime';
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

interface LobeAgentRuntimeContext {
  agentId?: string | null;
  /**
   * Visibility of the executing agent. Forwarded to the plan runtime so plan
   * documents inherit private-agent visibility.
   */
  agentVisibility?: 'private' | 'public' | null;
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

interface ServerMediaSourceMessage extends MediaSourceMessage {
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
  // Reused from the standalone user-interaction tool. askUserQuestion is
  // human-intervention 'always', so the user's UI answer normally becomes the
  // tool result; this runtime is only the fallback executor.
  private interactionRuntime = new UserInteractionExecutionRuntime();

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
      createServerPlanRuntimeService(
        context.serverDB,
        context.userId,
        context.workspaceId,
        context.agentVisibility,
      ),
    );
  }

  // ==================== Ask User Question ====================

  askUserQuestion = (params: unknown): Promise<BuiltinServerRuntimeOutput> =>
    this.interactionRuntime.askUserQuestion(params);

  // ==================== Plan / Todo (delegated to PlanExecutionRuntime) ====================

  /**
   * Todo APIs read their prior state from `ctx.currentTodos` (rebuilt from
   * message history by the runtime executors). Without it the runtime falls back
   * to the topic's plan document, which only exists once `createPlan` has run —
   * so a plain `createTodos` → `updateTodos` sequence would see an empty list,
   * drop every index-based operation, and answer "No operations applied.".
   */
  private planContext = (ctx?: ToolExecutionContext) => ({
    currentTodos: ctx?.currentTodos,
    messageId: this.messageId,
    topicId: this.topicId,
  });

  createPlan = (params: any, ctx?: ToolExecutionContext) =>
    this.planRuntime.createPlan(params, this.planContext(ctx));

  updatePlan = (params: any, ctx?: ToolExecutionContext) =>
    this.planRuntime.updatePlan(params, this.planContext(ctx));

  createTodos = (params: any, ctx?: ToolExecutionContext) =>
    this.planRuntime.createTodos(params, this.planContext(ctx));

  updateTodos = (params: any, ctx?: ToolExecutionContext) =>
    this.planRuntime.updateTodos(params, this.planContext(ctx));

  clearTodos = (params: any, ctx?: ToolExecutionContext) =>
    this.planRuntime.clearTodos(params, this.planContext(ctx));

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

    const { started, error, threadId, subOperationId, toolMessageId } = await ctx.subAgent.run({
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
      // `toolMessageId` rides along so the runtime's pause chunk can tell the
      // client which row to fetch; the client never sees it as tool state.
      state: { status: 'pending', subOperationId, threadId, toolMessageId },
      success: true,
    };
  };

  private queryScopeMessages = (
    messageModel: MessageModel,
    sourceMessage: ServerMediaSourceMessage,
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

  analyzeMedia = async (params: AnalyzeMediaParams): Promise<BuiltinServerRuntimeOutput> => {
    const provider = toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER;
    const model = toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL;

    if (!provider || !model) {
      return buildError(
        'Multimodal understanding is not configured. Set MULTIMODAL_UNDERSTANDING_PROVIDER and MULTIMODAL_UNDERSTANDING_MODEL.',
        'MULTIMODAL_UNDERSTANDING_NOT_CONFIGURED',
      );
    }

    if (!params.question || typeof params.question !== 'string') {
      return buildError('question is required.', 'INVALID_ARGUMENTS');
    }

    const { requestedRefs, requestedUrls } = normalizeAnalyzeMediaInput(
      params as unknown as Record<PropertyKey, unknown>,
    );
    if (requestedRefs.length === 0 && requestedUrls.length === 0) {
      return buildError(
        'Either refs or urls is required and must include at least one media file ref or media URL.',
        'INVALID_ARGUMENTS',
      );
    }

    const urlValidation = validateMediaUrls(requestedUrls);
    const urlValidationError = formatMediaUrlValidationError(urlValidation);
    if (urlValidationError) {
      return buildError(urlValidationError, 'UNSUPPORTED_MEDIA_URLS');
    }

    const selectedUrlItems = createUrlMediaFileItems(urlValidation.validUrls);
    let selectedRefItems: MediaFileItem[] = [];

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

      const mediaMessages = sourceMessage
        ? await this.queryScopeMessages(messageModel, sourceMessage, postProcessUrl)
        : [];
      const orderedMediaMessages = [
        ...(sourceMessage && hasUserMediaFiles(sourceMessage) ? [sourceMessage] : []),
        ...mediaMessages.filter(
          (message) => message.id !== sourceMessage?.id && hasUserMediaFiles(message),
        ),
      ];

      if (!sourceMessage) {
        return buildError(
          `Source message not found: ${this.messageId}`,
          'SOURCE_MESSAGE_NOT_FOUND',
        );
      }

      const mediaItems = orderedMediaMessages.flatMap((message) =>
        createMediaFileItems(message, message.imageList, message.videoList, message.audioList),
      );

      if (mediaItems.length === 0) {
        return buildError('No media files are attached to the current message.', 'NO_MEDIA_FILES');
      }

      const { availableRefs, invalidRefs, selected } = selectMediaFileItems(
        mediaItems,
        requestedRefs,
      );

      if (invalidRefs.length > 0) {
        return buildError(
          `Unknown media file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}.`,
          'UNKNOWN_MEDIA_FILE_REFS',
        );
      }

      selectedRefItems = selected;
    }

    const selectedItems = [...selectedRefItems, ...selectedUrlItems];

    if (selectedItems.length === 0) {
      return buildError('No media files selected.', 'NO_MEDIA_FILES_SELECTED');
    }

    const abilities = await getModelAbilities(model, provider);
    const hasAudios = selectedItems.some((item) => item.type === 'audio');
    const hasImages = selectedItems.some((item) => item.type === 'image');
    const hasVideos = selectedItems.some((item) => item.type === 'video');

    if (hasAudios && abilities?.audio === false) {
      return buildError(
        `Configured multimodal understanding model "${provider}/${model}" does not support audio understanding.`,
        'MULTIMODAL_MODEL_AUDIO_UNSUPPORTED',
      );
    }

    if (hasImages && abilities?.vision === false) {
      return buildError(
        `Configured multimodal understanding model "${provider}/${model}" does not support image vision.`,
        'MULTIMODAL_MODEL_IMAGE_UNSUPPORTED',
      );
    }

    if (hasVideos && abilities?.video === false) {
      return buildError(
        `Configured multimodal understanding model "${provider}/${model}" does not support video understanding.`,
        'MULTIMODAL_MODEL_VIDEO_UNSUPPORTED',
      );
    }

    let content = '';
    let usage: unknown;
    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);
    const payload = {
      messages: [
        {
          content: buildAnalyzeMediaContent(selectedItems, params.question),
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
        trigger: RequestTrigger.MultimodalAnalysis,
      },
    });

    await consumeStreamUntilDone(response);

    return {
      content: content.trim(),
      state: {
        files: selectedItems.map(({ ref, id, type, name }) => ({ id, name, ref, type })),
        model,
        provider,
        trigger: RequestTrigger.MultimodalAnalysis,
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
      agentVisibility: context.agentVisibility,
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
