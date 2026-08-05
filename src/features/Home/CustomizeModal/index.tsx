'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';

import CustomizeModalContent from './Content';

export const openHomeCustomizeModal = (): ModalInstance =>
  createModal({
    content: <CustomizeModalContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
    },
    title: null,
    width: 'min(92vw, 460px)',
  });
