import { buildHelperMaps } from './indexing';
import { buildIdTree } from './structuring';
import { Transformer } from './transformation';
import type { Message, MessageGroupMetadata, ParseResult } from './types';

/**
 * Main parse function - the brain of the conversation flow engine
 *
 * Converts a flat array of messages into:
 * 1. messageMap - for O(1) message access
 * 2. displayTree - semantic tree structure for navigation
 * 3. flatList - flattened array optimized for virtual list rendering
 *
 * Uses a three-phase parsing strategy:
 * 1. Indexing - build helper maps for efficient querying
 * 2. Structuring - convert flat data to tree structure
 * 3. Transformation - apply business logic to create semantic nodes and flat list
 *
 * @param messages - Flat array of messages from backend
 * @param messageGroups - Optional array of message group metadata for compare/manual grouping
 * @returns ParseResult containing messageMap, displayTree, and flatList
 */
export function parse(messages: Message[], messageGroups?: MessageGroupMetadata[]): ParseResult {
  // Phase 1: Indexing
  // Build helper maps for O(1) access patterns
  const helperMaps = buildHelperMaps(messages, messageGroups);

  // Phase 2: Structuring
  // Convert flat parent-child relationships to tree structure
  // Separates main flow from threaded conversations
  const idTree = buildIdTree(helperMaps);

  // Phase 3: Transformation
  // Apply priority-based pattern matching to create semantic display nodes
  const transformer = new Transformer(helperMaps);
  const contextTree = transformer.transformAll(idTree);

  // Phase 3b: Generate flatList for virtual list rendering
  // Implements RFC priority-based pattern matching
  const flatList = transformer.flatten(messages);

  // Convert messageMap from Map to plain object for serialization
  // Clean up metadata for assistant messages with tools
  const messageMapObj: Record<string, Message> = {};
  const usagePerformanceFields = new Set([
    'acceptedPredictionTokens',
    'cost',
    'duration',
    'inputAudioTokens',
    'inputCacheMissTokens',
    'inputCachedTokens',
    'inputCitationTokens',
    'inputImageTokens',
    'inputTextTokens',
    'inputWriteCacheTokens',
    'latency',
    'outputAudioTokens',
    'outputImageTokens',
    'outputReasoningTokens',
    'outputTextTokens',
    'rejectedPredictionTokens',
    'totalInputTokens',
    'totalOutputTokens',
    'totalTokens',
    'tps',
    'ttft',
  ]);

  helperMaps.messageMap.forEach((message, id) => {
    let processedMessage = message;

    // Transform supervisor messages: convert role from 'assistant' to 'supervisor'
    // This enables UI to render supervisor messages differently from regular assistant messages
    // Note: context-engine has SupervisorRoleRestoreProcessor to restore role='assistant' before model API call
    if (message.role === 'assistant' && message.metadata?.isSupervisor) {
      processedMessage = { ...message, role: 'supervisor' as const };
    }

    // For assistant messages with tools, clean metadata to keep only usage/performance fields
    if (
      processedMessage.role === 'assistant' &&
      processedMessage.tools &&
      processedMessage.tools.length > 0 &&
      processedMessage.metadata
    ) {
      const cleanedMetadata: Record<string, any> = {};
      Object.entries(processedMessage.metadata).forEach(([key, value]) => {
        if (usagePerformanceFields.has(key)) {
          cleanedMetadata[key] = value;
        }
      });
      messageMapObj[id] = {
        ...processedMessage,
        metadata: Object.keys(cleanedMetadata).length > 0 ? cleanedMetadata : undefined,
      };
    } else {
      messageMapObj[id] = processedMessage;
    }
  });

  // Transform supervisor messages in flatList
  // For non-grouped supervisor messages (e.g., supervisor summary without tools)
  const processedFlatList = flatList.map((msg) => {
    if (msg.role === 'assistant' && msg.metadata?.isSupervisor) {
      return { ...msg, role: 'supervisor' as const };
    }
    return msg;
  });

  return {
    contextTree,
    flatList: processedFlatList,
    messageMap: messageMapObj,
  };
}
