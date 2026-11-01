import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useEvalStore } from '@/store/eval';

import { useActiveBenchmarkId } from '../useActiveBenchmarkId';

const resolveActiveKey = (pathname: string) => {
  const datasetMatch = pathname.match(/\/eval\/bench\/[^/]+\/datasets\/([^/]+)/);
  if (datasetMatch) return `dataset-${datasetMatch[1]}`;

  const runMatch = pathname.match(/\/eval\/bench\/[^/]+\/runs\/([^/]+)/);
  if (runMatch) return `run-${runMatch[1]}`;

  if (/\/eval\/bench\/[^/]+\/?$/.test(pathname)) return 'overview';

  return '';
};

export const useActiveBenchmarkSidebarRoute = () => {
  const benchmarkId = useActiveBenchmarkId();
  const { pathname } = useActiveLocation();
  const useFetchDatasets = useEvalStore((state) => state.useFetchDatasets);
  const useFetchRuns = useEvalStore((state) => state.useFetchRuns);

  useFetchDatasets(benchmarkId || undefined);
  useFetchRuns(benchmarkId || undefined);

  return { activeKey: resolveActiveKey(pathname), benchmarkId };
};
