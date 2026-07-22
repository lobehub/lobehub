import type { OnboardingAnalysisItemStatus, OnboardingAnalysisStatus } from '@lobechat/types';
import { useMemo } from 'react';

import {
  isUnderstandingFailed,
  mapUnderstandingToAnalysisStatus,
} from '../../understanding/mapping';
import { useUnderstanding } from '../../understanding/useUnderstanding';

export const LEARN_YOUR_WORLD_FACT_SLOTS = 4;

export const LEARN_YOUR_WORLD_PROGRESS_IDS = ['review', 'build', 'explore'] as const;

export interface LearnYourWorldProgressItem {
  id: (typeof LEARN_YOUR_WORLD_PROGRESS_IDS)[number];
  status: OnboardingAnalysisItemStatus;
}

export interface LearnYourWorldViewModel {
  buttonLabel: 'continue' | 'skip';
  done: boolean;
  facts: OnboardingAnalysisStatus['facts'];
  failed: boolean;
  progressItems: LearnYourWorldProgressItem[];
  retry: () => Promise<void>;
  retrying: boolean;
  skeletonCount: number;
}

export const buildLearnYourWorldViewModel = (
  status: OnboardingAnalysisStatus | undefined,
): Omit<LearnYourWorldViewModel, 'failed' | 'retry' | 'retrying'> => {
  const facts = status?.facts ?? [];
  const skeletonCount = Math.max(0, LEARN_YOUR_WORLD_FACT_SLOTS - facts.length);
  const progressItems = LEARN_YOUR_WORLD_PROGRESS_IDS.map((id) => ({
    id,
    status: status?.items.find((item) => item.id === id)?.status ?? 'pending',
  }));
  const done = status?.done ?? false;

  return { buttonLabel: done ? 'continue' : 'skip', done, facts, progressItems, skeletonCount };
};

export const useLearnYourWorldAnalysis = (): LearnYourWorldViewModel => {
  const { error, result, retry, retrying } = useUnderstanding();

  const status = useMemo(() => mapUnderstandingToAnalysisStatus(result), [result]);
  const failed = !!error || isUnderstandingFailed(result);

  return useMemo(
    () => ({ ...buildLearnYourWorldViewModel(status), failed, retry, retrying }),
    [status, failed, retry, retrying],
  );
};
