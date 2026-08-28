'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import ViewCredModalContent, { type ViewCredModalContentProps } from './Content';

export const createViewCredModal = (props: ViewCredModalContentProps): ModalInstance =>
  createModal({
    content: <ViewCredModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: t('creds.view.title', { name: props.cred.name, ns: 'setting' }),
    width: 'min(90vw, 600px)',
  });
