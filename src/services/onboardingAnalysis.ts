import type { OnboardingAnalysisStatus, OnboardingProfileResult } from '@lobechat/types';

const MOCK_PROFILE: OnboardingProfileResult = {
  identity: [
    'You shepherd research-grade AIGC prototypes into shipping editor products, switching fluidly between low-level engineering and product design while keeping a vigilant eye on visual polish and maintainability.',
    'You read like someone who enjoys turning rough systems into something dependable, legible, and pleasant to live with. You identify primarily as a designer with exacting aesthetic standards, and you also hold a licensed real-estate practice on the side.',
  ],
  name: 'Canis Minor',
  subtitle: 'Pragmatic designer-engineer who ships research-grade editors',
  tagline:
    "You move prototypes to polish with a designer's eye, an engineer's rigor, and a steady instinct for making systems durable across every runtime they touch.",
};

class OnboardingAnalysisService {
  startAnalysis = async (): Promise<void> => {
    throw new Error('onboardingAnalysisService.startAnalysis is not implemented yet');
  };

  getStatus = async (): Promise<OnboardingAnalysisStatus> => {
    throw new Error('onboardingAnalysisService.getStatus is not implemented yet');
  };

  getProfile = async (): Promise<OnboardingProfileResult | undefined> => MOCK_PROFILE;

  submitSupplement = async (_text: string): Promise<void> => {
    throw new Error('onboardingAnalysisService.submitSupplement is not implemented yet');
  };
}

export const onboardingAnalysisService = new OnboardingAnalysisService();
