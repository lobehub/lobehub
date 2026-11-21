import isEqual from 'fast-deep-equal';
import { useState } from 'react';

import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import type { PersonalSystemAgentKey } from '@/types/user/settings';

/**
 * State for one chat-assist row. Each row owns its save state: the store
 * serializes writes per entry only, so a shared state could report one row's
 * success over the other row's failure, or retry the wrong write.
 */
export const useChatAssistRow = (itemKey: PersonalSystemAgentKey) => {
  const value = useUserStore((s) => settingsSelectors.currentSystemAgent(s)[itemKey], isEqual);
  const updatePersonalSystemAgent = useUserStore((s) => s.updatePersonalSystemAgent);
  const [loading, setLoading] = useState(false);
  const saveState = useSaveState();

  const update = async (next: { enabled?: boolean; model?: string; provider?: string }) => {
    setLoading(true);
    try {
      await saveState.save(() => updatePersonalSystemAgent(itemKey, next));
    } finally {
      setLoading(false);
    }
  };

  return { loading, saveState, update, value };
};
