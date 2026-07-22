import { useCallback, useMemo } from 'react';

import { isUnderstandingDone, mapUnderstandingToProfile } from '../../understanding/mapping';
import { useUnderstanding } from '../../understanding/useUnderstanding';

export const useProfile = () => {
  const { confirm, error, result } = useUnderstanding();

  const profile = useMemo(() => mapUnderstandingToProfile(result), [result]);
  const isLoading =
    !profile && !error && !isUnderstandingDone(result) && result?.status !== 'failed';

  const confirmProfile = useCallback(async () => {
    try {
      await confirm();
    } catch (error) {
      console.error('[Onboarding] Failed to confirm understanding result:', error);
    }
  }, [confirm]);

  return { confirmProfile, isLoading, profile };
};
