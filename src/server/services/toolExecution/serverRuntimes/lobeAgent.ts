import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import type { LobeChatDatabase } from '@lobechat/database';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import {
  type BuiltinServerRuntimeOutput,
  type ChatImageItem,
  type ChatVideoItem,
  createVisualFileRef,
  createVisualLocalRef,
} from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { MessageModel } from '@/database/models/message';
import { toolsEnv } from '@/envs/tools';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

import type { ServerRuntimeRegistration } from './types';

interface AnalyzeVisualMediaParams {
  files?: string[];
  imageRef?: string;
  question: string;
  videoRef?: string;
}

interface VisualFileItem {
  id: string;
  localRef: string;
  messageId?: string;
  mimeType?: string;
  name?: string;
  ref: string;
  type: 'image' | 'video';
  url: string;
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

interface VisualSourceMessage {
  agentId?: string | null;
  groupId?: string | null;
  id?: string;
  imageList?: ChatImageItem[];
  role?: string;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  videoList?: ChatVideoItem[];
}

const buildVisualItems = (message: VisualSourceMessage): VisualFileItem[] => {
  const images: VisualFileItem[] = (message.imageList ?? []).map((item, index) => ({
    id: item.id,
    localRef: createVisualLocalRef('image', index),
    messageId: message.id,
    name: item.alt,
    ref: createVisualFileRef({ index, messageId: message.id, type: 'image' }),
    type: 'image',
    url: item.url,
  }));

  const videos: VisualFileItem[] = (message.videoList ?? []).map((item, index) => ({
    id: item.id,
    localRef: createVisualLocalRef('video', index),
    messageId: message.id,
    name: item.alt,
    ref: createVisualFileRef({ index, messageId: message.id, type: 'video' }),
    type: 'video',
    url: item.url,
  }));

  return [...images, ...videos];
};

const hasVisualFiles = (message: VisualSourceMessage) =>
  (message.imageList?.length ?? 0) > 0 || (message.videoList?.length ?? 0) > 0;

const selectVisualItems = (
  items: VisualFileItem[],
  sourceMessageId: string,
  requestedRefs?: string[],
) => {
  const findItem = (ref: string) =>
    items.find(
      (item) => item.ref === ref || (item.messageId === sourceMessageId && item.localRef === ref),
    );

  const availableRefs = items.flatMap((item) =>
    item.messageId === sourceMessageId ? [item.ref, item.localRef] : [item.ref],
  );
  const unknownRefs = requestedRefs?.filter((ref) => !findItem(ref)) ?? [];
  const selectedItems =
    requestedRefs && requestedRefs.length > 0
      ? requestedRefs.map((ref) => findItem(ref)).filter((item): item is VisualFileItem => !!item)
      : items;

  return { availableRefs, selectedItems, unknownRefs };
};

const normalizeRequestedRefs = (params: AnalyzeVisualMediaParams) => {
  const refs = [...(params.files ?? []), params.imageRef, params.videoRef]
    .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
    .map((ref) => ref.trim());

  return refs.length > 0 ? refs : undefined;
};

class LobeAgentExecutionRuntime {
  private agentId?: string | null;
  private db: LobeChatDatabase;
  private groupId?: string | null;
  private userId: string;
  private messageId: string;
  private threadId?: string | null;
  private topicId?: string;

  constructor(context: LobeAgentRuntimeContext) {
    this.agentId = context.agentId;
    this.db = context.serverDB;
    this.groupId = context.groupId;
    this.messageId = context.messageId;
    this.threadId = context.threadId;
    this.topicId = context.topicId;
    this.userId = context.userId;
  }

  private queryScopeMessages = (
    messageModel: MessageModel,
    sourceMessage: VisualSourceMessage,
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

    const fileService = new FileService(this.db, this.userId);
    const messageModel = new MessageModel(this.db, this.userId);
    const postProcessUrl = (path: string | null) => fileService.getFullFileUrl(path);
    const [sourceMessage] = await messageModel.queryByIds([this.messageId], {
      postProcessUrl,
    });

    const requestedRefs = normalizeRequestedRefs(params);
    const visualMessages =
      sourceMessage && (requestedRefs?.length || !hasVisualFiles(sourceMessage))
        ? await this.queryScopeMessages(messageModel, sourceMessage, postProcessUrl)
        : sourceMessage
          ? [sourceMessage]
          : [];
    const orderedVisualMessages = [
      ...(sourceMessage && hasVisualFiles(sourceMessage) ? [sourceMessage] : []),
      ...visualMessages.filter(
        (message) =>
          message.id !== sourceMessage?.id && message.role === 'user' && hasVisualFiles(message),
      ),
    ];

    if (!sourceMessage) {
      return buildError(`Source message not found: ${this.messageId}`, 'SOURCE_MESSAGE_NOT_FOUND');
    }

    const visualItems = orderedVisualMessages.flatMap((message) => buildVisualItems(message));

    if (visualItems.length === 0) {
      return buildError('No visual files are attached to the current message.', 'NO_VISUAL_FILES');
    }

    const defaultItems = visualItems.filter((item) => item.messageId === this.messageId);
    const selectableItems = requestedRefs?.length
      ? visualItems
      : defaultItems.length > 0
        ? defaultItems
        : visualItems;
    const { availableRefs, selectedItems, unknownRefs } = selectVisualItems(
      selectableItems,
      this.messageId,
      requestedRefs,
    );

    if (unknownRefs.length > 0) {
      return buildError(
        `Unknown visual file refs: ${unknownRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}.`,
        'UNKNOWN_VISUAL_FILE_REFS',
      );
    }

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
    const response = await runtime.chat(
      {
        messages: [
          {
            content: [
              {
                text: [
                  'Analyze the attached visual media and answer the user question.',
                  '',
                  `Question: ${params.question}`,
                ].join('\n'),
                type: 'text',
              },
              ...selectedItems.map((item) =>
                item.type === 'image'
                  ? {
                      image_url: { detail: 'auto', url: item.url },
                      type: 'image_url',
                    }
                  : {
                      type: 'video_url',
                      video_url: { url: item.url },
                    },
              ),
            ],
            role: 'user',
          },
        ],
        model,
        stream: false,
      } as any,
      {
        callback: {
          onCompletion: (data) => {
            usage = data.usage;
          },
          onText: (text) => {
            content += text;
          },
        },
        metadata: {
          trigger: 'lobe-agent.analyzeVisualMedia',
        },
      },
    );

    await consumeStreamUntilDone(response);

    return {
      content: content.trim(),
      state: {
        files: selectedItems.map(({ ref, id, type, name }) => ({ id, name, ref, type })),
        model,
        provider,
        trigger: 'lobe-agent.analyzeVisualMedia',
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
