import type { AgentEvalRunListItem } from '@lobechat/types';
import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';

import { sortRunsNewestFirst } from './runHelpers';

/**
 * The newest runs across every benchmark and dataset (the server caps the page
 * at 50). Keyed on `evalKeys.runs()` so `refreshRuns()` without a benchmark id
 * revalidates it alongside the benchmark-scoped lists.
 */
export const useRecentRuns = () => {
  const swr = useClientDataSWR(evalKeys.runs(), () => agentEvalService.listRuns({}));

  const runs = useMemo(
    () => sortRunsNewestFirst((swr.data?.data ?? []) as AgentEvalRunListItem[]),
    [swr.data],
  );

  return { ...swr, runs };
};
