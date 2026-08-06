'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import CreateAppModalContent, { type CreateAppModalContentProps } from './Content';

export const createOAuthAppModal = (props: CreateAppModalContentProps): ModalInstance =>
  createModal({
    content: <CreateAppModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: t('oauthApp.form.title', { ns: 'auth' }),
    width: 'min(90vw, 560px)',
  });
