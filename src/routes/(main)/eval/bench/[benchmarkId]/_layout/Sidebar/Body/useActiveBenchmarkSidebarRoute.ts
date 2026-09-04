import { useEvalStore } from '@/store/eval';
import { routerSelectors, useRouterStore } from '@/store/router';

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
  const pathname = useRouterStore(routerSelectors.pathname);
  const useFetchDatasets = useEvalStore((state) => state.useFetchDatasets);
  const useFetchRuns = useEvalStore((state) => state.useFetchRuns);

  useFetchDatasets(benchmarkId || undefined);
  useFetchRuns(benchmarkId || undefined);

  return { activeKey: resolveActiveKey(pathname), benchmarkId };
};
