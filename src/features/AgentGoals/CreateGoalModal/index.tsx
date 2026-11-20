'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';

import CreateGoalContent, { type CreateGoalContentProps } from './CreateGoalContent';

export type { CreateGoalContentProps };

export const createGoalModal = (props?: CreateGoalContentProps): ModalInstance =>
  createModal({
    content: <CreateGoalContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: {
      // The popup caps itself at the viewport height; let the body shrink into
      // it so the long content scrolls while the footer stays pinned.
      content: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: null,
    width: 'min(88vw, 720px)',
  });
