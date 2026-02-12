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
