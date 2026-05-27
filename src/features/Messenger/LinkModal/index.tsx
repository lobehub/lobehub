'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';

import LinkModalContent, { type LinkModalContentProps } from './Content';

export const createMessengerLinkModal = (props: LinkModalContentProps): ModalInstance =>
  createModal({
    content: <LinkModalContent {...props} />,
    footer: null,
    maskClosable: true,
    title: null,
    width: 'min(90vw, 480px)',
  });
