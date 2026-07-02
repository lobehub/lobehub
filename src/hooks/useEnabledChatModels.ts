import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { useEnabledModels } from './useEnabledModels';

export const useEnabledChatModels = (): EnabledProviderWithModels[] => {
  return useEnabledModels('chat');
};
