'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';

import CreateGoalContent, { type CreateGoalContentProps } from './CreateGoalContent';

export type { CreateGoalContentProps };

export const createGoalModal = (props?: CreateGoalContentProps): ModalInstance =>
  createModal({
    content: <CreateGoalContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: {
      content: {
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: null,
    width: 'min(88vw, 720px)',
  });
