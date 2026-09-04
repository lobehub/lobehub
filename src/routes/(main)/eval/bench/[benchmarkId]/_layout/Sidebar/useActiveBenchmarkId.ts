import { useParams } from '@/libs/router/navigation';

export const useActiveBenchmarkId = () =>
  useParams<{ benchmarkId?: string }>('benchmarkId').benchmarkId ?? '';
