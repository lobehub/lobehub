'use client';

import type { ReactNode } from 'react';
import { memo } from 'react';

import type { AcceptanceBundle } from '@/services/verify';
import { useVerifyStore, verifySelectors } from '@/store/verify';

interface GoalAcceptanceRenderState {
  bundle?: AcceptanceBundle;
  error?: unknown;
  isLoading: boolean;
  retry: () => void;
}

interface GoalAcceptanceProps {
  children: (state: GoalAcceptanceRenderState) => ReactNode;
  taskId: string;
}

export const GoalAcceptance = memo<GoalAcceptanceProps>(({ children, taskId }) => {
  const useFetchAcceptanceBySubject = useVerifyStore((s) => s.useFetchAcceptanceBySubject);
  const useFetchAcceptanceBundle = useVerifyStore((s) => s.useFetchAcceptanceBundle);
  const acceptance = useVerifyStore(verifySelectors.acceptanceBySubject('task', taskId));
  const bundle = useVerifyStore(verifySelectors.acceptanceBundle(acceptance?.id));
  const acceptanceQuery = useFetchAcceptanceBySubject('task', taskId);
  const bundleQuery = useFetchAcceptanceBundle(acceptance?.id);

  return children({
    bundle,
    error: acceptanceQuery.error || bundleQuery.error,
    isLoading: acceptanceQuery.isLoading || (!!acceptance?.id && bundleQuery.isLoading),
    retry: () => {
      void acceptanceQuery.mutate();
      if (acceptance?.id) void bundleQuery.mutate();
    },
  });
});

GoalAcceptance.displayName = 'GoalAcceptance';
