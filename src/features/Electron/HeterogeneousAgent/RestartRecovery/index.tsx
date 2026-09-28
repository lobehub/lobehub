import { toast } from '@lobehub/ui/base-ui';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

import { recoverInterruptedHeteroRuns } from './recoverInterruptedRuns';

/**
 * Render-less. Once the signed-in user state is ready, asks desktop main for
 * the local CLI runs the previous process left in flight and picks them up
 * (transcript replay, then `--resume` when the turn was cut off). Runs once
 * per renderer boot: main hands the ledger over exactly once, so a second
 * call would find nothing anyway.
 */
const RestartRecovery = memo(() => {
  const { t } = useTranslation('chat');
  const isReady = useUserStore((s) => s.isUserStateInit && !!s.isSignedIn);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isReady || startedRef.current) return;
    startedRef.current = true;

    void recoverInterruptedHeteroRuns()
      .then((results) => {
        const recovered = results.filter(
          (result) => result.outcome === 'replayed' || result.outcome === 'resumed',
        ).length;
        if (recovered > 0) {
          toast.info(t('heteroAgent.restartRecovery.resumed', { count: recovered }));
        }
      })
      .catch((error) => {
        console.error('[restartRecovery] failed:', error);
      });
  }, [isReady, t]);

  return null;
});

RestartRecovery.displayName = 'HeteroRestartRecovery';

export default RestartRecovery;
