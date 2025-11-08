import {
  AssistantContentBlock,
  ChatToolPayloadWithResult,
  MessageMetadata,
  ModelPerformance,
  ModelUsage,
  UIChatMessage,
} from '@lobechat/types';

/**
 * Split MessageMetadata into usage and performance
 */
function splitMetadata(metadata?: MessageMetadata | null): {
  performance?: ModelPerformance;
  usage?: ModelUsage;
} {
  if (!metadata) return {};

  const usage: ModelUsage = {};
  const performance: ModelPerformance = {};

  // Extract usage fields (tokens and cost)
  const usageFields = [
    'inputCachedTokens',
    'inputCacheMissTokens',
    'inputWriteCacheTokens',
    'inputTextTokens',
    'inputImageTokens',
    'inputAudioTokens',
    'inputCitationTokens',
    'outputTextTokens',
    'outputImageTokens',
    'outputAudioTokens',
    'outputReasoningTokens',
    'acceptedPredictionTokens',
    'rejectedPredictionTokens',
    'totalInputTokens',
    'totalOutputTokens',
    'totalTokens',
    'cost',
  ] as const;

  let hasUsage = false;
  usageFields.forEach((field) => {
    if (metadata[field] !== undefined) {
      usage[field] = metadata[field] as any;
      hasUsage = true;
    }
  });

  // Extract performance fields
  const performanceFields = ['tps', 'ttft', 'duration', 'latency'] as const;
  let hasPerformance = false;
  performanceFields.forEach((field) => {
    if (metadata[field] !== undefined) {
      performance[field] = metadata[field];
      hasPerformance = true;
    }
  });

  return {
    performance: hasPerformance ? performance : undefined,
    usage: hasUsage ? usage : undefined,
  };
}

/**
 * Aggregate metadata from all children blocks
 * Creates structured usage and performance metrics
 */
function aggregateMetadata(
  children: AssistantContentBlock[],
): { performance?: ModelPerformance; usage?: ModelUsage } | null {
  const usage: ModelUsage = {};
  const performance: ModelPerformance = {};
  let hasUsageData = false;
  let hasPerformanceData = false;
  let tpsSum = 0;
  let tpsCount = 0;

  children.forEach((child) => {
    // Aggregate usage metrics (tokens and cost)
    if (child.usage) {
      const tokenFields = [
        'inputCachedTokens',
        'inputCacheMissTokens',
        'inputWriteCacheTokens',
        'inputTextTokens',
        'inputImageTokens',
        'inputAudioTokens',
        'inputCitationTokens',
        'outputTextTokens',
        'outputImageTokens',
        'outputAudioTokens',
        'outputReasoningTokens',
        'acceptedPredictionTokens',
        'rejectedPredictionTokens',
        'totalInputTokens',
        'totalOutputTokens',
        'totalTokens',
      ] as const;

      tokenFields.forEach((field) => {
        if (typeof child.usage![field] === 'number') {
          usage[field] = (usage[field] || 0) + child.usage![field]!;
          hasUsageData = true;
        }
      });

      if (typeof child.usage.cost === 'number') {
        usage.cost = (usage.cost || 0) + child.usage.cost;
        hasUsageData = true;
      }
    }

    // Aggregate performance metrics
    // - ttft: use the first child's value (time to first token)
    // - tps: calculate average across all children
    // - duration: sum all durations
    // - latency: sum all latencies
    if (child.performance) {
      if (child.performance.ttft !== undefined && performance.ttft === undefined) {
        performance.ttft = child.performance.ttft; // First child only
        hasPerformanceData = true;
      }
      if (typeof child.performance.tps === 'number') {
        tpsSum += child.performance.tps;
        tpsCount += 1;
        hasPerformanceData = true;
      }
      if (child.performance.duration !== undefined) {
        performance.duration = (performance.duration || 0) + child.performance.duration;
        hasPerformanceData = true;
      }
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

  // Return null if no data
  if (!hasUsageData && !hasPerformanceData) return null;

  // Return structured metrics
  const result: { performance?: ModelPerformance; usage?: ModelUsage } = {};
  if (hasUsageData) result.usage = usage;
  if (hasPerformanceData) result.performance = performance;

  return result;
}

/**
 * Group assistant messages with their tool results
 * Converts flat message list into grouped structure with children
 *
 * @param messages - Flat message list from database query
 * @returns Grouped message list with assistant children populated
 */
export function groupAssistantMessages(messages: UIChatMessage[]): UIChatMessage[] {
  const result: UIChatMessage[] = [];
  const toolMessageIds = new Set<string>();
  const processedAssistantIds = new Set<string>();

  // 1. Create tool_call_id -> tool message mapping
  const toolMessageMap = new Map<string, UIChatMessage>();
  messages.forEach((msg) => {
    if (msg.role === 'tool' && msg.tool_call_id) {
      toolMessageMap.set(msg.tool_call_id, msg);
    }
  });

  // 2. Build message ID -> message mapping for quick lookup
  const messageMap = new Map<string, UIChatMessage>();
  messages.forEach((msg) => {
    messageMap.set(msg.id, msg);
  });

  // 3. Find follow-up assistants that have tool messages as parent
  // Map: tool message id -> follow-up assistant messages
  const toolToFollowUpAssistants = new Map<string, UIChatMessage[]>();
  messages.forEach((msg) => {
    if (msg.role === 'assistant' && msg.parentId) {
      const parent = messageMap.get(msg.parentId);
      if (parent && parent.role === 'tool') {
        const existing = toolToFollowUpAssistants.get(msg.parentId) || [];
        toolToFollowUpAssistants.set(msg.parentId, [...existing, msg]);
      }
    }
  });

  // 4. Process messages
  messages.forEach((msg) => {
    // Skip tool messages that have been merged
    if (msg.role === 'tool') {
      if (!toolMessageIds.has(msg.id)) {
        result.push(msg);
      }
      return;
    }

    // Handle non-assistant messages
    if (msg.role !== 'assistant') {
      result.push(msg);
      return;
    }

    // Skip assistant messages that have been processed as follow-ups
    if (processedAssistantIds.has(msg.id)) {
      return;
    }

    // 5. Process assistant messages
    const assistantMsg = { ...msg };

    // If no tools, add as-is (unless it's a follow-up, which should have been skipped above)
    if (!msg.tools || msg.tools.length === 0) {
      result.push(assistantMsg);
      return;
    }

    // 6. Build children structure
    const children: AssistantContentBlock[] = [];

    // First child: original assistant with tool results
    const toolsWithResults: ChatToolPayloadWithResult[] = msg.tools.map((tool) => {
      const toolMsg = toolMessageMap.get(tool.id);

      if (toolMsg) {
        // Mark tool message as merged
        toolMessageIds.add(toolMsg.id);

        return {
          ...tool,
          result: {
            content: toolMsg.content,
            error: toolMsg.pluginError,
            id: toolMsg.id,
            state: toolMsg.pluginState,
          },
        };
      }

      // Tool message not yet available (still executing)
      return tool;
    });

    const { usage: msgUsage, performance: msgPerformance } = splitMetadata(msg.metadata);
    children.push({
      content: msg.content || '',
      fileList: msg.fileList && msg.fileList.length > 0 ? msg.fileList : undefined,
      id: msg.id,
      imageList: msg.imageList && msg.imageList.length > 0 ? msg.imageList : undefined,
      performance: msgPerformance,
      tools: toolsWithResults,
      usage: msgUsage,
    });

    // 7. Recursively add follow-up assistants as additional children
    // Keep track of tool result IDs that are part of this group
    const groupToolResultIds = new Set<string>();
    toolsWithResults.forEach((tool) => {
      if (tool.result) {
        groupToolResultIds.add(tool.result.id);
      }
    });

    // Recursively collect all follow-up assistants
    const collectFollowUpAssistants = (currentToolResultIds: Set<string>): void => {
      const newToolResultIds = new Set<string>();

      currentToolResultIds.forEach((toolResultId) => {
        const followUps = toolToFollowUpAssistants.get(toolResultId) || [];
        followUps.forEach((followUpMsg) => {
          // Skip if already processed
          if (processedAssistantIds.has(followUpMsg.id)) return;

          // Process follow-up assistant's tools and fill in their results
          const followUpToolsWithResults: ChatToolPayloadWithResult[] | undefined =
            followUpMsg.tools?.map((followUpTool) => {
              const followUpToolMsg = toolMessageMap.get(followUpTool.id);

              if (followUpToolMsg) {
                // Mark tool message as merged
                toolMessageIds.add(followUpToolMsg.id);
                // Track this tool result for next iteration
                newToolResultIds.add(followUpToolMsg.id);

                return {
                  ...followUpTool,
                  result: {
                    content: followUpToolMsg.content,
                    error: followUpToolMsg.pluginError,
                    id: followUpToolMsg.id,
                    state: followUpToolMsg.pluginState,
                  },
                };
              }

              // Tool message not yet available
              return followUpTool;
            });

          const { usage: followUpUsage, performance: followUpPerformance } = splitMetadata(
            followUpMsg.metadata,
          );
          children.push({
            content: followUpMsg.content || '',
            fileList:
              followUpMsg.fileList && followUpMsg.fileList.length > 0
                ? followUpMsg.fileList
                : undefined,
            id: followUpMsg.id,
            imageList:
              followUpMsg.imageList && followUpMsg.imageList.length > 0
                ? followUpMsg.imageList
                : undefined,
            performance: followUpPerformance,
            tools: followUpToolsWithResults,
            usage: followUpUsage,
          });
          processedAssistantIds.add(followUpMsg.id);
        });
      });

      // Recursively process the next level
      if (newToolResultIds.size > 0) {
        collectFollowUpAssistants(newToolResultIds);
      }
    };

    collectFollowUpAssistants(groupToolResultIds);

    // 8. Aggregate usage and performance from all children
    const aggregated = aggregateMetadata(children);

    // 9. Set children and aggregated metrics
    assistantMsg.role = 'group';
    assistantMsg.children = children;
    if (aggregated) {
      assistantMsg.usage = aggregated.usage;
      assistantMsg.performance = aggregated.performance;
    }
    delete assistantMsg.metadata; // Clear individual metadata
    delete assistantMsg.tools;
    delete assistantMsg.imageList;
    delete assistantMsg.fileList;
    assistantMsg.content = ''; // Content moved to children

    result.push(assistantMsg);
  });

  return result;
}
