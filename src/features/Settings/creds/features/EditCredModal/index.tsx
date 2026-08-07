'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import EditCredModalContent, { type EditCredModalContentProps } from './Content';

export const createEditCredModal = (props: EditCredModalContentProps): ModalInstance =>
  createModal({
    content: <EditCredModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: t('creds.edit.title', { ns: 'setting' }),
    width: 'min(90vw, 560px)',
  });
