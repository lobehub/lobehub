'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';

import CredModalTitle from '../CredModalTitle';
import ViewCredModalContent, { type ViewCredModalContentProps } from './Content';

export const createViewCredModal = (props: ViewCredModalContentProps): ModalInstance =>
  createModal({
    content: <ViewCredModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: <CredModalTitle cred={props.cred} title={props.cred.name} type={props.cred.type} />,
    width: 'min(90vw, 480px)',
  });
