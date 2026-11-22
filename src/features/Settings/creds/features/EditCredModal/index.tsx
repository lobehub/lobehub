'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';

import CredModalTitle from '../CredModalTitle';
import EditCredModalContent, { type EditCredModalContentProps } from './Content';

export const createEditCredModal = (props: EditCredModalContentProps): ModalInstance =>
  createModal({
    content: <EditCredModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: <CredModalTitle title={props.cred.name} type={props.cred.type} />,
    width: 'min(90vw, 560px)',
  });
