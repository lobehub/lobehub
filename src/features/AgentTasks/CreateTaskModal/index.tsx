'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';

import CreateTaskContent, { type CreateTaskContentProps } from './CreateTaskContent';

export const createTaskModal = (props?: CreateTaskContentProps): ModalInstance =>
  createModal({
    content: <CreateTaskContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      // The popup caps itself at the viewport height; let the body shrink into
      // it so the instruction area scrolls while the toolbar stays pinned.
      content: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: null,
    width: 'min(80%, 680px)',
  });
