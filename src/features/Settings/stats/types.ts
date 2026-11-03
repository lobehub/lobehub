import { type UsageLog } from '@/types/usage/usageRecord';

export interface UserDisplay {
  avatar?: string | null;
  name: string;
}

export type UserDisplayResolver = (userId: string) => UserDisplay;

export interface UsageChartProps {
  data?: UsageLog[];
  dateStrings?: string;
  groupBy?: GroupBy;
  inShare?: boolean;
  isLoading?: boolean;
  mobile?: boolean;
  /** Resolve a userId to a display name + avatar. Used by `GroupBy.User`. */
  resolveUser?: UserDisplayResolver;
}

export enum GroupBy {
  Model = 'model',
  Provider = 'provider',
  User = 'user',
}

export enum HeatmapType {
  Messages = 'messages',
  Tokens = 'tokens',
}
