// Fixture: the poll stops on a terminal status, slows down while nothing
// exists, and shares one request across components.
import type { Acceptance } from '@/types/acceptance';

import { isTerminalAcceptance } from './status';
import { useFetchAcceptanceBySubject } from './useFetchAcceptanceBySubject';

const ACCEPTANCE_ABSENT_REFRESH_MS = 60_000;
const ACCEPTANCE_RUNNING_REFRESH_MS = 5000;
const ACCEPTANCE_POLL_DEDUPE_MS = 4500;

export const useAcceptanceBySubject = (target: string, subjectId: string) => {
  return useFetchAcceptanceBySubject(target, subjectId, {
    dedupingInterval: ACCEPTANCE_POLL_DEDUPE_MS,
    refreshInterval: (data?: Acceptance) => {
      if (!data) return ACCEPTANCE_ABSENT_REFRESH_MS;
      return isTerminalAcceptance(data.status) ? 0 : ACCEPTANCE_RUNNING_REFRESH_MS;
    },
  });
};
