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
   * Split metadata into usage and performance objects.
   *
   * Supports two storage shapes:
   * - **Nested** (canonical): `metadata.usage = {...}`, `metadata.performance = {...}`
   *   — written by hetero-agent / Gateway executors.
   * - **Flat** (legacy): `metadata.totalTokens`, `metadata.ttft`, etc — older write paths
   *   that splatted token fields directly onto metadata.
   *
   * Nested takes priority; flat fields fill in any missing keys (transition state).
   */
  splitMetadata(metadata?: any): {
    performance?: ModelPerformance;
    usage?: ModelUsage;
  } {
    if (!metadata) return {};

    const usage: ModelUsage = { ...metadata.usage };
    const performance: ModelPerformance = { ...metadata.performance };
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
      if (metadata[field] !== undefined && (usage as any)[field] === undefined) {
        (usage as any)[field] = metadata[field];
        hasUsage = true;
      }
    });

    const performanceFields = ['duration', 'latency', 'tps', 'ttft'] as const;
    performanceFields.forEach((field) => {
      if (metadata[field] !== undefined && (performance as any)[field] === undefined) {
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
   * - Token fields: taken from the LAST child that reports usage. In a
   *   multi-step agent run every step resends the full context, so summing
   *   input-side tokens counts the same context once per step (e.g. 15 steps
   *   × ~55K read as "827K" while the real context was ~75K — see LOBE-11585).
   *   The final step's usage IS the context watermark of the whole run.
   * - Sums costs (billing is per-request, so the sum is the real spend)
   * - Takes first ttft
   * - Averages tps
   * - Sums duration and latency
   */
  aggregateMetadata(children: AssistantContentBlock[]): {
    performance?: ModelPerformance;
    usage?: ModelUsage;
  } {
    let usage: ModelUsage = {};
    const performance: ModelPerformance = {};
    let hasUsageData = false;
    let hasPerformanceData = false;
    let tpsSum = 0;
    let tpsCount = 0;
    let costSum = 0;
    let hasCost = false;

    children.forEach((child) => {
      if (child.usage) {
        const { cost, ...tokens } = child.usage;

        if (Object.keys(tokens).length > 0) {
          usage = { ...tokens };
          hasUsageData = true;
        }

        if (typeof cost === 'number') {
          costSum += cost;
          hasCost = true;
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

    if (hasCost) usage.cost = costSum;

    return {
      performance: hasPerformanceData ? performance : undefined,
      usage: hasUsageData ? usage : undefined,
    };
  }
}
