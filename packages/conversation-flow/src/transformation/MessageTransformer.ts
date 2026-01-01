import type { AssistantContentBlock, ModelPerformance, ModelUsage } from '@lobechat/types';

import type { Message } from '../types';

/**
 * MessageTransformer - Handles message transformation utilities
 *
 * Provides utilities for:
 * 1. Converting Message to AssistantContentBlock
 * 2. Splitting metadata into usage and performance
 * 3. Aggregating metadata from multiple messages
 */
export class MessageTransformer {
  /**
   * Convert a Message to AssistantContentBlock
   */
  messageToContentBlock(message: Message): AssistantContentBlock {
    const { usage, performance } = this.splitMetadata(message.metadata);

    return {
      content: message.content || '',
      error: message.error,
      fileList: message.fileList,
      id: message.id,
      imageList: message.imageList,
      performance,
      reasoning: message.reasoning || undefined,
      tools: message.tools as any,
      usage,
    };
  }

  /**
   * Split metadata into usage and performance objects
   */
  splitMetadata(metadata?: any): {
    performance?: ModelPerformance;
    usage?: ModelUsage;
  } {
    if (!metadata) return {};

    const usage: ModelUsage = {};
    const performance: ModelPerformance = {};

    const usageFields = [
      'acceptedPredictionTokens',
      'cost',
      'inputAudioTokens',
      'inputCacheMissTokens',
      'inputCachedTokens',
      'inputCitationTokens',
      'inputImageTokens',
      'inputTextTokens',
      'inputWriteCacheTokens',
      'outputAudioTokens',
      'outputImageTokens',
      'outputReasoningTokens',
      'outputTextTokens',
      'rejectedPredictionTokens',
      'totalInputTokens',
      'totalOutputTokens',
      'totalTokens',
    ] as const;

    let hasUsage = false;
    usageFields.forEach((field) => {
      if (metadata[field] !== undefined) {
        (usage as any)[field] = metadata[field];
        hasUsage = true;
      }
    });

    const performanceFields = ['duration', 'latency', 'tps', 'ttft'] as const;
    let hasPerformance = false;
    performanceFields.forEach((field) => {
      if (metadata[field] !== undefined) {
        (performance as any)[field] = metadata[field];
        hasPerformance = true;
      }
    });

    return {
      performance: hasPerformance ? performance : undefined,
      usage: hasUsage ? usage : undefined,
    };
  }

  /**
   * Aggregate metadata from multiple children
   * - Sums token counts and costs
   * - Takes first ttft
   * - Averages tps
   * - Sums duration and latency
   */
  aggregateMetadata(children: AssistantContentBlock[]): {
    performance?: ModelPerformance;
    usage?: ModelUsage;
  } {
    const usage: ModelUsage = {};
    const performance: ModelPerformance = {};
    let hasUsageData = false;
    let hasPerformanceData = false;
    let tpsSum = 0;
    let tpsCount = 0;

    children.forEach((child) => {
      if (child.usage) {
        const tokenFields = [
          'acceptedPredictionTokens',
          'inputAudioTokens',
          'inputCacheMissTokens',
          'inputCachedTokens',
          'inputCitationTokens',
          'inputImageTokens',
          'inputTextTokens',
          'inputWriteCacheTokens',
          'outputAudioTokens',
          'outputImageTokens',
          'outputReasoningTokens',
          'outputTextTokens',
          'rejectedPredictionTokens',
          'totalInputTokens',
          'totalOutputTokens',
          'totalTokens',
        ] as const;

        tokenFields.forEach((field) => {
          if (typeof child.usage![field] === 'number') {
            (usage as any)[field] = ((usage as any)[field] || 0) + child.usage![field]!;
            hasUsageData = true;
          }
        });

        if (typeof child.usage.cost === 'number') {
          usage.cost = (usage.cost || 0) + child.usage.cost;
          hasUsageData = true;
        }
      }

      if (child.performance) {
        // Take first ttft (time to first token)
        if (child.performance.ttft !== undefined && performance.ttft === undefined) {
          performance.ttft = child.performance.ttft;
          hasPerformanceData = true;
        }

        // Average tps (tokens per second)
        if (typeof child.performance.tps === 'number') {
          tpsSum += child.performance.tps;
          tpsCount += 1;
          hasPerformanceData = true;
        }

        // Sum duration
        if (child.performance.duration !== undefined) {
          performance.duration = (performance.duration || 0) + child.performance.duration;
          hasPerformanceData = true;
        }

        // Sum latency
        if (child.performance.latency !== undefined) {
          performance.latency = (performance.latency || 0) + child.performance.latency;
          hasPerformanceData = true;
        }
      }
    });

    // Calculate average tps
    if (tpsCount > 0) {
      performance.tps = tpsSum / tpsCount;
    }

    return {
      performance: hasPerformanceData ? performance : undefined,
      usage: hasUsageData ? usage : undefined,
    };
  }
}
