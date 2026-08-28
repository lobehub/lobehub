'use client';

import { type ConversationContext } from '@lobechat/types';
import { type ModalInstance } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useRef } from 'react';

import { openShareModal as createShareModal } from './loader';

interface UseShareModalOptions {
  context?: Partial<ConversationContext>;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

export const useShareModal = ({ context, open, setOpen }: UseShareModalOptions = {}) => {
  const modalRef = useRef<ModalInstance | null>(null);
  const openingRef = useRef<Promise<ModalInstance> | null>(null);
  const requestIdRef = useRef(0);

  const closeShareModal = useCallback(() => {
    requestIdRef.current += 1;
    modalRef.current?.close();
    modalRef.current = null;
    openingRef.current = null;
    setOpen?.(false);
  }, [setOpen]);

  const openShareModal = useCallback(() => {
    if (modalRef.current) return Promise.resolve(modalRef.current);
    if (openingRef.current) return openingRef.current;

    setOpen?.(true);
    const requestId = ++requestIdRef.current;
    let createdModal: ModalInstance | undefined;

    const opening = createShareModal({
      afterClose: () => {
        if (requestId !== requestIdRef.current) return;
        if (modalRef.current === createdModal) modalRef.current = null;
        setOpen?.(false);
      },
      context,
    }).then(
      (modal) => {
        createdModal = modal;
        if (requestId === requestIdRef.current) openingRef.current = null;

        if (requestId !== requestIdRef.current) {
          modal.close();
          return modal;
        }

        modalRef.current = modal;
        return modal;
      },
      (error) => {
        if (requestId === requestIdRef.current) {
          openingRef.current = null;
          setOpen?.(false);
        }
        throw error;
      },
    );

    openingRef.current = opening;

    return opening;
  }, [context, setOpen]);

  useEffect(() => {
    if (open === undefined) return;

    if (open) {
      void openShareModal();
      return;
    }

    closeShareModal();
  }, [closeShareModal, open, openShareModal]);

  return {
    closeShareModal,
    openShareModal,
  };
};
