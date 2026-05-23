'use client';

import { useCallback } from 'react';

import { useUpdateAgentConfig } from './useUpdateAgentConfig';

/**
 * Toggle between chat mode and agent mode.
 *
 * The flag is stored on `chatConfig.enableAgentMode` so it persists (chat_config
 * is a jsonb column) and is readable on the server. The `plugins` array is left
 * untouched — chat mode is enforced at the runtime tools engine layer.
 */
export const useToggleAgentMode = () => {
  const { updateAgentChatConfig } = useUpdateAgentConfig();

  return useCallback(
    (enable: boolean) => updateAgentChatConfig({ enableAgentMode: enable }),
    [updateAgentChatConfig],
  );
};
