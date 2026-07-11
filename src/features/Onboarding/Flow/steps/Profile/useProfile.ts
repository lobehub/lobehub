import type { OnboardingProfileResult } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { onboardingKeys } from '@/libs/swr/keys';
import { onboardingAnalysisService } from '@/services/onboardingAnalysis';

export const useProfile = () => {
  const { data, isLoading } = useClientDataSWR<OnboardingProfileResult | undefined>(
    onboardingKeys.profile(),
    () => onboardingAnalysisService.getProfile(),
    { shouldRetryOnError: false },
  );

  return { isLoading, profile: data };
};
