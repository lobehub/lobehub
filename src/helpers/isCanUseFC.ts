import { aiModelSelectors, aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';

export const isCanUseFC = (model: string, provider: string): boolean => {
  const state = getAiInfraStoreState();

  // The enabled-model list hydrates asynchronously (BetterAuth session resolves
  // → `isLoaded` → the aiProvider runtime-state SWR fires → `enabledAiModels` is
  // populated). Until it's ready the model simply isn't in the store yet, so
  // `isModelSupportToolUse` returns `false` for reasons of *timing*, not
  // capability. Treating that transient unknown as "no function calling" forces
  // chat mode and silently drops every user tool for the first message(s) after
  // page load. Assume function calling is available until the list is ready; the
  // real capability check applies once it loads, and the server re-derives it
  // authoritatively for gateway runs.
  if (!aiProviderSelectors.isInitAiProviderRuntimeState(state)) return true;

  return aiModelSelectors.isModelSupportToolUse(model, provider)(state) || false;
};
