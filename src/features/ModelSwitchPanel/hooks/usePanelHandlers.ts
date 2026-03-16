import { useCallback } from 'react';

import { useAgentStore } from '@/store/agent';

interface UsePanelHandlersProps {
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
}

export const usePanelHandlers = ({
  onModelChange: onModelChangeProp,
  onOpenChange,
}: UsePanelHandlersProps) => {
  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);

  const handleModelChange = useCallback(
    (modelId: string, providerId: string) => {
      // Defer store update so the panel close animation completes
      // before React re-renders with new data (prevents detail panel flash).
      setTimeout(() => {
        const params = { model: modelId, provider: providerId };
        if (onModelChangeProp) {
          onModelChangeProp(params);
        } else {
          updateAgentConfig(params);
        }
      }, 150);
    },
    [onModelChangeProp, updateAgentConfig],
  );

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return { handleClose, handleModelChange };
};
