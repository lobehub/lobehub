import type { OnboardingUserInfo } from '@lobechat/context-engine';
import { type MarkdownPatchHunk } from '@lobechat/markdown-patch';
import type {
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingPollingResult,
  RetryOnboardingUnderstandingProviderInput,
  ReviseOnboardingUnderstandingInput,
  StartOnboardingUnderstandingInput,
} from '@lobechat/types';
import { type PartialDeep } from 'type-fest';

import { lambdaClient } from '@/libs/trpc/client';
import {
  type SaveUserQuestionInput,
  type SSOProvider,
  type UserGuide,
  type UserInitializationState,
  type UserOnboarding,
  type UserPreference,
} from '@/types/user';
import { type UserSettings } from '@/types/user/settings';

export class UserService {
  confirmOnboardingUnderstanding = async (input: ConfirmOnboardingUnderstandingInput) => {
    return lambdaClient.user.confirmOnboardingUnderstanding.mutate(input);
  };

  getOnboardingUnderstanding = async (
    topicId: string,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    return lambdaClient.user.getOnboardingUnderstanding.query({ topicId });
  };

  getUserActivitySummary = async (): Promise<{
    lastUserMessageAt: Date | null;
    userCreatedAt: Date | null;
  }> => {
    return lambdaClient.user.getUserActivitySummary.query();
  };

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

  getOnboardingAgentContext = async (): Promise<{
    personaContent: string | null;
    phaseGuidance: string;
    soulContent: string | null;
    userInfo?: OnboardingUserInfo;
  }> => {
    return lambdaClient.user.getOnboardingAgentContext.query();
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

  patchOnboardingDocument = async (type: 'soul' | 'persona', hunks: MarkdownPatchHunk[]) => {
    return lambdaClient.user.patchOnboardingDocument.mutate({ hunks, type });
  };

  retryOnboardingUnderstandingSource = async (
    input: RetryOnboardingUnderstandingProviderInput,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    return lambdaClient.user.retryOnboardingUnderstandingSource.mutate(input);
  };

  reviseOnboardingUnderstanding = async (
    input: ReviseOnboardingUnderstandingInput,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    return lambdaClient.user.reviseOnboardingUnderstanding.mutate(input);
  };

  startOnboardingUnderstanding = async (
    input: StartOnboardingUnderstandingInput,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    return lambdaClient.user.startOnboardingUnderstanding.mutate(input);
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

  updateToolIntervention = async (value: {
    appendAllowList?: string[];
    approvalMode?: 'auto-run' | 'allow-list' | 'manual';
  }) => {
    return lambdaClient.user.updateToolIntervention.mutate(value);
  };

  updateUninstalledBuiltinTools = async (
    uninstalledBuiltinTools: string[],
    workspaceId: string | null,
  ) => {
    return lambdaClient.user.updateUninstalledBuiltinTools.mutate({
      uninstalledBuiltinTools,
      workspaceId,
    });
  };

  updateUserSettings = async (value: PartialDeep<UserSettings>, signal?: AbortSignal) => {
    return lambdaClient.user.updateSettings.mutate(value, { signal });
  };

  resetUserSettings = async () => {
    return lambdaClient.user.resetSettings.mutate();
  };
}

export const userService = new UserService();
