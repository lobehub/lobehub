import {
  type AssistantContentBlock,
  type ModelUsage,
  type TaskCurrentActivity,
} from '@lobechat/types';
import { ThreadStatus } from '@lobechat/types';
import { formatDuration as formatDurationMs, formatElapsedClockTime } from '@lobechat/utils';

/**
 * Format duration in milliseconds to human-readable string
 * @param duration Duration in milliseconds
 * @returns Formatted string like "500ms", "1.5s", "2m 30s", "1h 5m", "1d 2h 5m"
 */
export const formatDuration = (duration: number | undefined | null): string | null => {
  if (!duration) return null;
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60_000) return `${(duration / 1000).toFixed(1)}s`;
  return formatDurationMs(Math.round(duration / 1000) * 1000);
};

/**
 * Format cost to currency string
 * @param cost Cost value
 * @returns Formatted string like "$0.0001" or "$1.23"
 */
export const formatCost = (cost: number | undefined | null): string | null => {
  if (!cost) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

/**
 * Format elapsed time in milliseconds as a running clock
 * @param ms Milliseconds
 * @returns Formatted string like "02:30", "1:02:30" or "1d 01:02:30"
 */
export const formatElapsedTime = (ms: number): string => formatElapsedClockTime(ms);

/**
 * Format tool name from activity identifier and apiName
 * @param activity Task current activity
 * @returns Formatted tool name like "identifier/apiName" or fallback
 */
export const formatToolName = (activity: TaskCurrentActivity): string => {
  if (activity.identifier && activity.apiName) {
    return `${activity.identifier}/${activity.apiName}`;
  }
  return activity.identifier || activity.apiName || '';
};

/**
 * Check if status is a processing state
 * @param status Thread status
 * @returns true if status is processing, in review, pending, active, or todo
 */
export const isProcessingStatus = (status?: ThreadStatus): boolean => {
  if (!status) return false;
  return (
    status === ThreadStatus.Processing ||
    status === ThreadStatus.InReview ||
    status === ThreadStatus.Pending ||
    status === ThreadStatus.Active ||
    status === ThreadStatus.Todo
  );
};

/**
 * Accumulate usage from all blocks
 */
export const accumulateUsage = (blocks: AssistantContentBlock[]): ModelUsage => {
  return blocks.reduce((acc, block) => {
    const usage = block.usage;
    if (!usage) return acc;
    return {
      cost: (acc.cost || 0) + (usage.cost || 0),
      totalInputTokens: (acc.totalInputTokens || 0) + (usage.totalInputTokens || 0),
      totalOutputTokens: (acc.totalOutputTokens || 0) + (usage.totalOutputTokens || 0),
      totalTokens: (acc.totalTokens || 0) + (usage.totalTokens || 0),
    };
  }, {} as ModelUsage);
};
