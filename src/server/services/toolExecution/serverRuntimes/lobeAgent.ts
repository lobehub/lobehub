import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import type { LobeChatDatabase } from '@lobechat/database';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import type { BuiltinServerRuntimeOutput, ChatImageItem, ChatVideoItem } from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { MessageModel } from '@/database/models/message';
import { toolsEnv } from '@/envs/tools';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

import type { ServerRuntimeRegistration } from './types';

interface AnalyzeVisualMediaParams {
  files?: string[];
  question: string;
}

interface VisualFileItem {
  id: string;
  mimeType?: string;
  name?: string;
  ref: string;
  type: 'image' | 'video';
  url: string;
}

interface LobeAgentRuntimeContext {
  messageId: string;
  serverDB: LobeChatDatabase;
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

const buildVisualItems = (message: {
  imageList?: ChatImageItem[];
  videoList?: ChatVideoItem[];
}): VisualFileItem[] => {
  const images: VisualFileItem[] = (message.imageList ?? []).map((item, index) => ({
    id: item.id,
    name: item.alt,
    ref: `image_${index + 1}`,
    type: 'image',
    url: item.url,
  }));

  const videos: VisualFileItem[] = (message.videoList ?? []).map((item, index) => ({
    id: item.id,
    name: item.alt,
    ref: `video_${index + 1}`,
    type: 'video',
    url: item.url,
  }));

  return [...images, ...videos];
};

class LobeAgentExecutionRuntime {
  private db: LobeChatDatabase;
  private userId: string;
  private messageId: string;

  constructor(context: LobeAgentRuntimeContext) {
    this.db = context.serverDB;
    this.messageId = context.messageId;
    this.userId = context.userId;
  }

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
    const [sourceMessage] = await messageModel.queryByIds([this.messageId], {
      postProcessUrl: (path) => fileService.getFullFileUrl(path),
    });

    if (!sourceMessage) {
      return buildError(`Source message not found: ${this.messageId}`, 'SOURCE_MESSAGE_NOT_FOUND');
    }

    const visualItems = buildVisualItems(sourceMessage);

    if (visualItems.length === 0) {
      return buildError('No visual files are attached to the current message.', 'NO_VISUAL_FILES');
    }

    const availableRefs = visualItems.map((item) => item.ref);
    const requestedRefs = params.files?.filter(Boolean);
    const unknownRefs = requestedRefs?.filter((ref) => !availableRefs.includes(ref)) ?? [];

    if (unknownRefs.length > 0) {
      return buildError(
        `Unknown visual file refs: ${unknownRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}.`,
        'UNKNOWN_VISUAL_FILE_REFS',
      );
    }

    const selectedItems =
      requestedRefs && requestedRefs.length > 0
        ? visualItems.filter((item) => requestedRefs.includes(item.ref))
        : visualItems;

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
      messageId: context.messageId,
      serverDB: context.serverDB,
      userId: context.userId,
    });
  },
  identifier: LobeAgentIdentifier,
};
