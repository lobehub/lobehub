import type { AssistantContentBlock, ChatToolPayloadWithResult } from '@lobechat/types';

import type { Message } from '../../types';
import type { MessageTransformer } from '../MessageTransformer';

/** Metadata keys that become the block's own `usage` / `performance`. */
const USAGE_PERFORMANCE_FIELDS = new Set([
  'acceptedPredictionTokens',
  'cost',
  'duration',
  'inputAudioTokens',
  'inputCacheMissTokens',
  'inputCachedTokens',
  'inputCitationTokens',
  'inputImageTokens',
  'inputTextTokens',
  'inputVideoTokens',
  'inputToolTokens',
  'inputWriteCacheTokens',
  'latency',
  'outputAudioTokens',
  'outputImageTokens',
  'outputReasoningTokens',
  'outputTextTokens',
  // Nested canonical shape — see splitMetadata
  'performance',
  'rejectedPredictionTokens',
  'totalInputTokens',
  'totalOutputTokens',
  'totalTokens',
  'tps',
  'ttft',
  'usage',
]);

export interface BlockMetadata {
  otherMetadata: Record<string, any>;
  performance?: AssistantContentBlock['performance'];
  usage?: AssistantContentBlock['usage'];
}

/**
 * Split an assistant row's metadata into the block's usage, performance and
 * the remaining metadata fields.
 */
export const resolveBlockMetadata = (
  message: Message,
  messageTransformer: MessageTransformer,
): BlockMetadata => {
  // Prefer top-level usage/performance fields, fall back to metadata
  const { usage: metaUsage, performance: metaPerformance } = messageTransformer.splitMetadata(
    message.metadata,
  );

  // Extract non-usage/performance metadata fields
  const otherMetadata: Record<string, any> = {};
  if (message.metadata) {
    Object.entries(message.metadata).forEach(([key, value]) => {
      if (!USAGE_PERFORMANCE_FIELDS.has(key)) {
        otherMetadata[key] = value;
      }
    });
  }

  return {
    otherMetadata,
    performance: message.performance || metaPerformance,
    usage: message.usage || metaUsage,
  };
};

/**
 * The content block an assistant row becomes inside an assistant group or a
 * supervisor message.
 */
export const toAssistantContentBlock = (
  message: Message,
  { otherMetadata, performance, usage }: BlockMetadata,
  tools?: ChatToolPayloadWithResult[],
): AssistantContentBlock => {
  const block = {
    content: message.content || '',
    id: message.id,
  } as AssistantContentBlock;

  if (message.error) block.error = message.error;
  if (message.fileList && message.fileList.length > 0) block.fileList = message.fileList;
  if (message.imageList && message.imageList.length > 0) block.imageList = message.imageList;
  if (performance) block.performance = performance;
  if (message.reasoning) block.reasoning = message.reasoning;
  if (tools && tools.length > 0) block.tools = tools;
  if (usage) block.usage = usage;
  if (Object.keys(otherMetadata).length > 0) {
    block.metadata = otherMetadata;
  }

  return block;
};
