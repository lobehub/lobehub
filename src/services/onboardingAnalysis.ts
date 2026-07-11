import type { OnboardingAnalysisStatus, OnboardingProfileResult } from '@lobechat/types';

class OnboardingAnalysisService {
  startAnalysis = async (): Promise<void> => {
    throw new Error('onboardingAnalysisService.startAnalysis is not implemented yet');
  };

  getStatus = async (): Promise<OnboardingAnalysisStatus> => {
    throw new Error('onboardingAnalysisService.getStatus is not implemented yet');
  };

  getProfile = async (): Promise<OnboardingProfileResult | undefined> => {
    throw new Error('onboardingAnalysisService.getProfile is not implemented yet');
  };

  submitSupplement = async (text: string): Promise<void> => {
    throw new Error(`onboardingAnalysisService.submitSupplement is not implemented yet: ${text}`);
  };
}

export const onboardingAnalysisService = new OnboardingAnalysisService();
