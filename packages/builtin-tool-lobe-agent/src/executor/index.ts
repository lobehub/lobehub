import type { BuiltinToolContext, BuiltinToolResult, ChatStreamPayload } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { LobeAgentManifest } from '../manifest';
import type { AnalyzeVisualMediaParams } from '../types';
import { LobeAgentApiName } from '../types';
import type { VisualFileItem } from '../visualMedia';
import {
  buildAnalyzeVisualMediaContent,
  createUrlVisualFileItems,
  createVisualFileItems,
  formatVisualMediaUrlValidationError,
  getUnexpectedAnalyzeVisualMediaArgumentKeys,
  hasUserVisualFiles,
  normalizeAnalyzeVisualMediaInput,
  selectVisualFileItems,
  validateVisualMediaUrls,
} from '../visualMedia';

interface VisualSourceMessage {
  parentId?: string;
}

const getVisualUnderstandingConfig = async () => {
  const { getServerConfigStoreState, serverConfigSelectors } = await import('@/store/serverConfig');
  const serverConfigState = getServerConfigStoreState();

  return serverConfigState
    ? serverConfigSelectors.visualUnderstanding(serverConfigState)
    : undefined;
};

const createAbortController = (signal?: AbortSignal) => {
  const abortController = new AbortController();

  if (signal?.aborted) {
    abortController.abort();
    return abortController;
  }

  signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  return abortController;
};

const isVisualSourceMessage = (message: unknown): message is VisualSourceMessage =>
  !!message && typeof message === 'object';

class LobeAgentExecutor extends BaseExecutor<typeof LobeAgentApiName> {
  readonly identifier = LobeAgentManifest.identifier;
  protected readonly apiEnum = LobeAgentApiName;

  analyzeVisualMedia = async (
    params: AnalyzeVisualMediaParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const config = await getVisualUnderstandingConfig();

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

    const { requestedRefs, requestedUrls } = normalizeAnalyzeVisualMediaInput(
      params as unknown as Record<PropertyKey, unknown>,
    );
    if (requestedRefs.length === 0 && requestedUrls.length === 0) {
      const unexpectedKeys = getUnexpectedAnalyzeVisualMediaArgumentKeys(
        params as unknown as Record<PropertyKey, unknown>,
      );
      const aliasHint =
        unexpectedKeys.length > 0 ? ` Do not use ${unexpectedKeys.join(', ')}.` : '';

      return {
        error: {
          message: `Either \`refs\` or \`urls\` is required and must include at least one visual file ref or media URL.${aliasHint}`,
          type: 'InvalidToolArguments',
        },
        success: false,
      };
    }

    const urlValidation = validateVisualMediaUrls(requestedUrls);
    const urlValidationError = formatVisualMediaUrlValidationError(urlValidation);
    if (urlValidationError) {
      return {
        error: {
          message: urlValidationError,
          type: 'InvalidToolArguments',
        },
        success: false,
      };
    }

    const selectedUrls = createUrlVisualFileItems(urlValidation.validUrls);
    let selectedRefs: VisualFileItem[] = [];

    if (requestedRefs.length > 0) {
      const [{ getChatStoreState }, { dbMessageSelectors }] = await Promise.all([
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
      const sourceMessage = hasUserVisualFiles(sourceCandidate)
        ? sourceCandidate
        : hasUserVisualFiles(parentUserMessage)
          ? parentUserMessage
          : dbMessageSelectors.latestUserMessage(chatState);
      const activeVisualMessages = dbMessageSelectors
        .activeDbMessages(chatState)
        .filter(hasUserVisualFiles);
      const visualMessages = [
        ...(hasUserVisualFiles(sourceMessage) ? [sourceMessage] : []),
        ...activeVisualMessages.filter((message) => message.id !== sourceMessage?.id),
      ];
      const files = visualMessages.flatMap((message) =>
        createVisualFileItems(message, message.imageList, message.videoList),
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

      const selectableFiles = files;
      const { invalidRefs, selected } = selectVisualFileItems(selectableFiles, requestedRefs);

      if (invalidRefs?.length) {
        const availableRefs = selectableFiles.map((file) => file.ref);

        return {
          content: `Unknown file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}`,
          error: { message: 'Unknown visual file refs', type: 'InvalidToolArguments' },
          state: { availableFiles: selectableFiles, invalidRefs },
          success: false,
        };
      }

      selectedRefs = selected;
    }

    const selectedItems = [...selectedRefs, ...selectedUrls];

    if (selectedItems.length === 0) {
      return {
        error: { message: 'No visual files selected', type: 'InvalidToolArguments' },
        success: false,
      };
    }

    let content = '';
    let error: { message?: string } | undefined;
    let usage: unknown;
    const abortController = createAbortController(ctx.signal);
    const { chatService } = await import('@/services/chat');

    const payload = {
      max_tokens: 2000,
      messages: [
        {
          content: buildAnalyzeVisualMediaContent(selectedItems, params.question, {
            includeFallbackInstruction: true,
            includeFileSummary: true,
          }),
          role: 'user' as const,
        },
      ],
      model: config.model,
      provider: config.provider,
      stream: true,
    } satisfies Partial<ChatStreamPayload>;

    await chatService.getChatCompletion(payload, {
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
    });

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
        files: selectedItems,
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
