import type { MessageMetadata } from '../message';

export interface UsageRecordItem {
  createdAt: Date;
  /**
   * ID
   **/
  id: string;
  inputStartAt?: Date | null;
  /**
   * Meta information
   **/
  metadata?: MessageMetadata | null;
  /**
   * Model id
   */
  model: string;
  outputFinishAt?: Date | null;
  outputStartAt?: Date | null;
  /**
   * Provider id
   */
  provider: string;
  /**
   * Spend
   **/
  spend: number;
  /**
   * Usage details
   **/
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
  /**
   * Performance details
   **/
  tps?: number | null;
  ttft?: number | null;
  /**
   * Call types
   **/
  type: string;
  updatedAt: Date;
  userId: string;
}

export type UsageLog = {
  date: number;
  day: string;
  records: UsageRecordItem[];
  totalRequests: number;
  totalSpend: number;
  totalTokens: number;
};

/** Time granularity for the agent usage chart buckets. */
export type AgentUsageGranularity = 'day' | 'week';

/**
 * One bar in the agent usage trend chart. Cost components are reconciled to the
 * authoritative billed cost; token components are the raw reported counts.
 * `input` cost folds the cache-read cost into it (the chart only breaks out
 * input / output / cache-write, matching the legend).
 */
export interface AgentUsageBucket {
  cacheWriteCost: number;
  cacheWriteTokens: number;
  /** Bucket start timestamp (ms), for stable sorting. */
  date: number;
  inputCost: number;
  inputTokens: number;
  /** Display label, e.g. "5/25" (day) or week-start "5/25" (week). */
  label: string;
  outputCost: number;
  outputTokens: number;
  totalCost: number;
}

export interface AgentUsageModelRow {
  cost: number;
  id: string;
  model: string;
  provider: string;
  requests: number;
  totalTokens: number;
}

export interface AgentUsageStats {
  buckets: AgentUsageBucket[];
  byModel: AgentUsageModelRow[];
  summary: {
    cacheHitRate: number;
    cacheReadTokens: number;
    cacheSavings: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    totalRequests: number;
    totalTokens: number;
  };
}
