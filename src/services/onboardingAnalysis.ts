class OnboardingAnalysisService {
  submitSupplement = async (_text: string): Promise<void> => {
    throw new Error('onboardingAnalysisService.submitSupplement is not implemented yet');
  };
}

export const onboardingAnalysisService = new OnboardingAnalysisService();
