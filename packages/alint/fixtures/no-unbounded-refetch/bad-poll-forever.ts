// Fixture: polls every 2 s forever while no acceptance exists, and never
// stops on a terminal status either.
import type { Acceptance } from '@/types/acceptance';

import { useFetchAcceptanceBySubject } from './useFetchAcceptanceBySubject';

const POLL_INTERVAL_MS = 2000;

export const useAcceptanceBySubject = (target: string, subjectId: string) => {
  return useFetchAcceptanceBySubject(target, subjectId, {
    // alint-expect
    refreshInterval: (_data?: Acceptance) => POLL_INTERVAL_MS,
  });
};
