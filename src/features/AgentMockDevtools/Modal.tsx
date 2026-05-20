import type { ModalInstance } from '@lobehub/ui/base-ui';
import { createModal } from '@lobehub/ui/base-ui';
import { memo, useEffect, useRef } from 'react';

import { DevtoolsLayout } from './DevtoolsLayout';
import { useAgentMockStore } from './store/agentMockStore';

export const Modal = memo(() => {
  const modalOpen = useAgentMockStore((s) => s.modalOpen);
  const setModalOpen = useAgentMockStore((s) => s.setModalOpen);
  const instanceRef = useRef<ModalInstance | null>(null);

  useEffect(() => {
    if (modalOpen && !instanceRef.current) {
      instanceRef.current = createModal({
        content: <DevtoolsLayout />,
        footer: null,
        onOpenChange: (open) => {
          if (!open) setModalOpen(false);
        },
        onOpenChangeComplete: (open) => {
          if (!open) instanceRef.current = null;
        },
        styles: { content: { padding: 0 } },
        title: 'Agent Mock DevTools',
        width: 'min(1280px, 92vw)',
      });
    } else if (!modalOpen && instanceRef.current) {
      instanceRef.current.close();
    }
  }, [modalOpen, setModalOpen]);

  return null;
});

Modal.displayName = 'AgentMockModal';
