import { CURRENT_ONBOARDING_VERSION, INBOX_SESSION_ID } from '@lobechat/const';
import type { StateCreator } from 'zustand/vanilla';

import { userService } from '@/services/user';
import { getAgentStoreState } from '@/store/agent';
import type { UserStore } from '@/store/user';

import { settingsSelectors } from '../settings/selectors';
import { onboardingSelectors } from './selectors';

export interface OnboardingAction {
  finishOnboarding: () => Promise<void>;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  /**
   * Internal method to process the step update queue
   */
  internal_processStepUpdateQueue: () => Promise<void>;
  /**
   * Internal method to queue a step update
   */
  internal_queueStepUpdate: (step: number) => void;
  setOnboardingStep: (step: number) => Promise<void>;
  /**
   * Toggle plugin in default agent config for onboarding
   */
  toggleInboxAgentDefaultPlugin: (id: string, open?: boolean) => Promise<void>;
  /**
   * Update default model for both user settings and inbox agent
   */
  updateDefaultModel: (model: string, provider: string) => Promise<void>;
}

export const createOnboardingSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  OnboardingAction
> = (set, get) => ({
  finishOnboarding: async () => {
    const currentStep = onboardingSelectors.currentStep(get());

    await userService.updateOnboarding({
      currentStep,
      finishedAt: new Date().toISOString(),
      version: CURRENT_ONBOARDING_VERSION,
    });

    await get().refreshUserState();
  },

  goToNextStep: () => {
    const currentStep = onboardingSelectors.currentStep(get());
    const nextStep = currentStep + 1;

    // Optimistic update: immediately update local state
    set({ localOnboardingStep: nextStep }, false, 'goToNextStep/optimistic');

    // Queue the server update
    get().internal_queueStepUpdate(nextStep);
  },

  goToPreviousStep: () => {
    const currentStep = onboardingSelectors.currentStep(get());
    if (currentStep <= 1) return;

    const prevStep = currentStep - 1;

    // Optimistic update: immediately update local state
    set({ localOnboardingStep: prevStep }, false, 'goToPreviousStep/optimistic');

    // Queue the server update
    get().internal_queueStepUpdate(prevStep);
  },

  internal_processStepUpdateQueue: async () => {
    const { isProcessingStepQueue, stepUpdateQueue } = get();
    if (isProcessingStepQueue || stepUpdateQueue.length === 0) return;

    set({ isProcessingStepQueue: true }, false, 'processStepUpdateQueue/start');

    while (get().stepUpdateQueue.length > 0) {
      const step = get().stepUpdateQueue[0];
      const finishedAt = onboardingSelectors.finishedAt(get());

      try {
        await userService.updateOnboarding({
          currentStep: step,
          finishedAt,
          version: CURRENT_ONBOARDING_VERSION,
        });
      } catch (error) {
        console.error('Failed to update onboarding step:', error);
      }

      // Remove the completed task
      set(
        { stepUpdateQueue: get().stepUpdateQueue.slice(1) },
        false,
        'processStepUpdateQueue/shift',
      );
    }

    set({ isProcessingStepQueue: false }, false, 'processStepUpdateQueue/end');

    // Sync with server state after all updates complete
    await get().refreshUserState();
  },

  internal_queueStepUpdate: (step) => {
    const { stepUpdateQueue } = get();

    if (stepUpdateQueue.length === 0) {
      // Queue is empty, add task and start processing
      set({ stepUpdateQueue: [step] }, false, 'queueStepUpdate/push');
      get().internal_processStepUpdateQueue();
    } else if (stepUpdateQueue.length === 1) {
      // One task is executing, add as pending
      set({ stepUpdateQueue: [...stepUpdateQueue, step] }, false, 'queueStepUpdate/push');
    } else {
      // Queue is full (length >= 2), replace the pending task
      set({ stepUpdateQueue: [stepUpdateQueue[0], step] }, false, 'queueStepUpdate/replace');
    }
  },

  setOnboardingStep: async (step) => {
    // Optimistic update
    set({ localOnboardingStep: step }, false, 'setOnboardingStep/optimistic');

    const finishedAt = onboardingSelectors.finishedAt(get());
    await userService.updateOnboarding({
      currentStep: step,
      finishedAt,
      version: CURRENT_ONBOARDING_VERSION,
    });

    await get().refreshUserState();
  },

  toggleInboxAgentDefaultPlugin: async (id, open) => {
    const currentSettings = settingsSelectors.currentSettings(get());
    const currentPlugins = currentSettings.defaultAgent?.config?.plugins || [];

    const index = currentPlugins.indexOf(id);
    const shouldOpen = open !== undefined ? open : index === -1;

    const agentStore = getAgentStoreState();
    const inboxAgentId = agentStore.builtinAgentIdMap[INBOX_SESSION_ID];

    // Calculate inbox agent's new plugins
    const inboxPlugins = inboxAgentId ? agentStore.agentMap[inboxAgentId]?.plugins || [] : [];
    const inboxIndex = inboxPlugins.indexOf(id);
    let newInboxPlugins: string[];
    if (shouldOpen) {
      newInboxPlugins = inboxIndex === -1 ? [...inboxPlugins, id] : inboxPlugins;
    } else {
      newInboxPlugins = inboxIndex !== -1 ? inboxPlugins.filter((p) => p !== id) : inboxPlugins;
    }

    if (inboxAgentId) {
      await agentStore.updateAgentConfigById(inboxAgentId, { plugins: newInboxPlugins });
    }
  },

  updateDefaultModel: async (model, provider) => {
    const agentStore = getAgentStoreState();
    const inboxAgentId = agentStore.builtinAgentIdMap[INBOX_SESSION_ID];

    await Promise.all([
      // 1. Update user settings' defaultAgentConfig
      get().updateDefaultAgent({ config: { model, provider } }),
      // 2. Update inbox agent's model
      inboxAgentId && agentStore.updateAgentConfigById(inboxAgentId, { model, provider }),
    ]);
  },
});
