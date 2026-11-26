import { useMemo } from 'react';

import { useBusinessModelListGuard } from '@/business/client/hooks/useBusinessModelListGuard';
import { type EnabledProviderWithModels } from '@/types/aiProvider';
import { filterHiddenModels } from '@/utils/filterHiddenModels';

import { useEnabledChatModels } from './useEnabledChatModels';

/**
 * Enabled chat models the viewer can pick: `useEnabledChatModels` minus the
 * models a business policy hides (e.g. ones above the tier a workspace admin
 * allows this member). Every model picker and every "pick a default model"
 * path reads this, so a hidden model is never offered or chosen anywhere.
 */
export const useSelectableChatModels = (): EnabledProviderWithModels[] => {
  const enabledList = useEnabledChatModels();
  const { isModelHidden } = useBusinessModelListGuard();

  return useMemo(
    () => filterHiddenModels(enabledList, isModelHidden),
    [enabledList, isModelHidden],
  );
};
