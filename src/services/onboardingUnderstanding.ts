import type {
  ConfirmOnboardingUnderstandingInput,
  ConfirmOnboardingUnderstandingResult,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingTopicInput,
  RetryOnboardingUnderstandingSourceInput,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

// Typed against the feat/onboarding-understanding server contract, which is not
// merged into this branch's LambdaRouter yet. Drop this cast once rebased onto it.
interface UnderstandingProcedures {
  confirmOnboardingUnderstanding: {
    mutate: (
      input: ConfirmOnboardingUnderstandingInput,
    ) => Promise<ConfirmOnboardingUnderstandingResult>;
  };
  getOnboardingUnderstanding: {
    query: (
      input: OnboardingUnderstandingTopicInput,
    ) => Promise<OnboardingUnderstandingPollingResult>;
  };
  retryOnboardingUnderstandingSource: {
    mutate: (
      input: RetryOnboardingUnderstandingSourceInput,
    ) => Promise<OnboardingUnderstandingPollingResult>;
  };
  startOnboardingUnderstanding: {
    mutate: (
      input: OnboardingUnderstandingTopicInput,
    ) => Promise<OnboardingUnderstandingPollingResult>;
  };
}

const understandingClient = lambdaClient.user as unknown as UnderstandingProcedures;

class OnboardingUnderstandingService {
  getOnboardingTopicId = async (): Promise<string> => {
    const state = await lambdaClient.user.getOrCreateOnboardingState.query();
    return state.topicId;
  };

  start = async (topicId: string): Promise<OnboardingUnderstandingPollingResult> =>
    understandingClient.startOnboardingUnderstanding.mutate({ topicId });

  getSession = async (topicId: string): Promise<OnboardingUnderstandingPollingResult> =>
    understandingClient.getOnboardingUnderstanding.query({ topicId });

  retrySource = async (
    input: RetryOnboardingUnderstandingSourceInput,
  ): Promise<OnboardingUnderstandingPollingResult> =>
    understandingClient.retryOnboardingUnderstandingSource.mutate(input);

  confirm = async (
    input: ConfirmOnboardingUnderstandingInput,
  ): Promise<ConfirmOnboardingUnderstandingResult> =>
    understandingClient.confirmOnboardingUnderstanding.mutate(input);
}

export const onboardingUnderstandingService = new OnboardingUnderstandingService();
