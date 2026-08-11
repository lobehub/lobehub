import { CURRENT_ONBOARDING_VERSION, INBOX_SESSION_ID } from '@lobechat/const';
import { CLASSIC_ONBOARDING_MAX_STEP, getPluginMode, upsertPluginMode } from '@lobechat/types';

import { userService } from '@/services/user';
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
  #writeChain: Promise<unknown> = Promise.resolve();

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #enqueueOnboardingWrite = (task: () => Promise<unknown>): Promise<unknown> => {
    const run = this.#writeChain.then(task, task);
    this.#writeChain = run.catch(() => undefined);
    return run;
  };

  finishOnboarding = async (): Promise<void> => {
    const currentStep = onboardingSelectors.currentStep(this.#get());
    const finishedAt = new Date().toISOString();

    this.#set(
      {
        onboarding: {
          ...this.#get().onboarding,
          currentStep,
          finishedAt,
          version: CURRENT_ONBOARDING_VERSION,
        },
      },
      false,
      'finishOnboarding/optimistic',
    );

    await this.#enqueueOnboardingWrite(() =>
      userService.updateOnboarding({
        currentStep,
        finishedAt,
        version: CURRENT_ONBOARDING_VERSION,
      }),
    );

    await this.#get().refreshUserState();
  };

  goToNextStep = (): void => {
    const currentStep = onboardingSelectors.currentStep(this.#get());
    if (currentStep >= CLASSIC_ONBOARDING_MAX_STEP) return;
    void this.setOnboardingStep(currentStep + 1);
  };

  goToPreviousStep = (): void => {
    const currentStep = onboardingSelectors.currentStep(this.#get());
    if (currentStep <= 1) return;
    void this.setOnboardingStep(currentStep - 1);
  };

  resetOnboarding = async (): Promise<void> => {
    this.#set({ localOnboardingStep: 1 }, false, 'resetOnboarding/optimistic');

    await this.#enqueueOnboardingWrite(() =>
      userService.updateOnboarding({ currentStep: 1, version: CURRENT_ONBOARDING_VERSION }),
    );

    await this.#get().refreshUserState();
  };

  setOnboardingStep = async (step: number): Promise<void> => {
    // Optimistic update
    this.#set({ localOnboardingStep: step }, false, 'setOnboardingStep/optimistic');

    await this.#enqueueOnboardingWrite(() => {
      const finishedAt = onboardingSelectors.finishedAt(this.#get());
      return userService.updateOnboarding({
        currentStep: step,
        finishedAt,
        version: CURRENT_ONBOARDING_VERSION,
      });
    });

    await this.#get().refreshUserState();
  };

  toggleInboxAgentDefaultPlugin = async (id: string, open?: boolean): Promise<void> => {
    const currentSettings = settingsSelectors.currentSettings(this.#get());
    const isDefaultPinned =
      getPluginMode(currentSettings.defaultAgent?.config?.plugins, id) === 'pinned';
    const shouldOpen = open !== undefined ? open : !isDefaultPinned;

    // User Store is part of cache-scope resolution, while Agent Store consumes
    // that scope for Projection writes. Resolve this low-frequency dependency
    // at action time so the two stores do not re-enter each other during ESM
    // initialization.
    const { getAgentStoreState } = await import('@/store/agent');
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
}

export type OnboardingAction = Pick<OnboardingActionImpl, keyof OnboardingActionImpl>;
