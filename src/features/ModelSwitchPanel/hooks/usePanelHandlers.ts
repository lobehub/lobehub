import { useCallback } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';

interface UsePanelHandlersProps {
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
}

export const usePanelHandlers = ({
  onModelChange: onModelChangeProp,
  onOpenChange,
}: UsePanelHandlersProps) => {
  const { allowed: canCreateContent } = usePermission('create_content');
  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);

  const handleModelChange = useCallback(
    (modelId: string, providerId: string) => {
      if (!canCreateContent) return;

      // Commit the selection synchronously. Conversation sends resolve their
      // runtime model from the store, so delaying this write lets a quick Enter
      // after closing the panel run on the previously selected model (#15933).
      const params = { model: modelId, provider: providerId };
      if (onModelChangeProp) {
        void onModelChangeProp(params);
      } else {
        void updateAgentConfig(params);
      }
    },
    [canCreateContent, onModelChangeProp, updateAgentConfig],
  );

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return { handleClose, handleModelChange };
};
