import type {
  BuiltinToolContext,
  BuiltinToolResult,
  ChatImageItem,
  ChatVideoItem,
} from '@lobechat/types';
import { BaseExecutor, createVisualFileRef, createVisualLocalRef } from '@lobechat/types';

import { LobeAgentManifest } from '../manifest';
import type { AnalyzeVisualMediaParams } from '../types';
import { LobeAgentApiName } from '../types';

interface VisualFileItem {
  description: string;
  localRef: string;
  messageId?: string;
  name: string;
  ref: string;
  type: 'image' | 'video';
  uri: string;
}

interface VisualSourceMessage {
  id?: string;
  imageList?: ChatImageItem[];
  parentId?: string;
  role?: string;
  videoList?: ChatVideoItem[];
}

const getVisualUnderstandingConfig = () =>
  typeof window === 'undefined'
    ? undefined
    : window.global_serverConfigStore?.getState().serverConfig.visualUnderstanding;

const createAbortController = (signal?: AbortSignal) => {
  const abortController = new AbortController();

  if (signal?.aborted) {
    abortController.abort();
    return abortController;
  }

  signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  return abortController;
};

const toVisualFileItems = (
  message: VisualSourceMessage | undefined,
  images: ChatImageItem[] = [],
  videos: ChatVideoItem[] = [],
): VisualFileItem[] => [
  ...images.map((image, index) => ({
    description: image.alt || `Image ${index + 1}`,
    localRef: createVisualLocalRef('image', index),
    messageId: message?.id,
    name: image.alt || image.id,
    ref: createVisualFileRef({ index, messageId: message?.id, type: 'image' }),
    type: 'image' as const,
    uri: image.url,
  })),
  ...videos.map((video, index) => ({
    description: video.alt || `Video ${index + 1}`,
    localRef: createVisualLocalRef('video', index),
    messageId: message?.id,
    name: video.alt || video.id,
    ref: createVisualFileRef({ index, messageId: message?.id, type: 'video' }),
    type: 'video' as const,
    uri: video.url,
  })),
];

const selectFiles = (items: VisualFileItem[], sourceMessageId?: string, refs?: string[]) => {
  if (!refs || refs.length === 0) return { selected: items };

  const findItem = (ref: string) =>
    items.find(
      (item) => item.ref === ref || (item.messageId === sourceMessageId && item.localRef === ref),
    );
  const selected = refs
    .map((ref) => findItem(ref))
    .filter((item): item is VisualFileItem => !!item);
  const invalidRefs = refs.filter((ref) => !findItem(ref));

  return { invalidRefs, selected };
};

const normalizeRequestedRefs = (params: AnalyzeVisualMediaParams) => {
  const refs = [...(params.files ?? []), params.imageRef, params.videoRef]
    .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
    .map((ref) => ref.trim());

  return refs.length > 0 ? refs : undefined;
};

const isVisualSourceMessage = (message: unknown): message is VisualSourceMessage =>
  !!message && typeof message === 'object';

const hasVisualFiles = (message: unknown): message is VisualSourceMessage =>
  isVisualSourceMessage(message) &&
  message.role === 'user' &&
  ((message.imageList?.length ?? 0) > 0 || (message.videoList?.length ?? 0) > 0);

class LobeAgentExecutor extends BaseExecutor<typeof LobeAgentApiName> {
  readonly identifier = LobeAgentManifest.identifier;
  protected readonly apiEnum = LobeAgentApiName;

  analyzeVisualMedia = async (
    params: AnalyzeVisualMediaParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const config = getVisualUnderstandingConfig();

    if (!config?.provider || !config.model) {
      return {
        error: {
          message: 'Visual understanding model is not configured',
          type: 'PluginSettingsInvalid',
        },
        success: false,
      };
    }

    if (!params.question?.trim()) {
      return {
        error: { message: '`question` is required', type: 'InvalidToolArguments' },
        success: false,
      };
    }

    const [{ chatService }, { getChatStoreState }, { dbMessageSelectors }] = await Promise.all([
      import('@/services/chat'),
      import('@/store/chat'),
      import('@/store/chat/selectors'),
    ]);

    const chatState = getChatStoreState();
    const sourceCandidate =
      ctx.sourceMessageId && dbMessageSelectors.getDbMessageById(ctx.sourceMessageId)(chatState);
    const toolMessage = dbMessageSelectors.getDbMessageById(ctx.messageId)(chatState);
    const assistantMessage =
      isVisualSourceMessage(toolMessage) &&
      toolMessage.parentId &&
      dbMessageSelectors.getDbMessageById(toolMessage.parentId)(chatState);
    const parentUserMessage =
      isVisualSourceMessage(assistantMessage) &&
      assistantMessage.parentId &&
      dbMessageSelectors.getDbMessageById(assistantMessage.parentId)(chatState);
    const sourceMessage = hasVisualFiles(sourceCandidate)
      ? sourceCandidate
      : hasVisualFiles(parentUserMessage)
        ? parentUserMessage
        : dbMessageSelectors.latestUserMessage(chatState);
    const activeVisualMessages = dbMessageSelectors
      .activeDbMessages(chatState)
      .filter(hasVisualFiles);
    const visualMessages = [
      ...(hasVisualFiles(sourceMessage) ? [sourceMessage] : []),
      ...activeVisualMessages.filter((message) => message.id !== sourceMessage?.id),
    ];
    const files = visualMessages.flatMap((message) =>
      toVisualFileItems(message, message.imageList, message.videoList),
    );

    if (files.length === 0) {
      return {
        error: {
          message: 'No visual files are available in the current message',
          type: 'VisualFilesNotFound',
        },
        success: false,
      };
    }

    const requestedRefs = normalizeRequestedRefs(params);
    const currentFiles = files.filter((file) => file.messageId === sourceMessage?.id);
    const selectableFiles = requestedRefs?.length
      ? files
      : currentFiles.length > 0
        ? currentFiles
        : files;
    const { invalidRefs, selected } = selectFiles(
      selectableFiles,
      sourceMessage?.id,
      requestedRefs,
    );
    if (invalidRefs?.length) {
      const availableRefs = selectableFiles.flatMap((file) =>
        file.messageId === sourceMessage?.id ? [file.ref, file.localRef] : [file.ref],
      );

      return {
        content: `Unknown file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}`,
        error: { message: 'Unknown visual file refs', type: 'InvalidToolArguments' },
        state: { availableFiles: selectableFiles, invalidRefs },
        success: false,
      };
    }

    if (selected.length === 0) {
      return {
        error: { message: 'No visual files selected', type: 'InvalidToolArguments' },
        success: false,
      };
    }

    let content = '';
    let error: { message?: string } | undefined;
    let usage: unknown;
    const abortController = createAbortController(ctx.signal);
    const fileSummary = selected
      .map((file) => `- ${file.ref}: ${file.name} (${file.type})`)
      .join('\n');

    await chatService.getChatCompletion(
      {
        max_tokens: 2000,
        messages: [
          {
            content: [
              {
                text: [
                  'Analyze the attached visual media and answer the user question.',
                  'Do not mention that you are a fallback tool unless it is relevant.',
                  '',
                  'Files:',
                  fileSummary,
                  '',
                  `Question: ${params.question}`,
                ].join('\n'),
                type: 'text',
              },
              ...selected.map((file) =>
                file.type === 'image'
                  ? { image_url: { detail: 'auto', url: file.uri }, type: 'image_url' as const }
                  : { type: 'video_url' as const, video_url: { url: file.uri } },
              ),
            ],
            role: 'user',
          },
        ] as any,
        model: config.model,
        provider: config.provider,
        stream: true,
      },
      {
        onFinish: async (output, metadata) => {
          content = output || content;
          usage = metadata.usage;
        },
        onErrorHandle: (err) => {
          error = err;
        },
        onMessageHandle: (chunk) => {
          if (chunk.type === 'text') content += chunk.text || '';
        },
        signal: abortController.signal,
      },
    );

    if (abortController.signal.aborted) {
      return { stop: true, success: false };
    }

    if (error) {
      return {
        error: {
          body: error,
          message: error.message ?? 'Visual understanding request failed',
          type: 'PluginServerError',
        },
        success: false,
      };
    }

    return {
      content,
      state: {
        files: selected,
        model: config.model,
        provider: config.provider,
        trigger: 'lobe-agent.analyzeVisualMedia',
        usage,
      },
      success: true,
    };
  };
}

export const lobeAgentExecutor = new LobeAgentExecutor();
