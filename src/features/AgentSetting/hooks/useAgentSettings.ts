import { useMemo } from 'react';

import { useStoreApi } from '../store';
import { type PublicAction } from '../store/action';

export type AgentSettingsInstance = PublicAction;

export const useAgentSettings = (): AgentSettingsInstance => {
  const storeApi = useStoreApi();

  const {
    autocompleteMeta,
    autocompleteAllMeta,
    autocompleteAgentTitle,
    autocompleteAgentDescription,
    autocompleteAgentTags,
    autoPickEmoji,
  } = storeApi.getState();

  return useMemo(
    () => ({
      autoPickEmoji,
      autocompleteAgentDescription,
      autocompleteAgentTags,
      autocompleteAgentTitle,
      autocompleteAllMeta,
      autocompleteMeta,
    }),
    [],
  );
};
