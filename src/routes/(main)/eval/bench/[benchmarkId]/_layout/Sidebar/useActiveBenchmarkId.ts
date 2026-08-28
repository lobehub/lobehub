import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

export const useActiveBenchmarkId = () =>
  useActiveRouteParams<{ benchmarkId?: string }>().benchmarkId ?? '';
