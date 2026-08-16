import { useCallback, useEffect, useRef } from 'react';

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

  const modelChangeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(modelChangeTimerRef.current);
  }, []);

  const handleModelChange = useCallback(
    (modelId: string, providerId: string) => {
      // Defer store update so the panel close animation completes
      // before React re-renders with new data (prevents detail panel flash).
      modelChangeTimerRef.current = setTimeout(() => {
        if (!canCreateContent) return;

        const params = { model: modelId, provider: providerId };
        if (onModelChangeProp) {
          onModelChangeProp(params);
        } else {
          updateAgentConfig(params);
        }
      }, 150);
    },
    [canCreateContent, onModelChangeProp, updateAgentConfig],
  );

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return { handleClose, handleModelChange };
};
