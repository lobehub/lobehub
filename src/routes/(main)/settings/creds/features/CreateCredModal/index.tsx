'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import CreateCredModalContent, { type CreateCredModalContentProps } from './Content';

export const createCreateCredModal = (props?: CreateCredModalContentProps): ModalInstance =>
  createModal({
    content: <CreateCredModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: t('creds.createModal.title', { ns: 'setting' }),
    width: 'min(90vw, 640px)',
  });
