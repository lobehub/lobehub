import { CURRENT_ONBOARDING_VERSION, INBOX_SESSION_ID } from '@lobechat/const';
import { getPluginMode, MAX_ONBOARDING_STEPS, upsertPluginMode } from '@lobechat/types';

import { userService } from '@/services/user';
import { getAgentStoreState } from '@/store/agent';
import { type StoreSetter } from '@/store/types';
import { type UserStore } from '@/store/user';

import { settingsSelectors } from '../settings/selectors';
import { onboardingSelectors } from './selectors';

type Setter = StoreSetter<UserStore>;
export const createOnboardingSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new OnboardingActionImpl(set, get, _api);

export class OnboardingActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  finishOnboarding = async (): Promise<void> => {
    const currentStep = onboardingSelectors.currentStep(this.#get());

    await userService.updateOnboarding({
      currentStep,
      finishedAt: new Date().toISOString(),
      version: CURRENT_ONBOARDING_VERSION,
    });

    await this.#get().refreshUserState();
  };

  resetOnboarding = async (): Promise<void> => {
    this.#set(
      {
        isProcessingStepQueue: false,
        localOnboardingStep: 1,
        stepUpdateQueue: [],
      },
      false,
      'resetOnboarding/optimistic',
    );

    await userService.updateOnboarding({
      currentStep: 1,
      version: CURRENT_ONBOARDING_VERSION,
    });

    await this.#get().refreshUserState();
  };

  goToNextStep = (): void => {
    const currentStep = onboardingSelectors.currentStep(this.#get());
    if (currentStep === MAX_ONBOARDING_STEPS) return;

    const nextStep = currentStep + 1;
    this.#set({ localOnboardingStep: nextStep }, false, 'goToNextStep/optimistic');
    this.#get().internal_queueStepUpdate(nextStep);
  };

  goToPreviousStep = (): void => {
    const currentStep = onboardingSelectors.currentStep(this.#get());
    if (currentStep === 1) return;

    const prevStep = currentStep - 1;
    this.#set({ localOnboardingStep: prevStep }, false, 'goToPreviousStep/optimistic');
    this.#get().internal_queueStepUpdate(prevStep);
  };

  internal_processStepUpdateQueue = async (): Promise<void> => {
    const { isProcessingStepQueue, stepUpdateQueue } = this.#get();
    if (isProcessingStepQueue || stepUpdateQueue.length === 0) return;

    this.#set({ isProcessingStepQueue: true }, false, 'processStepUpdateQueue/start');

    while (this.#get().stepUpdateQueue.length > 0) {
      const step = this.#get().stepUpdateQueue[0];
      const finishedAt = onboardingSelectors.finishedAt(this.#get());

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
      this.#set(
        { stepUpdateQueue: this.#get().stepUpdateQueue.slice(1) },
        false,
        'processStepUpdateQueue/shift',
      );
    }

    this.#set({ isProcessingStepQueue: false }, false, 'processStepUpdateQueue/end');

    // Sync with server state after all updates complete
    await this.#get().refreshUserState();
  };

  internal_queueStepUpdate = (step: number): void => {
    const { stepUpdateQueue } = this.#get();

    if (stepUpdateQueue.length === 0) {
      // Queue is empty, add task and start processing
      this.#set({ stepUpdateQueue: [step] }, false, 'queueStepUpdate/push');
      this.#get().internal_processStepUpdateQueue();
    } else if (stepUpdateQueue.length === 1) {
      // One task is executing, add as pending
      this.#set({ stepUpdateQueue: [...stepUpdateQueue, step] }, false, 'queueStepUpdate/push');
    } else {
      // Queue is full (length >= 2), replace the pending task
      this.#set({ stepUpdateQueue: [stepUpdateQueue[0], step] }, false, 'queueStepUpdate/replace');
    }
  };

  setOnboardingStep = async (step: number): Promise<void> => {
    // Optimistic update
    this.#set({ localOnboardingStep: step }, false, 'setOnboardingStep/optimistic');

    const finishedAt = onboardingSelectors.finishedAt(this.#get());
    await userService.updateOnboarding({
      currentStep: step,
      finishedAt,
      version: CURRENT_ONBOARDING_VERSION,
    });

    await this.#get().refreshUserState();
  };

  toggleInboxAgentDefaultPlugin = async (id: string, open?: boolean): Promise<void> => {
    const currentSettings = settingsSelectors.currentSettings(this.#get());
    const isDefaultPinned =
      getPluginMode(currentSettings.defaultAgent?.config?.plugins, id) === 'pinned';
    const shouldOpen = open !== undefined ? open : !isDefaultPinned;

    const agentStore = getAgentStoreState();
    const inboxAgentId = agentStore.builtinAgentIdMap[INBOX_SESSION_ID];
    if (!inboxAgentId) return;

    // upsertPluginMode preserves an already-matching entry as-is and flips a
    // disabled entry back to pinned in place, instead of blindly pushing a
    // duplicate bare-string identifier.
    const inboxRawPlugins = agentStore.agentMap[inboxAgentId]?.plugins;
    await agentStore.updateAgentConfigById(inboxAgentId, {
      plugins: upsertPluginMode(inboxRawPlugins, id, shouldOpen ? 'pinned' : 'auto'),
    });
  };

  updateDefaultModel = async (model: string, provider: string): Promise<void> => {
    const agentStore = getAgentStoreState();
    const inboxAgentId = agentStore.builtinAgentIdMap[INBOX_SESSION_ID];

    await Promise.all([
      // 1. Update user settings' defaultAgentConfig
      this.#get().updateDefaultAgent({ config: { model, provider } }),
      // 2. Update inbox agent's model
      inboxAgentId && agentStore.updateAgentConfigById(inboxAgentId, { model, provider }),
    ]);
  };
}

export type OnboardingAction = Pick<OnboardingActionImpl, keyof OnboardingActionImpl>;
