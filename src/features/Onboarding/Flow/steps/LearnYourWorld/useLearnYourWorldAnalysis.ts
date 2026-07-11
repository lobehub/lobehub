import type { OnboardingAnalysisItemStatus, OnboardingAnalysisStatus } from '@lobechat/types';
import { useEffect, useMemo } from 'react';

import { useClientPollingSWR } from '@/libs/swr';
import { onboardingKeys } from '@/libs/swr/keys';
import { onboardingAnalysisService } from '@/services/onboardingAnalysis';

export const LEARN_YOUR_WORLD_FACT_SLOTS = 4;

export const LEARN_YOUR_WORLD_PROGRESS_IDS = ['review', 'build', 'explore'] as const;

const POLL_INTERVAL = 3000;

export interface LearnYourWorldProgressItem {
  id: (typeof LEARN_YOUR_WORLD_PROGRESS_IDS)[number];
  status: OnboardingAnalysisItemStatus;
}

export interface LearnYourWorldViewModel {
  buttonLabel: 'continue' | 'skip';
  done: boolean;
  facts: OnboardingAnalysisStatus['facts'];
  progressItems: LearnYourWorldProgressItem[];
  skeletonCount: number;
}

export const buildLearnYourWorldViewModel = (
  status: OnboardingAnalysisStatus | undefined,
): LearnYourWorldViewModel => {
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
  useEffect(() => {
    onboardingAnalysisService.startAnalysis().catch(() => undefined);
  }, []);

  const { data } = useClientPollingSWR<OnboardingAnalysisStatus>(
    onboardingKeys.analysisStatus(),
    () => onboardingAnalysisService.getStatus(),
    {
      refreshInterval: (latest) => (latest && !latest.done ? POLL_INTERVAL : 0),
      shouldRetryOnError: false,
    },
  );

  return useMemo(() => buildLearnYourWorldViewModel(data), [data]);
};
