import type { VisualFileItem, VisualSourceMessage } from '@lobechat/builtin-tool-lobe-agent';
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
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { MessageModel } from '@/database/models/message';
import { toolsEnv } from '@/envs/tools';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

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
  serverDB: LobeChatDatabase;
  threadId?: string | null;
  topicId?: string;
  userId: string;
}

const buildError = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

const getModelAbilities = (model: string, provider: string) => {
  return (
    LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === model && item.providerId === provider) ??
    LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === model)
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
  private threadId?: string | null;
  private topicId?: string;
  private planRuntime: PlanExecutionRuntime;

  constructor(context: LobeAgentRuntimeContext) {
    this.agentId = context.agentId;
    this.db = context.serverDB;
    this.groupId = context.groupId;
    this.messageId = context.messageId;
    this.threadId = context.threadId;
    this.topicId = context.topicId;
    this.userId = context.userId;
    this.planRuntime = new PlanExecutionRuntime(
      createServerPlanRuntimeService(context.serverDB, context.userId),
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

  private queryScopeMessages = (
    messageModel: MessageModel,
    sourceMessage: ServerVisualSourceMessage,
    postProcessUrl: (path: string | null, file: { fileType: string }) => Promise<string>,
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
      const fileService = new FileService(this.db, this.userId);
      const messageModel = new MessageModel(this.db, this.userId);
      const postProcessUrl = (path: string | null) => fileService.getFullFileUrl(path);
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

    const abilities = getModelAbilities(model, provider);
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
    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider);
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
      serverDB: context.serverDB,
      threadId: context.threadId,
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: LobeAgentIdentifier,
};
