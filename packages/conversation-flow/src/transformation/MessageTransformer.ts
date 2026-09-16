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
    const { usage, performance } = this.splitMetadata(message.metadata, message.usage);

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
   * Split metadata into usage and performance objects.
   *
   * Supports two storage shapes:
   * - **Nested** (canonical): `metadata.usage = {...}`, `metadata.performance = {...}`
   *   — written by hetero-agent / Gateway executors.
   * - **Flat** (legacy): `metadata.totalTokens`, `metadata.ttft`, etc — older write paths
   *   that splatted token fields directly onto metadata.
   *
   * Top-level usage takes priority. Nested and flat metadata fields only fill in
   * missing keys for legacy rows during the migration period.
   */
  splitMetadata(
    metadata?: any,
    topLevelUsage?: ModelUsage,
  ): {
    performance?: ModelPerformance;
    usage?: ModelUsage;
  } {
    if (!metadata && !topLevelUsage) return {};

    const usage: ModelUsage = { ...metadata?.usage, ...topLevelUsage };
    const performance: ModelPerformance = { ...metadata?.performance };
    let hasUsage = Object.keys(usage).length > 0;
    let hasPerformance = Object.keys(performance).length > 0;

    const usageFields = [
      'acceptedPredictionTokens',
      'cost',
      'inputAudioTokens',
      'inputCacheMissTokens',
      'inputCachedTokens',
      'inputCitationTokens',
      'inputImageTokens',
      'inputTextTokens',
      'inputVideoTokens',
      'inputToolTokens',
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

    usageFields.forEach((field) => {
      if (metadata?.[field] !== undefined && (usage as any)[field] === undefined) {
        (usage as any)[field] = metadata[field];
        hasUsage = true;
      }
    });

    const performanceFields = ['duration', 'latency', 'tps', 'ttft'] as const;
    performanceFields.forEach((field) => {
      if (metadata?.[field] !== undefined && (performance as any)[field] === undefined) {
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
   * - Calculates tps from paired output tokens and generation durations
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
    let measuredOutputTokens = 0;
    let generationDuration = 0;

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
          'inputVideoTokens',
          'inputToolTokens',
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

        // Pair tokens with their measured duration so incomplete calls cannot skew either sum.
        // Averaging per-call rates would give short bursts the same weight as long generations.
        const outputTokens = child.usage?.totalOutputTokens;
        const duration = child.performance.duration;
        if (
          typeof outputTokens === 'number' &&
          Number.isFinite(outputTokens) &&
          outputTokens >= 0 &&
          typeof duration === 'number' &&
          Number.isFinite(duration) &&
          duration > 0
        ) {
          measuredOutputTokens += outputTokens;
          generationDuration += duration;
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

    if (generationDuration > 0) {
      performance.tps = (measuredOutputTokens / generationDuration) * 1000;
    }

    return {
      performance: hasPerformanceData ? performance : undefined,
      usage: hasUsageData ? usage : undefined,
    };
  }
}
