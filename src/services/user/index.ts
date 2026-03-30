import { type PartialDeep } from 'type-fest';

import { lambdaClient } from '@/libs/trpc/client';
import {
  type SaveUserQuestionInput,
  type SSOProvider,
  type UserAgentOnboarding,
  type UserAgentOnboardingContext,
  type UserGuide,
  type UserInitializationState,
  type UserOnboarding,
  type UserPreference,
} from '@/types/user';
import { type UserSettings } from '@/types/user/settings';

export class UserService {
  getUserRegistrationDuration = async (): Promise<{
    createdAt: string;
    duration: number;
    updatedAt: string;
  }> => {
    return lambdaClient.user.getUserRegistrationDuration.query();
  };

  getUserState = async (): Promise<UserInitializationState> => {
    return lambdaClient.user.getUserState.query();
  };

  getUserSSOProviders = async (): Promise<SSOProvider[]> => {
    return lambdaClient.user.getUserSSOProviders.query();
  };

  getOrCreateOnboardingState = async (): Promise<{
    agentId: string;
    agentOnboarding: UserAgentOnboarding;
    context: UserAgentOnboardingContext;
    topicId: string;
  }> => {
    return lambdaClient.user.getOrCreateOnboardingState.query();
  };

  getOnboardingState = async (): Promise<UserAgentOnboardingContext> => {
    return lambdaClient.user.getOnboardingState.query();
  };

  saveUserQuestion = async (params: SaveUserQuestionInput) => {
    return lambdaClient.user.saveUserQuestion.mutate(
      params as Parameters<typeof lambdaClient.user.saveUserQuestion.mutate>[0],
    );
  };

  finishOnboarding = async () => {
    return lambdaClient.user.finishOnboarding.mutate({});
  };

  readOnboardingDocument = async (type: 'soul' | 'persona') => {
    return lambdaClient.user.readOnboardingDocument.query({ type });
  };

  updateOnboardingDocument = async (type: 'soul' | 'persona', content: string) => {
    return lambdaClient.user.updateOnboardingDocument.mutate({ content, type });
  };

  makeUserOnboarded = async () => {
    return lambdaClient.user.makeUserOnboarded.mutate();
  };

  resetAgentOnboarding = async () => {
    return lambdaClient.user.resetAgentOnboarding.mutate();
  };

  updateAgentOnboarding = async (agentOnboarding: UserAgentOnboarding) => {
    return lambdaClient.user.updateAgentOnboarding.mutate(agentOnboarding);
  };

  updateOnboarding = async (onboarding: UserOnboarding) => {
    return lambdaClient.user.updateOnboarding.mutate(onboarding);
  };

  updateAvatar = async (avatar: string) => {
    return lambdaClient.user.updateAvatar.mutate(avatar);
  };

  updateInterests = async (interests: string[]) => {
    return lambdaClient.user.updateInterests.mutate(interests);
  };

  updateFullName = async (fullName: string) => {
    return lambdaClient.user.updateFullName.mutate(fullName);
  };

  updateUsername = async (username: string) => {
    return lambdaClient.user.updateUsername.mutate(username);
  };

  updatePreference = async (preference: Partial<UserPreference>) => {
    return lambdaClient.user.updatePreference.mutate(preference);
  };

  updateGuide = async (guide: Partial<UserGuide>) => {
    return lambdaClient.user.updateGuide.mutate(guide);
  };

  updateUserSettings = async (value: PartialDeep<UserSettings>, signal?: AbortSignal) => {
    return lambdaClient.user.updateSettings.mutate(value, { signal });
  };

  resetUserSettings = async () => {
    return lambdaClient.user.resetSettings.mutate();
  };
}

export const userService = new UserService();
