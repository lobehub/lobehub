import type {
  BuiltinToolContext,
  BuiltinToolResult,
  ChatImageItem,
  ChatVideoItem,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { LobeAgentManifest } from '../manifest';
import type { AnalyzeVisualMediaParams } from '../types';
import { LobeAgentApiName } from '../types';

interface VisualFileItem {
  description: string;
  name: string;
  ref: string;
  type: 'image' | 'video';
  uri: string;
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
  images: ChatImageItem[] = [],
  videos: ChatVideoItem[] = [],
): VisualFileItem[] => [
  ...images.map((image, index) => ({
    description: image.alt || `Image ${index + 1}`,
    name: image.alt || image.id,
    ref: `image_${index + 1}`,
    type: 'image' as const,
    uri: image.url,
  })),
  ...videos.map((video, index) => ({
    description: video.alt || `Video ${index + 1}`,
    name: video.alt || video.id,
    ref: `video_${index + 1}`,
    type: 'video' as const,
    uri: video.url,
  })),
];

const selectFiles = (items: VisualFileItem[], refs?: string[]) => {
  if (!refs || refs.length === 0) return { selected: items };

  const selected = refs
    .map((ref) => items.find((item) => item.ref === ref))
    .filter((item): item is VisualFileItem => !!item);
  const invalidRefs = refs.filter((ref) => !items.some((item) => item.ref === ref));

  return { invalidRefs, selected };
};

const hasVisualFiles = (message?: {
  imageList?: unknown[];
  role?: string;
  videoList?: unknown[];
}) =>
  message?.role === 'user' &&
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
      toolMessage?.parentId && dbMessageSelectors.getDbMessageById(toolMessage.parentId)(chatState);
    const parentUserMessage =
      assistantMessage?.parentId &&
      dbMessageSelectors.getDbMessageById(assistantMessage.parentId)(chatState);
    const sourceMessage = hasVisualFiles(sourceCandidate)
      ? sourceCandidate
      : hasVisualFiles(parentUserMessage)
        ? parentUserMessage
        : dbMessageSelectors.latestUserMessage(chatState);
    const files = toVisualFileItems(sourceMessage?.imageList, sourceMessage?.videoList);

    if (files.length === 0) {
      return {
        error: {
          message: 'No visual files are available in the current message',
          type: 'VisualFilesNotFound',
        },
        success: false,
      };
    }

    const { invalidRefs, selected } = selectFiles(files, params.files);
    if (invalidRefs?.length) {
      return {
        content: `Unknown file refs: ${invalidRefs.join(', ')}. Available refs: ${files
          .map((file) => file.ref)
          .join(', ')}`,
        error: { message: 'Unknown visual file refs', type: 'InvalidToolArguments' },
        state: { availableFiles: files, invalidRefs },
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
        onFinish: (output, metadata) => {
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
