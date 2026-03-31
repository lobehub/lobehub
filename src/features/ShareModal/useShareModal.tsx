'use client';

import { type ConversationContext } from '@lobechat/types';
import { type ModalInstance } from '@lobehub/ui';
import { useCallback, useEffect, useRef } from 'react';

import { openShareModal as createShareModal } from './Modal';

interface UseShareModalOptions {
  context?: Partial<ConversationContext>;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

export const useShareModal = ({ context, open, setOpen }: UseShareModalOptions = {}) => {
  const modalRef = useRef<ModalInstance | null>(null);

  const closeShareModal = useCallback(() => {
    modalRef.current?.close();
    modalRef.current = null;
  }, []);

  const openShareModal = useCallback(() => {
    if (modalRef.current) return modalRef.current;

    setOpen?.(true);
    modalRef.current = createShareModal({
      afterClose: () => {
        modalRef.current = null;
        setOpen?.(false);
      },
      context,
    });

    return modalRef.current;
  }, [context, setOpen]);

  useEffect(() => {
    if (open === undefined) return;

    if (open) {
      openShareModal();
      return;
    }

    closeShareModal();
  }, [closeShareModal, open, openShareModal]);

  return {
    closeShareModal,
    openShareModal,
  };
};
