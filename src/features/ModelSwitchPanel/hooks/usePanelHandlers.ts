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
    async (modelId: string, providerId: string) => {
      const params = { model: modelId, provider: providerId };
      if (onModelChangeProp) {
        onModelChangeProp(params);
      } else {
        updateAgentConfig(params);
      }
    },
    [onModelChangeProp, updateAgentConfig],
  );

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return { handleClose, handleModelChange };
};
