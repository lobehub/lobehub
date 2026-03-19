import { type UsageLog } from '@/types/usage/usageRecord';

export interface UsageChartProps {
  data?: UsageLog[];
  dateStrings?: string;
  groupBy?: GroupBy;
  inShare?: boolean;
  isAdminView?: boolean;
  isLoading?: boolean;
  mobile?: boolean;
}

export enum GroupBy {
  Model = 'model',
  Provider = 'provider',
}
