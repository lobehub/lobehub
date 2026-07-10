import type { ChatTopicStatus } from '@/types/topic';

import type { FleetColumn } from './types';

interface GetIdleColumnKeysParams {
  columns: FleetColumn[];
  isStatusLoading?: boolean;
  statusByColumnKey: Record<string, ChatTopicStatus | undefined>;
}

export const getIdleColumnKeys = ({
  columns,
  isStatusLoading,
  statusByColumnKey,
}: GetIdleColumnKeysParams): string[] => {
  if (isStatusLoading) return [];

  return columns.filter((column) => statusByColumnKey[column.key] !== 'running').map((c) => c.key);
};
